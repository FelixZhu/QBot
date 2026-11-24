import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearClientCaches,
  clearSavedToken,
  isUnauthorizedMessage,
  loadSavedToken,
  normalizeToken,
  UNAUTHORIZED_MESSAGE,
  verifyAndSaveToken,
} from "./accessToken.ts";
import { TOKEN_KEY, type SecretStore } from "./serverSession.ts";

function memorySecrets(): SecretStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async get(key) { return map.get(key) ?? null; },
    async set(key, value) { map.set(key, value); },
    async remove(key) { map.delete(key); },
  };
}

test("normalizeToken trims valid tokens and rejects short or whitespace-containing values", () => {
  assert.equal(normalizeToken("  qbot-demo-token-1234  "), "qbot-demo-token-1234");
  assert.throws(() => normalizeToken("too-short"), /16–256/);
  assert.throws(() => normalizeToken("has spaces in token value"), /16–256/);
  assert.equal(isUnauthorizedMessage(UNAUTHORIZED_MESSAGE), true);
  assert.equal(isUnauthorizedMessage("无法连接服务器"), false);
});

test("verifyAndSaveToken verifies against /v1/session before writing to secure storage", async () => {
  const secrets = memorySecrets();
  let seenAuth = "";
  const saved = await verifyAndSaveToken({
    origin: "https://example.invalid",
    rawToken: "  qbot-valid-demo-token-99  ",
    secrets,
    fetchImpl: async (_input, init) => {
      seenAuth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
      return new Response(JSON.stringify({
        ownerId: "00000000-0000-4000-8000-000000000001",
        agentId: "00000000-0000-4000-8000-000000000002",
        model: "deepseek/test",
        upstream: "openrouter",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.equal(saved, "qbot-valid-demo-token-99");
  assert.equal(seenAuth, "Bearer qbot-valid-demo-token-99");
  assert.equal(secrets.map.get(TOKEN_KEY), "qbot-valid-demo-token-99");
  assert.equal(await loadSavedToken(secrets), "qbot-valid-demo-token-99");

  await clearSavedToken(secrets);
  assert.equal(await loadSavedToken(secrets), "");
});

test("verifyAndSaveToken does not overwrite secure storage when server rejects with 401", async () => {
  const secrets = memorySecrets();
  await assert.rejects(() => verifyAndSaveToken({
    origin: "https://example.invalid",
    rawToken: "qbot-rejected-demo-token-1",
    secrets,
    fetchImpl: async () => new Response(
      JSON.stringify({ error: { message: UNAUTHORIZED_MESSAGE } }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    ),
  }), /需要有效的访问令牌/);
  assert.equal(secrets.map.has(TOKEN_KEY), false);
});

test("clearClientCaches removes only qbot feed and thread cache keys", async () => {
  const removed: string[] = [];
  await clearClientCaches({
    async getAllKeys() {
      return [
        "qbot.feed.cache.v1.following",
        "qbot.chat.thread.abc",
        "qbot.chat.lastThread",
        "unrelated.setting",
      ];
    },
    async multiRemove(keys) {
      removed.push(...keys);
    },
  });
  assert.deepEqual(removed, [
    "qbot.feed.cache.v1.following",
    "qbot.chat.thread.abc",
    "qbot.chat.lastThread",
  ]);
});
