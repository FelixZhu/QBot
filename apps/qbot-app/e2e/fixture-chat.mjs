/**
 * Local test double for the Android emulator. Not a model and not the chat server.
 * The app labels upstream "fixture" as 测试夹具.
 */
import { createServer } from "node:http";

const CONV = "00000000-0000-4000-8000-000000000010";
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

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" });
    res.end();
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
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
    send(res, 200, { conversations: [{ id: CONV, title: "新对话", createdAt: now(), updatedAt: now() }] });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/conversations") {
    send(res, 201, { id: CONV, title: "新对话", createdAt: now(), updatedAt: now() });
    return;
  }
  if (req.method === "GET" && url.pathname === `/v1/conversations/${CONV}/messages`) {
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
      if (closed) {
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
    const reply = "夹具固定回复，不是真实模型。";
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
  send(res, 404, { error: { message: "没有这个接口" } });
});

server.listen(8799, "127.0.0.1", () => {
  console.log("fixture-chat listening 8799");
});
