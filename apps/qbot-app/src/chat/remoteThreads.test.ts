import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServerClient, ServerConversation, ServerMessage } from "./serverClient.ts";
import { createRemoteThreadListAdapter } from "./remoteThreads.ts";
import { createCachedHistory } from "./threadHistory.ts";

const conversations: ServerConversation[] = [
  { id: "a", title: "新对话", createdAt: "2026-11-20T00:00:00.000Z", updatedAt: "2026-11-20T00:00:02.000Z" },
  { id: "b", title: "另一则", createdAt: "2026-11-20T00:00:00.000Z", updatedAt: "2026-11-20T00:00:01.000Z" },
];

function message(id: string, content: string): ServerMessage {
  return { id, role: "assistant", content, status: "complete", createdAt: "2026-11-20T00:00:00.000Z" };
}

function client(): ServerClient {
  return {
    origin: "http://127.0.0.1:8799",
    async session() {
      return { ownerId: "o", agentId: "a", model: "fixture-local", upstream: "fixture" };
    },
    async listConversations() {
      return conversations;
    },
    async createConversation() {
      return { id: "c", title: "新对话", createdAt: "", updatedAt: "" };
    },
    async listMessages(id) {
      return [message(id, id === "a" ? "甲" : "乙")];
    },
  };
}

test("the thread list uses the existing conversation endpoints", async () => {
  const adapter = createRemoteThreadListAdapter(client());
  const listed = await adapter.list();
  assert.deepEqual(listed.threads.map((item) => item.remoteId), ["a", "b"]);
  const created = await adapter.initialize("local");
  assert.equal(created.remoteId, "c");
  const fetched = await adapter.fetch("b");
  assert.equal(fetched.title, "另一则");
});

test("a keyed history loader does not return another thread's messages", async () => {
  const caches = new Map<string, ServerMessage[]>([["a", [message("a1", "缓存甲")]]]);
  let current = "a";
  const seen: string[] = [];
  const history = createCachedHistory({
    getId: () => current,
    client: client(),
    onSync: () => {},
    importNow: (id, messages) => seen.push(`${id}:${messages[0]?.content}`),
    readCache: async (id) => caches.get(id) ?? null,
    writeCache: async (id, messages) => { caches.set(id, messages); },
  });
  const first = await history.load();
  const firstText = first.messages[0]?.message.content[0]?.type === "text" ? first.messages[0].message.content[0].text : "";
  assert.equal(firstText, "缓存甲");
  current = "b";
  const second = await history.load();
  const secondText = second.messages[0]?.message.content[0]?.type === "text" ? second.messages[0].message.content[0].text : "";
  assert.equal(secondText, "乙");
  assert.notEqual(secondText, firstText);
});
