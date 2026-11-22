import assert from "node:assert/strict";
import { test } from "node:test";
import { artifactUrl, createFeedClient, feedColumnWidth, formatPublished, presentFeed } from "./feedClient.ts";

test("the feed states stay empty when the server fails and a wide column stays put", () => {
  assert.deepEqual(presentFeed({ phase: "loading", count: 0, cached: false }), { kind: "loading" });
  assert.deepEqual(presentFeed({ phase: "ready", count: 0, cached: false }), { kind: "empty" });
  assert.deepEqual(presentFeed({ phase: "error", count: 0, cached: false, message: "需要有效的访问令牌" }), { kind: "error", message: "需要有效的访问令牌" });
  assert.deepEqual(presentFeed({ phase: "error", count: 0, cached: true }), { kind: "error", message: "无法连接服务器" });
  assert.deepEqual(presentFeed({ phase: "error", count: 2, cached: true }), { kind: "cached", message: "已保存的内容，可能不是最新" });
  assert.equal(presentFeed({ phase: "error", count: 2, cached: false, message: "stack trace" }).kind, "error");
  assert.equal(feedColumnWidth(390), 390);
  assert.equal(feedColumnWidth(720), 480);
  assert.equal(feedColumnWidth(1200), 480);
  assert.equal(formatPublished("2026-11-21T08:44:00.000Z"), "11-21 16:44");
  assert.equal(formatPublished("2026-11-21T08:48:00.000Z"), "11-21 16:48");
});

test("a relative asset keeps the bundle token in the path", () => {
  const page = artifactUrl("http://127.0.0.1:8787", "00000000-0000-4000-8000-0000000000d1", 1, "token", "index.html");
  assert.equal(new URL("brief.css", page).toString(), artifactUrl("http://127.0.0.1:8787", "00000000-0000-4000-8000-0000000000d1", 1, "token", "brief.css"));
  assert.equal(page.includes("/v/1/token/files/index.html"), true);
});

test("a failed feed does not invent a card", async () => {
  const client = createFeedClient({
    origin: "http://127.0.0.1:9",
    fetchImpl: async () => { throw new Error("down"); },
  });
  await assert.rejects(() => client.feed("following"), /无法连接服务器/);
  const denied = createFeedClient({
    origin: "http://127.0.0.1:9",
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "需要有效的访问令牌" } }), { status: 401 }),
  });
  await assert.rejects(() => denied.botBySlug("qbot"), /需要有效的访问令牌/);
});
