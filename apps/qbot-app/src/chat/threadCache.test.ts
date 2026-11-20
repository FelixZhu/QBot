import assert from "node:assert/strict";
import { test } from "node:test";
import { openChat } from "./serverSession.ts";
import {
  nextThread,
  parseThreadCache,
  runtimeKey,
  serializeThreadCache,
  trimMessages,
  type ThreadCache,
} from "./threadCache.ts";
import type { ServerMessage } from "./serverClient.ts";

const cached: ThreadCache = {
  conversationId: "conv-1",
  messages: [
    { id: "u1", role: "user", content: "你好", status: "complete", createdAt: "2026-11-20T00:00:00.000Z" },
    { id: "a1", role: "assistant", content: "在的", status: "complete", createdAt: "2026-11-20T00:00:01.000Z" },
  ],
};

test("a cached thread is visible before the server answers, then the server copy wins", () => {
  const first = { messages: cached.messages, revision: 1 };
  assert.equal(runtimeKey(cached.conversationId), "conv-1");
  assert.deepEqual(first.messages.map((message) => message.content), ["你好", "在的"]);
  const same = nextThread(first, cached.messages);
  assert.equal(same.revision, 1);
  const server = nextThread(first, [
    cached.messages[0],
    { id: "a1", role: "assistant", content: "服务器这条", status: "complete", createdAt: "2026-11-20T00:00:01.000Z" },
  ]);
  assert.equal(server.revision, 2);
  assert.equal(server.messages[1]?.content, "服务器这条");
  assert.equal(runtimeKey(cached.conversationId), runtimeKey(cached.conversationId));
});

test("the cache keeps the newest 50 messages and refuses a token", () => {
  const many: ServerMessage[] = Array.from({ length: 60 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `第${index}条`,
    status: "complete",
    createdAt: "2026-11-20T00:00:00.000Z",
  }));
  const trimmed = trimMessages(many);
  assert.equal(trimmed.length, 50);
  assert.equal(trimmed[0]?.id, "m10");
  const raw = serializeThreadCache({ conversationId: "conv-1", messages: many });
  assert.equal(raw.includes("token"), false);
  assert.equal(raw.includes("authorization"), false);
  assert.equal(parseThreadCache(raw)?.messages.length, 50);
  assert.equal(parseThreadCache(JSON.stringify({ conversationId: "conv-1", messages: cached.messages, token: "secret" })), null);
});

test("session and the conversation list start together", async () => {
  let started = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fetchImpl = async (url: string | URL | Request) => {
    const path = String(url);
    started += 1;
    if (started === 1) await gate;
    if (path.endsWith("/v1/session")) {
      return new Response(JSON.stringify({
        ownerId: "owner",
        agentId: "agent",
        model: "fixture-local",
        upstream: "fixture",
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      conversations: [{ id: "conv-1", title: "新对话", createdAt: "", updatedAt: "" }],
    }), { status: 200 });
  };
  const pending = openChat({
    origin: "http://127.0.0.1:8799",
    preferredId: "conv-1",
    fetchImpl: fetchImpl as typeof fetch,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(started, 2);
  release();
  const ready = await pending;
  assert.equal(ready.conversationId, "conv-1");
  assert.equal(ready.token, "");
});
