import type { IncomingMessage, ServerResponse } from "node:http";
import { agentsCatalog, CatalogUnavailable, type SqlClient } from "./catalog.ts";
import { PACKAGE_LIMITS } from "./limits.ts";
import { emptyDryRun } from "./types.ts";
import { dryRunPackage } from "./validate.ts";

export type CardImportDeps = {
  config: { ownerId: string };
  pool?: SqlClient;
};

const NOT_IMPLEMENTED = "这一版只实现了 dry-run。stage、commit、publish、rollback 都还没有做，不会写数据库、不会写对象、也不会发通知。";

/**
 * Owner-authenticated card import routes.
 * Call this only after the same bearer check as the other owner routes.
 * The handler issues one SELECT against agents and does not write.
 */
export async function tryCardImport(deps: CardImportDeps, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  if (req.method === "POST" && path === "/v1/card-imports/dry-run") {
    await postDryRun(deps, req, res);
    return true;
  }
  if (isUnimplemented(req.method, path)) {
    sendJson(res, 501, { error: { code: "not_implemented", message: NOT_IMPLEMENTED } });
    return true;
  }
  return false;
}

function isUnimplemented(method: string | undefined, path: string): boolean {
  if (method === "POST" && path === "/v1/card-imports/stage") return true;
  if (method === "GET" && /^\/v1\/card-imports\/([^/]+)$/.test(path)) return true;
  return method === "POST" && /^\/v1\/card-imports\/([^/]+)\/(commit|publish|rollback)$/.test(path);
}

async function postDryRun(deps: CardImportDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isZip(req.headers["content-type"])) {
    sendJson(res, 415, { error: { code: "unsupported_media_type", message: "请求必须是 application/zip" } });
    req.destroy();
    return;
  }
  if (!deps.pool) {
    sendJson(res, 503, { error: { code: "catalog_unavailable", message: "不能读取 agents 表，导入没有继续" } });
    req.destroy();
    return;
  }
  const body = await readBody(req, PACKAGE_LIMITS.zipBytes);
  if (!body.ok) {
    sendJson(res, 200, emptyDryRun([{ code: "zip_limit", message: "ZIP 超过 8MiB" }]));
    return;
  }
  const header = req.headers["idempotency-key"];
  const idempotencyKey = Array.isArray(header) ? header.join(",") : header;
  try {
    const result = await dryRunPackage({
      body: body.buffer,
      idempotencyKey,
      ownerId: deps.config.ownerId,
      catalog: agentsCatalog(deps.pool),
    });
    sendJson(res, 200, result);
  } catch (error) {
    if (error instanceof CatalogUnavailable) {
      sendJson(res, 503, { error: { code: "catalog_unavailable", message: error.message } });
      return;
    }
    throw error;
  }
}

function isZip(header: string | string[] | undefined): boolean {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return false;
  return value.split(";", 1)[0]?.trim().toLowerCase() === "application/zip";
}

async function readBody(req: IncomingMessage, max: number): Promise<{ ok: true; buffer: Buffer } | { ok: false }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > max) {
      req.destroy();
      return { ok: false };
    }
    chunks.push(buffer);
  }
  return { ok: true, buffer: Buffer.concat(chunks) };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(payload);
}
