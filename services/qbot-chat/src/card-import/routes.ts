import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type pg from "pg";
import { readBearer, tokensMatch } from "../auth.ts";
import type { Config } from "../config.ts";
import { errorBody, HttpError } from "../errors.ts";
import type { ObjectStore } from "../feed/objects.ts";
import { isUuid } from "../feed/paths.ts";
import { sendJson, type RateLimiter } from "../http-utils.ts";
import { LIMITS } from "../limits.ts";
import { sha256Hex } from "./jcs.ts";
import { PACKAGE_LIMITS } from "./limits.ts";
import { createCardImportStore, type CardImportStore } from "./store.ts";
import type { ZipStore } from "./uploads.ts";
import type { CardImportWorker } from "./worker.ts";
import { hasZipMagic } from "./zip.ts";

const IMPORT_ID = /^\/v1\/card-imports\/([^/]+)$/;
const IMPORT_PUBLISH = /^\/v1\/card-imports\/([^/]+)\/publish$/;
const IMPORT_ROLLBACK = /^\/v1\/card-imports\/([^/]+)\/rollback$/;

const stores = new WeakMap<pg.Pool, CardImportStore>();

export type CardImportRouteDeps = {
  config: Config;
  pool?: pg.Pool;
  objects?: ObjectStore;
  cardImports?: CardImportStore;
  cardImportWorker?: CardImportWorker;
  zipStore?: ZipStore;
};

/**
 * Owner-authenticated async card-package import routes.
 * QBOT_FEED_OPEN and QBOT_PERSONAL_OPEN NEVER bypass Bearer auth here.
 */
export async function tryCardImport(
  deps: CardImportRouteDeps,
  req: IncomingMessage,
  res: ServerResponse,
  limiter: RateLimiter,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname;
  if (pathname !== "/v1/card-imports" && !pathname.startsWith("/v1/card-imports/")) {
    return false;
  }

  const bearer = readBearer(req.headers.authorization);
  const bearerOk = Boolean(bearer && deps.config.accessToken && tokensMatch(bearer, deps.config.accessToken));
  if (!bearerOk) {
    sendJson(res, 401, errorBody("unauthorized", "需要有效的访问令牌"));
    return true;
  }
  if (!limiter.allow(bearer!)) {
    sendJson(res, 429, errorBody("rate_limited", "请求太频繁"));
    return true;
  }

  if (req.method === "POST" && pathname === "/v1/card-imports") {
    await postImport(deps, req, res);
    return true;
  }

  const publishMatch = IMPORT_PUBLISH.exec(pathname);
  if (publishMatch && req.method === "POST") {
    await postPublish(deps, req, res, publishMatch[1] ?? "");
    return true;
  }

  const rollbackMatch = IMPORT_ROLLBACK.exec(pathname);
  if (rollbackMatch && req.method === "POST") {
    await postRollback(deps, req, res, rollbackMatch[1] ?? "");
    return true;
  }

  const getMatch = IMPORT_ID.exec(pathname);
  if (getMatch && req.method === "GET") {
    await getImport(deps, res, getMatch[1] ?? "");
    return true;
  }

  throw new HttpError(404, "not_found", "没有这个接口");
}

async function postImport(deps: CardImportRouteDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isZipContentType(req.headers["content-type"])) {
    throw new HttpError(415, "unsupported_media_type", "请求必须是 application/zip");
  }

  const idempotencyKey = parseIdempotencyKey(req.headers["idempotency-key"]);
  if (!idempotencyKey) {
    throw new HttpError(400, "bad_request", "需要合法的 Idempotency-Key 头（8 到 200 字符）");
  }

  const declaredLength = req.headers["content-length"];
  if (declaredLength !== undefined) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > PACKAGE_LIMITS.zipBytes) {
      throw new HttpError(413, "too_large", "ZIP 超过 8MiB");
    }
  }

  const body = await readRawBody(req, PACKAGE_LIMITS.zipBytes);
  if (body.length === 0) {
    throw new HttpError(400, "bad_request", "ZIP 请求体不能为空");
  }
  if (!hasZipMagic(body)) {
    throw new HttpError(400, "invalid_zip", "请求体不是有效的 ZIP 文件");
  }

  if (!deps.objects?.write) {
    throw new HttpError(503, "storage_readonly", "当前对象存储不支持写入，请配置 QBOT_OBJECT_ROOT 或 OSS 写入凭证");
  }
  if (!deps.zipStore) {
    throw new HttpError(500, "persist", "导入暂存目录未初始化");
  }

  const importStore = resolveStore(deps);
  const zipSha256 = sha256Hex(body);
  const candidateId = randomUUID();

  // Durably persist raw ZIP BEFORE returning 202 and before enqueueing.
  await deps.zipStore.save(candidateId, body);

  let enqueued;
  try {
    enqueued = await importStore.enqueue({
      importId: candidateId,
      ownerId: deps.config.ownerId,
      idempotencyKey,
      zipSha256,
      zipBytes: body.length,
    });
  } catch (error) {
    await deps.zipStore.remove(candidateId);
    throw error;
  }

  if (enqueued.kind === "conflict") {
    await deps.zipStore.remove(candidateId);
    throw new HttpError(409, "idempotency_conflict", "Idempotency-Key 已被其他内容占用");
  }

  if (enqueued.kind === "existing") {
    await deps.zipStore.remove(candidateId);
    sendJson(res, 202, { importId: enqueued.importId, state: "accepted" });
    return;
  }

  deps.cardImportWorker?.notify();
  sendJson(res, 202, { importId: enqueued.importId, state: "accepted" });
}

async function getImport(deps: CardImportRouteDeps, res: ServerResponse, rawId: string): Promise<void> {
  if (!isUuid(rawId)) throw new HttpError(404, "not_found", "没有这个导入任务");
  const status = await resolveStore(deps).get(deps.config.ownerId, rawId);
  if (!status) throw new HttpError(404, "not_found", "没有这个导入任务");
  sendJson(res, 200, status);
}

async function postPublish(deps: CardImportRouteDeps, req: IncomingMessage, res: ServerResponse, rawId: string): Promise<void> {
  if (!isUuid(rawId)) throw new HttpError(404, "not_found", "没有这个导入任务");
  const body = await readJsonObject(req, LIMITS.bodyBytes);
  for (const key of Object.keys(body)) {
    if (key !== "expectedPreviousVersion") {
      throw new HttpError(400, "bad_request", `不能提交 ${key.slice(0, 40)}`);
    }
  }
  if (!Object.prototype.hasOwnProperty.call(body, "expectedPreviousVersion")) {
    throw new HttpError(400, "bad_request", "必须提供 expectedPreviousVersion（第一版为 null）");
  }
  const rawPrev = body.expectedPreviousVersion;
  let expectedPreviousVersion: number | null;
  if (rawPrev === null) {
    expectedPreviousVersion = null;
  } else if (typeof rawPrev === "number" && Number.isInteger(rawPrev) && rawPrev >= 1) {
    expectedPreviousVersion = rawPrev;
  } else {
    throw new HttpError(400, "bad_request", "expectedPreviousVersion 必须是 null 或正整数");
  }

  const result = await resolveStore(deps).publish(deps.config.ownerId, rawId, expectedPreviousVersion);
  sendJson(res, 200, result);
}

async function postRollback(deps: CardImportRouteDeps, req: IncomingMessage, res: ServerResponse, rawId: string): Promise<void> {
  if (!isUuid(rawId)) throw new HttpError(404, "not_found", "没有这个导入任务");
  await readEmptyJson(req);
  const result = await resolveStore(deps).rollback(deps.config.ownerId, rawId);
  sendJson(res, 200, result);
}

function resolveStore(deps: CardImportRouteDeps): CardImportStore {
  if (deps.cardImports) return deps.cardImports;
  if (!deps.pool) throw new HttpError(500, "persist", "数据库没有完成写入");
  let store = stores.get(deps.pool);
  if (!store) {
    store = createCardImportStore(deps.pool);
    stores.set(deps.pool, store);
  }
  return store;
}

function isZipContentType(header: string | string[] | undefined): boolean {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return false;
  return value.split(";", 1)[0]?.trim().toLowerCase() === "application/zip";
}

function parseIdempotencyKey(header: string | string[] | undefined): string | null {
  if (Array.isArray(header)) return null;
  if (typeof header !== "string") return null;
  const trimmed = header.trim();
  if (
    trimmed.length < PACKAGE_LIMITS.idempotencyKeyMin
    || trimmed.length > PACKAGE_LIMITS.idempotencyKeyMax
    || /[\x00-\x1f\x7f]/.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw new HttpError(413, "too_large", "ZIP 超过 8MiB");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJsonObject(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  const type = req.headers["content-type"] ?? "";
  if (!type.includes("application/json")) throw new HttpError(400, "bad_request", "请求必须是 JSON");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new HttpError(413, "too_large", "请求太大");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "bad_request", "请求不是 JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "bad_request", "请求必须是 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

async function readEmptyJson(req: IncomingMessage): Promise<void> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > LIMITS.bodyBytes) throw new HttpError(413, "too_large", "请求太大");
    chunks.push(buffer);
  }
  if (size === 0) return;
  const type = req.headers["content-type"] ?? "";
  if (!type.includes("application/json")) throw new HttpError(400, "bad_request", "请求必须是 JSON");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "bad_request", "请求不是 JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "bad_request", "请求必须是 JSON 对象");
  }
  if (Object.keys(parsed).length > 0) {
    throw new HttpError(400, "bad_request", "不能提交额外字段");
  }
}
