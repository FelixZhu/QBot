import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type pg from "pg";
import { readBearer, tokensMatch } from "../auth.ts";
import type { Config } from "../config.ts";
import { errorBody, HttpError } from "../errors.ts";
import { etagMatches, sendJson, type ArtifactCache, type RateLimiter } from "../http-utils.ts";
import { LIMITS } from "../limits.ts";
import type { ObjectStore } from "./objects.ts";
import { ARTIFACT_CSP, bundlePath, contentTypeFor, isUuid } from "./paths.ts";
import { createFeedStore, type AccessMode, type FeedScope, type FeedStore } from "./store.ts";

const BOT = /^\/v1\/bots\/([0-9a-f-]{36})$/i;
const BOT_SLUG = /^\/v1\/bots\/by-slug\/([a-z0-9-]{1,40})$/;
const FOLLOW = /^\/v1\/bots\/([0-9a-f-]{36})\/follow$/i;
const CARD = /^\/v1\/cards\/([0-9a-f-]{36})$/i;
const CAPABILITY = /^\/v1\/cards\/([0-9a-f-]{36})\/capability$/i;
const ARTIFACT = /^\/v1\/artifacts\/([0-9a-f-]{36})\/v\/([1-9][0-9]{0,3})\/([A-Za-z0-9_-]{43})\/files\/(.+)$/i;

const feeds = new WeakMap<pg.Pool, FeedStore>();

export type FeedDeps = {
  config: Config;
  pool?: pg.Pool;
  objects?: ObjectStore;
  artifactCache?: ArtifactCache;
};

export async function tryFeed(deps: FeedDeps, req: IncomingMessage, res: ServerResponse, limiter: RateLimiter): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;
  if (!isFeedPath(path)) return false;
  if (req.method === "GET" && ARTIFACT.test(path)) {
    if (!limiter.allow("artifact")) {
      sendJson(res, 429, errorBody("rate_limited", "请求太频繁"));
      return true;
    }
    await serveArtifact(deps, req, res, path);
    return true;
  }
  const bearer = readBearer(req.headers.authorization);
  const bearerOk = Boolean(bearer && deps.config.accessToken && tokensMatch(bearer, deps.config.accessToken));
  if (!bearerOk && !deps.config.feedOpen) {
    sendJson(res, 401, errorBody("unauthorized", "需要有效的访问令牌"));
    return true;
  }
  if (!limiter.allow(bearerOk && bearer ? bearer : "feed")) {
    sendJson(res, 429, errorBody("rate_limited", "请求太频繁"));
    return true;
  }
  const mode: AccessMode = bearerOk ? "bearer" : "open";
  await dispatch(deps, req, res, url, mode);
  return true;
}

function isFeedPath(path: string): boolean {
  return path === "/v1/feed"
    || path === "/v1/bots" || path.startsWith("/v1/bots/")
    || path === "/v1/cards" || path.startsWith("/v1/cards/")
    || path === "/v1/artifacts" || path.startsWith("/v1/artifacts/");
}

async function dispatch(deps: FeedDeps, req: IncomingMessage, res: ServerResponse, url: URL, mode: AccessMode): Promise<void> {
  const feed = store(deps);
  const ownerId = deps.config.ownerId;
  const path = url.pathname;
  if (req.method === "GET" && path === "/v1/feed") {
    const keys = [...url.searchParams.keys()];
    if (keys.some((key) => key !== "scope" && key !== "limit" && key !== "cursor")) {
      throw new HttpError(400, "bad_request", "查询参数不合法");
    }
    const scope = url.searchParams.get("scope");
    if (scope !== "following" && scope !== "recommended") throw new HttpError(400, "bad_request", "scope 不合法");
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit == null ? LIMITS.feedPage : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.feedPage) throw new HttpError(400, "bad_request", "limit 不合法");
    const cursor = url.searchParams.get("cursor");
    try {
      sendJson(res, 200, await feed.list(ownerId, scope as FeedScope, limit, cursor, mode));
    } catch (error) {
      if (error instanceof Error && error.message === "bad cursor") throw new HttpError(400, "bad_request", "cursor 不合法");
      throw error;
    }
    return;
  }
  const slug = BOT_SLUG.exec(path);
  if (slug && req.method === "GET") {
    const bot = await feed.botBySlug(ownerId, slug[1] ?? "");
    if (!bot) throw new HttpError(404, "not_found", "没有这个 bot");
    sendJson(res, 200, bot);
    return;
  }
  const follow = FOLLOW.exec(path);
  if (follow && (req.method === "POST" || req.method === "DELETE")) {
    await readEmpty(req);
    const id = follow[1] ?? "";
    if (!isUuid(id)) throw new HttpError(404, "not_found", "没有这个 bot");
    const ok = req.method === "POST" ? await feed.follow(ownerId, id) : await feed.unfollow(ownerId, id);
    if (!ok) throw new HttpError(404, "not_found", "没有这个 bot");
    const bot = await feed.bot(ownerId, id);
    sendJson(res, 200, bot);
    return;
  }
  const botPath = BOT.exec(path);
  if (botPath && req.method === "GET") {
    const id = botPath[1] ?? "";
    if (!isUuid(id)) throw new HttpError(404, "not_found", "没有这个 bot");
    const bot = await feed.bot(ownerId, id);
    if (!bot) throw new HttpError(404, "not_found", "没有这个 bot");
    sendJson(res, 200, bot);
    return;
  }
  const capability = CAPABILITY.exec(path);
  if (capability && req.method === "POST") {
    await readEmpty(req);
    const id = capability[1] ?? "";
    if (!isUuid(id)) throw new HttpError(404, "not_found", "没有这张卡片");
    const minted = await feed.mint(ownerId, id, mode);
    if (!minted) throw new HttpError(404, "not_found", "没有这张卡片");
    sendJson(res, 201, minted);
    return;
  }
  const card = CARD.exec(path);
  if (card && req.method === "GET") {
    const id = card[1] ?? "";
    if (!isUuid(id)) throw new HttpError(404, "not_found", "没有这张卡片");
    const detail = await feed.card(ownerId, id, mode);
    if (!detail) throw new HttpError(404, "not_found", "没有这张卡片");
    sendJson(res, 200, detail);
    return;
  }
  throw new HttpError(404, "not_found", "没有这个接口");
}

async function serveArtifact(deps: FeedDeps, req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const match = ARTIFACT.exec(path);
  const artifactId = match?.[1] ?? "";
  const version = Number(match?.[2] ?? "");
  const token = match?.[3] ?? "";
  const rawPath = match?.[4] ?? "";
  if (!isUuid(artifactId) || !Number.isInteger(version)) throw new HttpError(404, "not_found", "没有这个文件");
  const relPath = bundlePath(rawPath);
  if (!relPath) throw new HttpError(404, "not_found", "没有这个文件");
  const expected = contentTypeFor(relPath);
  if (!expected) throw new HttpError(404, "not_found", "没有这个文件");
  const resolved = await store(deps).resolve(token, artifactId, version, relPath);
  if (resolved === "expired") throw new HttpError(401, "expired", "链接已过期");
  if (resolved === "denied") throw new HttpError(401, "unauthorized", "链接无效");
  if (resolved.contentType !== expected) throw new HttpError(404, "not_found", "没有这个文件");
  const etag = `"${resolved.sha256}"`;
  const headers = {
    "Content-Security-Policy": ARTIFACT_CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "private, max-age=60",
    ETag: etag,
    "Content-Disposition": "inline",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  if (etagMatches(req.headers["if-none-match"], etag)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  const cacheKey = `${artifactId}/v${version}/${relPath}@${resolved.sha256}`;
  let bytes = deps.artifactCache?.get(cacheKey) ?? null;
  if (!bytes) {
    const objects = deps.objects;
    bytes = objects ? await objects.read(artifactId, version, relPath) : null;
    if (!bytes) throw new HttpError(404, "not_found", "内容不在这台服务器上");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== resolved.sha256 || bytes.length !== resolved.byteLength) {
      console.error("object bytes do not match the catalog");
      throw new HttpError(404, "not_found", "内容不在这台服务器上");
    }
    deps.artifactCache?.set(cacheKey, bytes);
  }
  res.writeHead(200, {
    "Content-Type": expected,
    "Content-Length": bytes.length,
    ...headers,
  });
  res.end(bytes);
}

function store(deps: FeedDeps): FeedStore {
  if (!deps.pool) throw new HttpError(500, "persist", "数据库没有完成写入");
  let feed = feeds.get(deps.pool);
  if (!feed) {
    feed = createFeedStore(deps.pool);
    feeds.set(deps.pool, feed);
  }
  return feed;
}

async function readEmpty(req: IncomingMessage): Promise<void> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
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
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(400, "bad_request", "请求必须是 JSON 对象");
  if (Object.keys(parsed).length > 0) throw new HttpError(400, "bad_request", "不能提交额外字段");
}
