import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AssistantStream,
  AssistantTransportEncoder,
  createAssistantStream,
} from "assistant-stream";
import { localReply, type DemoId } from "../demos.ts";
import { createDemoHistory, createMemoryStorage } from "./history.ts";
import { createHttpStreamTransport } from "./httpStream.ts";
import { createLocalTransport } from "./local.ts";
import { toModelAdapter } from "./transport.ts";
import { toRepository } from "./serverHistory.ts";

const DEMOS: DemoId[] = ["info", "english", "study"];

function userMessage(text: string) {
  return { role: "user" as const, content: [{ type: "text" as const, text }] };
}

async function collect(source: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of source) out.push(chunk);
  return out;
}

test("local transport still yields the scripted reply in two steps", async () => {
  const samples: { id: DemoId; text: string }[] = [
    { id: "info", text: "一句话" },
    { id: "english", text: "Send me the file" },
    { id: "study", text: "差别" },
  ];
  for (const sample of samples) {
    const reply = localReply(sample.id, sample.text);
    const mid = Math.max(1, Math.ceil(reply.length / 2));
    const signal = new AbortController().signal;
    const deltas = await collect(createLocalTransport(sample.id).reply(
      [{ role: "user", text: sample.text }],
      signal,
    ));
    assert.deepEqual(deltas, [reply.slice(0, mid), reply.slice(mid)]);
    const shown: string[] = [];
    const run = toModelAdapter(createLocalTransport(sample.id)).run({
      messages: [userMessage(sample.text)],
      abortSignal: signal,
    } as never);
    for await (const update of run) {
      const part = update.content?.[0];
      shown.push(part && part.type === "text" ? part.text : "");
    }
    assert.deepEqual(shown, [reply.slice(0, mid), reply]);
    assert.match(reply, /演示/);
  }
  for (const id of DEMOS) {
    assert.equal(createLocalTransport(id).label, "本地演示");
    assert.match(localReply(id, "随便一句"), /演示回复/);
  }
});

test("an aborted local reply does not yield", async () => {
  const signal = AbortSignal.abort();
  await assert.rejects(() => collect(createLocalTransport("info").reply(
    [{ role: "user", text: "一句话" }],
    signal,
  )));
});

function storedMessage(id: string, parentId: string | null, text: string, at: string) {
  return {
    parentId,
    message: {
      id,
      role: "assistant" as const,
      createdAt: new Date(at),
      content: [{ type: "text" as const, text }],
      status: { type: "complete" as const, reason: "stop" as const },
      metadata: { custom: { demo: true } },
    },
  };
}

test("history survives a new adapter on the same storage", async () => {
  const storage = createMemoryStorage();
  const first = createDemoHistory(storage, "info");
  const older = storedMessage("info-1", null, "演示回复：第一句", "2026-01-02T03:04:05.000Z");
  const newer = storedMessage("info-2", "info-1", "演示回复：第二句", "2026-01-02T03:05:05.000Z");
  await Promise.all([first.append(older), first.append(newer)]);
  const loaded = await createDemoHistory(storage, "info").load();
  assert.deepEqual(loaded.messages.map((item) => item.message.id), ["info-1", "info-2"]);
  assert.equal(loaded.headId, "info-2");
  assert.equal(loaded.messages[0]?.parentId, null);
  assert.equal(loaded.messages[1]?.parentId, "info-1");
  assert.ok(loaded.messages[1]?.message.createdAt instanceof Date);
  assert.equal(loaded.messages[1]?.message.createdAt.toISOString(), "2026-01-02T03:05:05.000Z");
  const text = loaded.messages[1]?.message.content[0];
  assert.equal(text && text.type === "text" ? text.text : "", "演示回复：第二句");

  await first.update({
    ...newer,
    message: { ...newer.message, content: [{ type: "text", text: "演示回复：改过" }] },
  });
  const updated = await createDemoHistory(storage, "info").load();
  assert.equal(updated.headId, "info-2");
  assert.equal(updated.messages.length, 2);
  const updatedText = updated.messages[1]?.message.content[0];
  assert.equal(updatedText && updatedText.type === "text" ? updatedText.text : "", "演示回复：改过");

  const other = await createDemoHistory(storage, "english").load();
  assert.deepEqual(other.messages, []);
});

test("unreadable history loads as an empty thread", async () => {
  const storage = createMemoryStorage();
  await storage.setItem("qbot-demo-history:study", "{not json");
  const loaded = await createDemoHistory(storage, "study").load();
  assert.deepEqual(loaded.messages, []);
  await storage.setItem("qbot-demo-history:study", JSON.stringify({ messages: "nope" }));
  const again = await createDemoHistory(storage, "study").load();
  assert.deepEqual(again.messages, []);
});

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function pipeBytes(res: ServerResponse, bytes: ReadableStream<Uint8Array>) {
  const reader = bytes.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    reader.releaseLock();
  }
  res.end();
}

test("streaming HTTP reads a local fake server and no other host", { timeout: 10_000 }, async () => {
  const seen: { method: string; authorization: string | null; body: unknown; url: string }[] = [];
  const server = createServer(async (req, res) => {
    const raw = await readBody(req);
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw;
    }
    seen.push({
      method: req.method ?? "",
      authorization: req.headers.authorization ?? null,
      body,
      url: req.url ?? "",
    });
    if (req.url === "/fail") {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("secret-token-should-not-leak");
      return;
    }
    if (req.url === "/hold") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.write("半");
      await new Promise<void>((resolve) => req.on("close", () => resolve()));
      if (!res.writableEnded) res.end();
      return;
    }
    const payload = body as { messages?: { role?: string; text?: string }[] };
    const last = [...payload.messages ?? []].reverse().find((turn) => turn.role === "user")?.text ?? "";
    if (req.url === "/text") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.write(Buffer.from("收到:"));
      await new Promise((resolve) => setTimeout(resolve, 30));
      res.write(Buffer.from(last));
      res.end();
      return;
    }
    const stream = createAssistantStream((controller) => {
      controller.appendText("收到:");
      controller.appendText(last);
    });
    const encoder = new AssistantTransportEncoder();
    res.writeHead(200, Object.fromEntries(encoder.headers.entries()));
    await pipeBytes(res, AssistantStream.toByteStream(stream, encoder));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake server has no port");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const path of ["/sse", "/text"] as const) {
      const transport = createHttpStreamTransport({ url: `${base}${path}` });
      assert.equal(transport.label, "流式 HTTP（未接入）");
      const deltas = await collect(transport.reply(
        [{ role: "user", text: "你好" }, { role: "assistant", text: "先前" }],
        new AbortController().signal,
      ));
      assert.equal(deltas.join(""), "收到:你好");
      assert.ok(deltas.length >= 2, path);
    }
    const failing = createHttpStreamTransport({ url: `${base}/fail` });
    await assert.rejects(
      () => collect(failing.reply([{ role: "user", text: "你好" }], new AbortController().signal)),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /HTTP 503/);
        assert.equal(message.includes("secret-token"), false);
        return true;
      },
    );
    const holding = createHttpStreamTransport({ url: `${base}/hold` });
    const signal = new AbortController();
    const iter = holding.reply([{ role: "user", text: "停" }], signal.signal);
    const first = await iter.next();
    assert.equal(first.done, false);
    assert.equal(first.value, "半");
    signal.abort();
    await assert.rejects(() => iter.next());
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  assert.deepEqual(seen.map((call) => call.url), ["/sse", "/text", "/fail", "/hold"]);
  for (const call of seen) {
    assert.equal(call.method, "POST");
    assert.equal(call.authorization, null);
  }
  const posted = seen[0]?.body as { messages: { role: string; text: string }[] };
  assert.deepEqual(posted.messages, [
    { role: "user", text: "你好" },
    { role: "assistant", text: "先前" },
  ]);
});

test("an empty cancelled turn reloads as stopped, while a pending one stays unfinished", () => {
  const cancelled = toRepository([{
    id: "cancelled-empty",
    role: "assistant",
    content: "",
    status: "cancelled",
    createdAt: "2026-11-20T00:00:00.000Z",
  }]);
  const cancelledMessage = cancelled.messages[0]?.message;
  assert.equal(cancelledMessage && cancelledMessage.role === "assistant" ? cancelledMessage.status.reason : "", "cancelled");
  const cancelledText = cancelledMessage?.content[0];
  assert.equal(cancelledText && cancelledText.type === "text" ? cancelledText.text : "missing", "");

  const pending = toRepository([{
    id: "pending-empty",
    role: "assistant",
    content: "",
    status: "pending",
    createdAt: "2026-11-20T00:00:00.000Z",
  }]);
  const pendingMessage = pending.messages[0]?.message;
  assert.equal(pendingMessage && pendingMessage.role === "assistant" ? pendingMessage.status.reason : "", "error");
  const pendingText = pendingMessage?.content[0];
  assert.equal(pendingText && pendingText.type === "text" ? pendingText.text : "", "服务器没有完成这条回复。");
});

test("a cancelled server turn reloads as stopped text, not a generic error", () => {
  const loaded = toRepository([{
    id: "cancelled-1",
    role: "assistant",
    content: "收到。",
    status: "cancelled",
    createdAt: "2026-11-20T00:00:00.000Z",
  }]);
  const message = loaded.messages[0]?.message;
  assert.equal(message && message.role === "assistant" ? message.status.reason : "", "cancelled");
  const text = message?.content[0];
  assert.equal(text && text.type === "text" ? text.text : "", "收到。");
});

test("the home is one Qbot row and the live path does not invent a model reply", () => {
  const root = new URL("../", import.meta.url);
  const read = (name: string) => readFileSync(new URL(name, root), "utf8");
  const pane = read("ChatPane.tsx");
  assert.match(pane, /Qbot/);
  assert.equal(pane.includes("Info Bot"), false);
  assert.equal(pane.includes("createLocalTransport"), false);
  assert.equal(pane.includes("createHttpStreamTransport"), false);
  const live = read("chat/LiveChat.tsx");
  assert.equal(live.includes("createLocalTransport"), false);
  assert.equal(live.includes("localReply"), false);
  assert.match(live, /createServerChatTransport/);
  assert.equal(live.includes("连接码"), false);
  assert.match(live, /ChatThreadSurface/);
  assert.match(live, /maxWidth: READ_MAX/);
  const app = read("../App.tsx");
  assert.equal(app.includes("findDemo"), false);
  const files = [
    "ChatPane.tsx",
    "demos.ts",
    "chat/local.ts",
    "chat/transport.ts",
    "chat/history.ts",
    "chat/httpStream.ts",
    "chat/deviceStorage.ts",
    "chat/LiveChat.tsx",
    "chat/liveTransport.ts",
    "chat/serverClient.ts",
    "chat/serverEndpoint.ts",
    "chat/serverSession.ts",
    "chat/deviceSecret.ts",
    "chat/deviceSettings.ts",
  ];
  for (const file of files) {
    const source = read(file);
    assert.equal(/EXPO_PUBLIC_[A-Z0-9_]*\s*=\s*["']https?:/.test(source), false, file);
    assert.equal(/sk-or-|sk-ant-|sk-live-/.test(source), false, file);
    assert.equal(source.includes("deepseek/deepseek-v4.1-flash-1017"), false, file);
  }
  const settings = read("chat/deviceSettings.ts");
  assert.equal(settings.includes("qbot.server.token"), false);
  const secret = read("chat/deviceSecret.ts");
  assert.equal(secret.includes("AsyncStorage"), false);
});
