/**
 * LOCAL test double for the Android emulator. Not a model, not OSS, and not the
 * production chat process. Card bytes are the seed bundles on disk.
 * The app labels upstream "fixture" as 测试夹具.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BOT = "00000000-0000-4000-8000-000000000002";
const SEED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../services/qbot-chat/seed");
const MANIFEST = JSON.parse(readFileSync(path.join(SEED, "manifest.json"), "utf8"));
const CSP = "default-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'none'; script-src 'self'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
let followed = true;
const capabilities = new Map();

const CONV = "00000000-0000-4000-8000-000000000010";
const OTHER = "00000000-0000-4000-8000-000000000011";
const FRESH = "00000000-0000-4000-8000-000000000012";
const HOLD_MS = 30000;
const now = () => new Date().toISOString();
const messages = [
  {
    id: "00000000-0000-4000-8000-0000000000a1",
    role: "user",
    content: "举一个例子",
    status: "complete",
    createdAt: now(),
  },
  {
    id: "00000000-0000-4000-8000-0000000000a2",
    role: "assistant",
    content: [
      "先说结论。这句可以长按选择。",
      "",
      "- 第一点用来把正文撑开",
      "- 第二点用来把正文撑开",
      "- 第三点用来把正文撑开",
      "- 第四点用来把正文撑开",
      "- 第五点用来把正文撑开",
      "- 第六点用来把正文撑开",
    ].join("\n"),
    status: "complete",
    createdAt: now(),
  },
];

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { resolve({}); }
    });
  });
}

function sse(res, pieces, closed) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no",
  });
  const write = (obj) => {
    if (closed() || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };
  return {
    start() {
      write({ type: "part-start", part: { type: "text" }, path: [] });
    },
    delta(text) {
      write({ type: "text-delta", path: [0], textDelta: text });
    },
    finish() {
      if (closed() || res.writableEnded) return;
      write({ type: "part-finish", path: [0] });
      res.write("data: [DONE]\n\n");
      res.end();
    },
  };
}

let holdMessagesMs = 0;
let failMessages = false;
let fresh = false;

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" });
    res.end();
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "POST" && url.pathname === "/e2e/hold") {
    holdMessagesMs = 20000;
    failMessages = false;
    send(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && url.pathname === "/e2e/fail") {
    holdMessagesMs = 0;
    failMessages = true;
    send(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && url.pathname === "/e2e/ok") {
    holdMessagesMs = 0;
    failMessages = false;
    send(res, 200, { ok: true });
    return;
  }
  if (req.method === "GET" && url.pathname === "/health") {
    send(res, 200, { ok: true, fixture: true });
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/session") {
    send(res, 200, {
      ownerId: "00000000-0000-4000-8000-000000000001",
      agentId: "00000000-0000-4000-8000-000000000002",
      model: "fixture-local",
      upstream: "fixture",
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/conversations") {
    const rows = [
      { id: CONV, title: "新对话", createdAt: now(), updatedAt: now() },
      { id: OTHER, title: "另一则", createdAt: now(), updatedAt: now() },
    ];
    if (fresh) rows.push({ id: FRESH, title: "新对话", createdAt: now(), updatedAt: now() });
    send(res, 200, { conversations: rows });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/conversations") {
    fresh = true;
    send(res, 201, { id: FRESH, title: "新对话", createdAt: now(), updatedAt: now() });
    return;
  }
  if (req.method === "GET" && url.pathname === `/v1/conversations/${OTHER}/messages`) {
    send(res, 200, { messages: [{ id: "other-1", role: "assistant", content: "这是另一则会话。", status: "complete", createdAt: now() }] });
    return;
  }
  if (req.method === "GET" && url.pathname === `/v1/conversations/${FRESH}/messages`) {
    send(res, 200, { messages: [] });
    return;
  }
  if (req.method === "GET" && url.pathname === `/v1/conversations/${CONV}/messages`) {
    if (failMessages) {
      send(res, 503, { error: { message: "夹具暂停" } });
      return;
    }
    if (holdMessagesMs > 0) await new Promise((resolve) => setTimeout(resolve, holdMessagesMs));
    send(res, 200, { messages });
    return;
  }
  if (req.method === "POST" && url.pathname === `/v1/conversations/${CONV}/messages`) {
    const body = await readBody(req);
    if (Object.keys(body).some((key) => key !== "text")) {
      send(res, 400, { error: { message: "不能提交附件" } });
      return;
    }
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      send(res, 400, { error: { message: "文字为空" } });
      return;
    }
    const user = { id: crypto.randomUUID(), role: "user", content: text, status: "complete", createdAt: now() };
    const assistant = { id: crypto.randomUUID(), role: "assistant", content: "", status: "pending", createdAt: now() };
    messages.push(user, assistant);
    // The request body is already consumed. Client stop closes the response,
    // which is the same signal the real chat server uses. Mark it immediately
    // so a reload during the hold sees cancelled, not an unfinished error.
    let closed = false;
    let finished = false;
    const markCancelled = () => {
      closed = true;
      if (!finished && assistant.status === "pending") assistant.status = "cancelled";
    };
    res.on("close", () => {
      if (!finished) markCancelled();
    });
    const stream = sse(res, null, () => closed);
    await new Promise((resolve) => {
      if (closed || text === "展示格式") {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, HOLD_MS);
      res.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (closed || assistant.status === "cancelled") {
      if (!res.writableEnded) {
        try { res.end(); } catch { /* the phone already hung up */ }
      }
      return;
    }
    stream.start();
    const reply = text === "展示格式"
      ? "# 格式\n\n- 第一项\n- 第二项\n\n看 [说明](https://example.com/qbot)\n\n```js\nconst answer = 1\n```\n\n| 列一 | 列二 | 列三 | 列四 | 列五 |\n| --- | --- | --- | --- | --- |\n| 很宽的一格内容用来横滑 | 第二格 | 第三格 | 第四格 | 第五格 |\n"
      : "夹具固定回复，不是真实模型。";
    if (text === "展示格式") {
      const head = reply.slice(0, reply.indexOf("| 列一"));
      const table = reply.slice(head.length);
      stream.delta(head);
      assistant.content += head;
      await new Promise((resolve) => setTimeout(resolve, 5000));
      if (closed) {
        assistant.status = "cancelled";
        if (!res.writableEnded) {
          try { res.end(); } catch { /* the phone already hung up */ }
        }
        return;
      }
      stream.delta(table);
      assistant.content += table;
      finished = true;
      assistant.status = "complete";
      stream.finish();
      return;
    }
    for (const piece of [reply.slice(0, 4), reply.slice(4)]) {
      if (closed) break;
      stream.delta(piece);
      assistant.content += piece;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    if (closed) {
      assistant.status = "cancelled";
      if (!res.writableEnded) {
        try { res.end(); } catch { /* the phone already hung up */ }
      }
      return;
    }
    finished = true;
    assistant.status = "complete";
    stream.finish();
    return;
  }
  try {
    if (handleCards(req, res, url)) return;
  } catch (error) {
    console.error(`fixture card route failed ${error instanceof Error ? error.message : "error"}`);
    if (!res.headersSent) send(res, 500, { error: { message: "夹具没有完成" } });
    return;
  }
  send(res, 404, { error: { message: "没有这个接口" } });
});

function botBody() {
  return { id: BOT, slug: "qbot", displayName: "Qbot", visibility: "public", bio: "手写卡片和对话。这一版没有别的 bot。", followed };
}

function cardBody(card) {
  const cover = card.files.find((file) => file.role === "cover");
  // Local display order only. Production published_at is assigned by the seed.
  const publishedAt = card.id.endsWith("c2") ? "2026-11-21T09:21:18.000Z" : "2026-11-21T09:21:17.000Z";
  return {
    id: card.id,
    title: card.title,
    publishedAt,
    visibility: card.visibility,
    provenance: "manual",
    artifactId: card.artifactId,
    manifestSha256: card.manifestSha256,
    coverPath: cover.path,
    artifactVersion: card.version,
    bot: { id: BOT, slug: "qbot", displayName: "Qbot", followed },
  };
}

function handleCards(req, res, url) {
  const pathName = url.pathname;
  if (req.method === "GET" && pathName === "/v1/bots/by-slug/qbot") {
    send(res, 200, botBody());
    return true;
  }
  if (req.method === "GET" && pathName === `/v1/bots/${BOT}`) {
    send(res, 200, botBody());
    return true;
  }
  if ((req.method === "POST" || req.method === "DELETE") && pathName === `/v1/bots/${BOT}/follow`) {
    followed = req.method === "POST";
    send(res, 200, botBody());
    return true;
  }
  if (req.method === "GET" && pathName === "/v1/feed") {
    const scope = url.searchParams.get("scope");
    const cards = scope === "following" && !followed
      ? []
      : MANIFEST.cards.map(cardBody).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id));
    send(res, 200, { cards, next: null });
    return true;
  }
  const capability = /^\/v1\/cards\/([^/]+)\/capability$/.exec(pathName);
  if (req.method === "POST" && capability) {
    const card = MANIFEST.cards.find((item) => item.id === capability[1]);
    if (!card) {
      send(res, 404, { error: { message: "没有这张卡片" } });
      return true;
    }
    const token = randomBytes(32).toString("base64url");
    capabilities.set(token, { artifactId: card.artifactId, version: card.version, expires: Date.now() + 600_000 });
    send(res, 201, {
      token,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      artifactId: card.artifactId,
      version: card.version,
      files: card.files.map((file) => ({ path: file.path, contentType: file.contentType, sha256: file.sha256, role: file.role })),
    });
    return true;
  }
  const file = /^\/v1\/artifacts\/([^/]+)\/v\/([^/]+)\/([^/]+)\/files\/(.+)$/.exec(pathName);
  if (req.method === "GET" && file) {
    const grant = capabilities.get(file[3]);
    const card = MANIFEST.cards.find((item) => item.artifactId === file[1]);
    const entry = card?.files.find((item) => item.path === decodeURIComponent(file[4]));
    if (!grant || grant.artifactId !== file[1] || String(grant.version) !== file[2] || grant.expires <= Date.now() || !entry || entry.path.includes("..")) {
      send(res, 401, { error: { message: "链接无效" } });
      return true;
    }
    const bytes = readFileSync(path.join(SEED, "bundles", card.dir, entry.path));
    if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
      send(res, 404, { error: { message: "内容不在这台服务器上" } });
      return true;
    }
    res.writeHead(200, {
      "Content-Type": entry.contentType,
      "Content-Length": bytes.length,
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=60",
      "X-Qbot-Local": "fixture",
    });
    res.end(bytes);
    return true;
  }
  if (pathName === "/v1/feed" || pathName.startsWith("/v1/bots/") || pathName.startsWith("/v1/cards") || pathName.startsWith("/v1/artifacts/")) {
    send(res, 404, { error: { message: "没有这个接口" } });
    return true;
  }
  return false;
}

server.listen(8799, "127.0.0.1", () => {
  console.log("fixture-chat listening 8799");
});
