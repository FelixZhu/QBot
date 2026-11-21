import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type pg from "pg";
import { tokenDigest, tokensMatch, readBearer } from "./auth.ts";
import type { Config } from "./config.ts";
import { errorBody, HttpError, publicErrorMessage } from "./errors.ts";
import { createObjectStore, type ObjectStore } from "./feed/objects.ts";
import { tryFeed } from "./feed/routes.ts";
import { LIMITS } from "./limits.ts";
import type { ConversationEngine } from "./runtime/dsh.ts";
import type { ChatStore } from "./store.ts";
import { writeAssistantSse } from "./wire.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ChatServerDeps = {
  config: Config;
  store: ChatStore;
  runtime: ConversationEngine;
  pool?: pg.Pool;
  objects?: ObjectStore;
};

export function createChatServer(deps: ChatServerDeps) {
  const hits = new Map<string, number[]>();
  const feedHits = new Map<string, number[]>();
  const full: ChatServerDeps = {
    ...deps,
    objects: deps.objects ?? createObjectStore({ objectRoot: deps.config.objectRoot, oss: deps.config.oss, publicOss: deps.config.publicOss }),
  };
  return createServer((req, res) => {
    void handle(full, req, res, hits, feedHits).catch((error: unknown) => {
      if (res.headersSent || res.writableEnded) return;
      if (error instanceof HttpError) {
        sendJson(res, error.status, errorBody(error.code, error.message));
        return;
      }
      console.error(`request failed ${pgCode(error)}`);
      sendJson(res, 500, errorBody("persist", "数据库没有完成写入"));
    });
  });
}

async function handle(deps: ChatServerDeps, req: IncomingMessage, res: ServerResponse, hits: Map<string, number[]>, feedHits: Map<string, number[]>): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;
  if (req.method === "GET" && path === "/health") {
    try {
      await deps.store.health();
      sendJson(res, 200, { ok: true, postgres: "up" });
    } catch {
      sendJson(res, 503, { ok: false, postgres: "down" });
    }
    return;
  }
  if (await tryFeed(deps, req, res, feedHits)) return;
  if (!deps.config.personalOpen) {
    const token = readBearer(req.headers.authorization);
    if (!token || !tokensMatch(token, deps.config.accessToken)) {
      sendJson(res, 401, errorBody("unauthorized", "需要有效的访问令牌"));
      return;
    }
    if (!allow(hits, token)) {
      sendJson(res, 429, errorBody("rate_limited", "请求太频繁"));
      return;
    }
  } else if (!allow(hits, "personal")) {
    sendJson(res, 429, errorBody("rate_limited", "请求太频繁"));
    return;
  }
  if (req.method === "GET" && path === "/v1/session") {
    const agent = await deps.store.getAgent(deps.config.ownerId);
    sendJson(res, 200, {
      ownerId: deps.config.ownerId,
      agentId: agent.id,
      model: agent.model,
      upstream: deps.runtime.id,
      engine: deps.runtime.engine,
    });
    return;
  }
  if (path === "/v1/conversations" && req.method === "GET") {
    sendJson(res, 200, { conversations: await deps.store.listConversations(deps.config.ownerId) });
    return;
  }
  if (path === "/v1/conversations" && req.method === "POST") {
    const body = await readJson(req);
    const title = optionalTitle(body);
    sendJson(res, 201, await deps.store.createConversation(deps.config.ownerId, title));
    return;
  }
  const messages = /^\/v1\/conversations\/([^/]+)\/messages$/.exec(path);
  const conversationId = messages?.[1];
  if (conversationId && !UUID.test(conversationId)) {
    sendJson(res, 404, errorBody("not_found", "没有这则会话"));
    return;
  }
  if (conversationId && req.method === "GET") {
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit == null ? LIMITS.historyPage : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.historyPage || [...url.searchParams.keys()].some((key) => key !== "limit")) {
      sendJson(res, 400, errorBody("bad_request", "limit 不合法"));
      return;
    }
    sendJson(res, 200, { messages: await deps.store.listMessages(deps.config.ownerId, conversationId, limit) });
    return;
  }
  if (conversationId && req.method === "POST") {
    const body = await readJson(req);
    const text = requiredText(body);
    await streamTurn(deps, res, conversationId, text);
    return;
  }
  sendJson(res, 404, errorBody("not_found", "没有这个接口"));
}

async function streamTurn(deps: ChatServerDeps, res: ServerResponse, conversationId: string, text: string): Promise<void> {
  const begun = await deps.store.beginTurn(deps.config.ownerId, conversationId, text);
  const clientAbort = new AbortController();
  const timeout = AbortSignal.timeout(LIMITS.upstreamMs);
  const signal = AbortSignal.any([clientAbort.signal, timeout]);
  res.on("close", () => {
    if (!res.writableFinished) clientAbort.abort();
  });
  const running = deps.runtime.run({
    sessionId: begun.dshSessionId,
    text,
    signal: clientAbort.signal,
    onSession: (id) => deps.store.setDshSession(deps.config.ownerId, conversationId, id),
  });
  const iterator = running[Symbol.asyncIterator]();
  let settled = false;
  const settle = async (status: "complete" | "failed" | "cancelled", content: string): Promise<void> => {
    if (settled) return;
    try {
      await deps.store.finishTurn(deps.config.ownerId, begun.assistantId, begun.runId, status, content);
      settled = true;
    } catch (error) {
      if (status !== "complete") {
        settled = true;
        throw error;
      }
      try {
        await deps.store.finishTurn(deps.config.ownerId, begun.assistantId, begun.runId, "failed", content);
      } catch {
        // The row may stay pending until the next process start marks it failed.
      }
      settled = true;
      throw new Error("回复没有写入数据库");
    }
  };
  let first: IteratorResult<string>;
  try {
    first = await iterator.next();
  } catch (error) {
    await settle(clientAbort.signal.aborted ? "cancelled" : "failed", "").catch(() => {});
    if (clientAbort.signal.aborted || res.writableEnded) return;
    const message = timeout.aborted ? "模型上游超时" : publicErrorMessage(error);
    sendJson(res, 502, errorBody("upstream", message));
    return;
  }
  if (first.done) {
    await settle("failed", "");
    sendJson(res, 502, errorBody("upstream", "模型没有返回文字"));
    return;
  }
  let textOut = "";
  await writeAssistantSse(res, async (append) => {
    const take = (delta: string) => {
      if (textOut.length + delta.length > LIMITS.outputChars) throw new Error("模型回复超过长度限制");
      textOut += delta;
      append(delta);
    };
    try {
      take(first.value ?? "");
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        take(next.value);
      }
      if (!textOut) throw new Error("模型没有返回文字");
      await settle("complete", textOut);
    } catch (error) {
      const status = clientAbort.signal.aborted ? "cancelled" : "failed";
      await settle(status, textOut);
      if (status === "cancelled") return;
      throw new Error(publicErrorMessage(error));
    }
  });
}

function allow(hits: Map<string, number[]>, token: string): boolean {
  const now = Date.now();
  const key = tokenDigest(token).toString("hex");
  const stamps = (hits.get(key) ?? []).filter((stamp) => now - stamp < 60_000);
  if (stamps.length >= LIMITS.ratePerMinute) {
    hits.set(key, stamps);
    return false;
  }
  stamps.push(now);
  hits.set(key, stamps);
  return true;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const type = req.headers["content-type"] ?? "";
  if (!type.includes("application/json")) throw new HttpError(400, "bad_request", "请求必须是 JSON");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > LIMITS.bodyBytes) throw new HttpError(413, "too_large", "请求太大");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(400, "bad_request", "请求必须是 JSON 对象");
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "bad_request", "请求不是 JSON");
  }
}

function optionalTitle(body: Record<string, unknown>): string {
  rejectUnknown(body, ["title"]);
  if (body.title == null) return "新对话";
  if (typeof body.title !== "string") throw new HttpError(400, "bad_request", "标题不合法");
  const title = body.title.replace(/\s+/g, " ").trim();
  if (!title || title.length > LIMITS.titleChars || title.includes("\u0000")) throw new HttpError(400, "bad_request", "标题不合法");
  return title;
}

function requiredText(body: Record<string, unknown>): string {
  rejectUnknown(body, ["text"]);
  if (typeof body.text !== "string") throw new HttpError(400, "bad_request", "只接受 text");
  const text = body.text.trim();
  if (!text || text.length > LIMITS.textChars || text.includes("\u0000")) throw new HttpError(400, "bad_request", "文字为空或过长");
  return text;
}

function rejectUnknown(body: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw new HttpError(400, "bad_request", `不能提交 ${key.slice(0, 40)}`);
  }
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

function pgCode(error: unknown): string {
  if (typeof error === "object" && error && "code" in error && typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)) {
    return error.code;
  }
  return error instanceof HttpError ? error.code : "error";
}

export async function listen(server: ReturnType<typeof createChatServer>, host: string, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server has no port");
  return address.port;
}
