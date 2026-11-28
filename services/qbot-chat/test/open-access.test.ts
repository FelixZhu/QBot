import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type pg from "pg";
import { loadConfig } from "../src/config.ts";
import { createLocalObjectStore, createObjectStore, type ObjectStore } from "../src/feed/objects.ts";
import type { ConversationEngine } from "../src/runtime/dsh.ts";
import { startChatServer, type ChatStore } from "../src/server.ts";
import { buildCardPackageZip } from "./build-package.ts";
import { createMemoryCardImportStore } from "./memory-card-import-store.ts";

const TOKEN = "qbot-fixture-token-not-a-secret";
const OWNER = "00000000-0000-4000-8000-000000000001";
const HTML = Buffer.from("<!doctype html><main>公开卡片正文</main>", "utf8");

type FakeAgent = {
  id: string;
  ownerId: string;
  slug: string;
  displayName: string;
  visibility: "public" | "private" | null;
};

type FakeCard = {
  id: string;
  agentId: string;
  visibility: "public" | "followers";
  title: string;
  publishedAt: Date;
  provenance: "manual" | "agent" | "scheduled";
  artifactId: string | null;
};

function createFakeFeedPool(agents: FakeAgent[], seededCards: FakeCard[] = []) {
  const cards = new Map<string, FakeCard>(seededCards.map((c) => [c.id, c]));

  const query = async (sql: string, params: unknown[] = []) => {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
      return { rows: [], rowCount: 0 };
    }
    if (text.startsWith("SELECT c.id FROM cards c JOIN agents g ON g.id = c.agent_id WHERE c.id = $1 AND g.owner_id = $2")) {
      const [cardId, ownerId] = params as [string, string];
      const card = cards.get(cardId);
      const agent = card ? agents.find((a) => a.id === card.agentId && a.ownerId === ownerId) : undefined;
      return { rows: agent && card ? [{ id: card.id }] : [], rowCount: agent && card ? 1 : 0 };
    }
    if (text.startsWith("DELETE FROM artifact_capabilities")) return { rows: [], rowCount: 0 };
    if (text.startsWith("DELETE FROM artifact_files")) return { rows: [], rowCount: 0 };
    if (text.startsWith("UPDATE cards SET artifact_id = NULL")) {
      const card = cards.get(String(params[0]));
      if (card) card.artifactId = null;
      return { rows: [], rowCount: card ? 1 : 0 };
    }
    if (text.startsWith("DELETE FROM artifacts WHERE card_id = $1")) return { rows: [], rowCount: 0 };
    if (text.startsWith("DELETE FROM cards WHERE id = $1")) {
      const existed = cards.delete(String(params[0]));
      return { rows: [], rowCount: existed ? 1 : 0 };
    }
    throw new Error(`unexpected SQL in fake pool: ${text}`);
  };

  const pool = {
    query,
    async connect() {
      return { query, release() {} };
    },
  } as unknown as pg.Pool;

  return { pool, cards };
}

function createMemoryChatStore(): ChatStore {
  const conversations = new Map<string, { id: string; ownerId: string; title: string; createdAt: string; updatedAt: string }>();
  return {
    async health() { return true; },
    async ensureOwner() {},
    async ensureAgent(_ownerId, _persona, model) { return { id: "00000000-0000-4000-8000-0000000000a1", model }; },
    async getAgent() { return { id: "00000000-0000-4000-8000-0000000000a1", model: "deepseek/deepseek-v4.1-flash-1017" }; },
    async failStaleRuns() {},
    async listConversations(ownerId) {
      return [...conversations.values()].filter((c) => c.ownerId === ownerId).map(({ ownerId: _o, ...rest }) => rest);
    },
    async getConversation(ownerId, id) {
      const found = conversations.get(id);
      if (!found || found.ownerId !== ownerId) return null;
      const { ownerId: _o, ...rest } = found;
      return rest;
    },
    async createConversation(ownerId, title) {
      const now = new Date().toISOString();
      const entry = { id: randomUUID(), ownerId, title, createdAt: now, updatedAt: now };
      conversations.set(entry.id, entry);
      const { ownerId: _o, ...rest } = entry;
      return rest;
    },
    async renameConversation(ownerId, id, title) {
      const found = conversations.get(id);
      if (!found || found.ownerId !== ownerId) return null;
      found.title = title;
      found.updatedAt = new Date().toISOString();
      const { ownerId: _o, ...rest } = found;
      return rest;
    },
    async deleteConversation(ownerId, id) {
      const found = conversations.get(id);
      if (!found || found.ownerId !== ownerId) return false;
      return conversations.delete(id);
    },
    async listMessages() { return []; },
    async beginTurn() { throw new Error("unused"); },
    async finishTurn() {},
    async setDshSession() {},
  };
}

function stubRuntime(): ConversationEngine {
  return { engine: "dsh", id: "fixture", run() { throw new Error("unused"); }, async close() {} };
}

function baseEnv(extra: Record<string, string> = {}) {
  return loadConfig({
    DATABASE_URL: "postgres://qbot:qbot@127.0.0.1:5432/qbot",
    QBOT_OWNER_ID: OWNER,
    QBOT_ACCESS_TOKEN: TOKEN,
    OPENROUTER_API_KEY: "fixture-openrouter-key-not-a-secret",
    HOST: "127.0.0.1",
    PORT: "0",
    QBOT_FIXTURE_UPSTREAM: "1",
    QBOT_FIXTURE_UPSTREAM_URL: "http://127.0.0.1:9/v1/chat/completions",
    ...extra,
  });
}

async function pollImport(base: string, importId: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 60; i += 1) {
    const res = await fetch(`${base}/v1/card-imports/${importId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    if (body.state === "ready" || body.state === "rejected" || body.state === "staged") return body;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out polling import");
}

test("POST /v1/cards is deleted, card-import write paths stay closed under open flags, DELETE enforces Bearer, and hybrid STS writes under qbot/cards/", async () => {
  const publicBotId = "00000000-0000-4000-8000-0000000000b1";
  const privateBotId = "00000000-0000-4000-8000-0000000000b2";
  const seededCardId = "00000000-0000-4000-8000-0000000000c9";
  const fake = createFakeFeedPool(
    [
      { id: publicBotId, ownerId: OWNER, slug: "qbot", displayName: "Qbot", visibility: "public" },
      { id: privateBotId, ownerId: OWNER, slug: "secret-bot", displayName: "Secret", visibility: "private" },
    ],
    [
      { id: seededCardId, agentId: publicBotId, visibility: "public", title: "测试卡", publishedAt: new Date(), provenance: "manual", artifactId: null },
    ],
  );
  const memImports = createMemoryCardImportStore([
    { id: publicBotId, ownerId: OWNER, slug: "qbot", visibility: "public" },
    { id: privateBotId, ownerId: OWNER, slug: "secret-bot", visibility: "private" },
  ]);

  const root = mkdtempSync(path.join(tmpdir(), "qbot-open-cards-"));
  const innerStore = createLocalObjectStore(root);
  const writes: string[] = [];
  const spyObjects: ObjectStore = {
    read: innerStore.read,
    async write(artifactId, version, relPath, bytes, contentType) {
      writes.push(`${artifactId}/v${version}/${relPath}`);
      return innerStore.write!(artifactId, version, relPath, bytes, contentType);
    },
  };

  const pkg = buildCardPackageZip({ cardKey: "open-flag-check", contentVersion: 1, idempotencyKey: "open-flag-idem-1" });

  // 1. QBOT_FEED_OPEN=1 + QBOT_PERSONAL_OPEN=1 -> POST /v1/cards is gone (404), card-import routes remain 401 without Bearer.
  const openServer = await startChatServer({
    config: baseEnv({ QBOT_FEED_OPEN: "1", QBOT_PERSONAL_OPEN: "1", QBOT_OBJECT_ROOT: root }),
    store: createMemoryChatStore(),
    runtime: stubRuntime(),
    pool: fake.pool,
    objects: spyObjects,
    cardImports: memImports.store,
  });
  const openBase = `http://127.0.0.1:${openServer.port}`;
  try {
    assert.equal((await fetch(`${openBase}/v1/cards`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "removed" }),
    })).status, 404);
    assert.equal((await fetch(`${openBase}/v1/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "removed" }),
    })).status, 404);

    // Unauthenticated card-import, publish, rollback MUST return 401 even when both open flags are set.
    assert.equal((await fetch(`${openBase}/v1/card-imports`, {
      method: "POST",
      headers: { "Content-Type": "application/zip", "Idempotency-Key": pkg.idempotencyKey },
      body: new Uint8Array(pkg.zip),
    })).status, 401);
    assert.equal((await fetch(`${openBase}/v1/card-imports/${randomUUID()}`)).status, 401);
    assert.equal((await fetch(`${openBase}/v1/card-imports/${randomUUID()}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedPreviousVersion: null }),
    })).status, 401);
    assert.equal((await fetch(`${openBase}/v1/card-imports/${randomUUID()}/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })).status, 401);
    assert.equal(writes.length, 0);

    // DELETE /v1/cards/:id MUST still require Bearer even when QBOT_FEED_OPEN=1.
    assert.equal((await fetch(`${openBase}/v1/cards/${seededCardId}`, { method: "DELETE" })).status, 404);
    assert.equal((await fetch(`${openBase}/v1/cards/${seededCardId}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer invalid-token-not-matching" },
    })).status, 404);
    assert.equal(fake.cards.has(seededCardId), true);

    const deleted = await fetch(`${openBase}/v1/cards/${seededCardId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(deleted.status, 204);
    assert.equal(fake.cards.has(seededCardId), false);
  } finally {
    await openServer.close();
  }

  // 2. QBOT_FEED_OPEN=1 + QBOT_OSS_PUBLIC=1 (read-only storage) -> authenticated POST /v1/card-imports returns 503 storage_readonly;
  //    unauthenticated returns 401.
  const readonlyServer = await startChatServer({
    config: baseEnv({
      QBOT_FEED_OPEN: "1",
      QBOT_OSS_PUBLIC: "1",
      QBOT_OSS_PUBLIC_ORIGIN: "https://cards.example.invalid",
      QBOT_IMPORT_DIR: mkdtempSync(path.join(tmpdir(), "qbot-ro-zips-")),
    }),
    store: createMemoryChatStore(),
    runtime: stubRuntime(),
    pool: fake.pool,
    cardImports: memImports.store,
  });
  const readonlyBase = `http://127.0.0.1:${readonlyServer.port}`;
  try {
    assert.equal((await fetch(`${readonlyBase}/v1/card-imports`, {
      method: "POST",
      headers: { "Content-Type": "application/zip", "Idempotency-Key": pkg.idempotencyKey },
      body: new Uint8Array(pkg.zip),
    })).status, 401);

    const bearerRo = await fetch(`${readonlyBase}/v1/card-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": pkg.idempotencyKey },
      body: new Uint8Array(pkg.zip),
    });
    assert.equal(bearerRo.status, 503);
    assert.equal(((await bearerRo.json()) as { error?: { code?: string } }).error?.code, "storage_readonly");
  } finally {
    await readonlyServer.close();
  }

  // 3. Coexisting QBOT_OSS_PUBLIC=1 (public read) + ECS RAM role STS (authorized PutObject write under qbot/cards/)
  const stsPuts: { url: string; sts: string | null; acl: string | null }[] = [];
  const hybridImportDir = mkdtempSync(path.join(tmpdir(), "qbot-hybrid-zips-"));
  const hybridConfig = baseEnv({
    QBOT_FEED_OPEN: "1",
    QBOT_OSS_PUBLIC: "1",
    QBOT_OSS_PUBLIC_ORIGIN: "https://cards.example.invalid",
    QBOT_OSS_ENDPOINT: "https://oss.example.invalid",
    QBOT_OSS_BUCKET: "cards",
    QBOT_OSS_ECS_RAM_ROLE: "qbot-cards-writer",
    QBOT_OSS_ECS_METADATA_ORIGIN: "http://127.0.0.1:18080",
    QBOT_IMPORT_DIR: hybridImportDir,
  });
  const hybridObjects = createObjectStore(
    { objectRoot: hybridConfig.objectRoot, publicOss: hybridConfig.publicOss, oss: hybridConfig.oss },
    async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (url === "http://127.0.0.1:18080/latest/api/token") {
        return new Response("imds-token", { status: 200 });
      }
      if (url === "http://127.0.0.1:18080/latest/meta-data/ram/security-credentials/qbot-cards-writer") {
        return new Response(JSON.stringify({
          Code: "Success",
          AccessKeyId: "STS.hybrid-id",
          AccessKeySecret: "hybrid-secret",
          SecurityToken: "hybrid-sts-token",
          Expiration: new Date(Date.now() + 60 * 60_000).toISOString(),
        }), { status: 200 });
      }
      if (init?.method === "PUT") {
        stsPuts.push({
          url,
          sts: headers.get("x-oss-security-token"),
          acl: headers.get("x-oss-object-acl"),
        });
        return new Response(null, { status: 200 });
      }
      return new Response(HTML, { status: 200 });
    },
  );
  const hybridServer = await startChatServer({
    config: hybridConfig,
    store: createMemoryChatStore(),
    runtime: stubRuntime(),
    pool: fake.pool,
    objects: hybridObjects,
    cardImports: memImports.store,
  });
  const hybridBase = `http://127.0.0.1:${hybridServer.port}`;
  try {
    const res = await fetch(`${hybridBase}/v1/card-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": pkg.idempotencyKey },
      body: new Uint8Array(pkg.zip),
    });
    assert.equal(res.status, 202);
    const { importId } = await res.json() as { importId: string };
    const finalStatus = await pollImport(hybridBase, importId);
    assert.equal(finalStatus.state, "ready", JSON.stringify(finalStatus));
    assert.equal(stsPuts.length, 4);
    assert.equal(stsPuts.every((put) => put.url.startsWith("https://cards.oss.example.invalid/qbot/cards/")), true);
    assert.equal(stsPuts.every((put) => put.sts === "hybrid-sts-token" && put.acl === null), true);
  } finally {
    await hybridServer.close();
  }
});

test("PATCH and DELETE /v1/conversations/:id obey QBOT_PERSONAL_OPEN independently of QBOT_FEED_OPEN", async () => {
  const memStore = createMemoryChatStore();
  const seeded = await memStore.createConversation(OWNER, "初始标题");

  // QBOT_PERSONAL_OPEN=0 (even with QBOT_FEED_OPEN=1) -> 401 without Bearer, 200/204 with Bearer
  const closedChat = await startChatServer({
    config: baseEnv({ QBOT_FEED_OPEN: "1" }),
    store: memStore,
    runtime: stubRuntime(),
  });
  const closedBase = `http://127.0.0.1:${closedChat.port}`;
  try {
    assert.equal((await fetch(`${closedBase}/v1/conversations/${seeded.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "无令牌改名" }),
    })).status, 401);
    assert.equal((await fetch(`${closedBase}/v1/conversations/${seeded.id}`, {
      method: "DELETE",
    })).status, 401);

    const authPatch = await fetch(`${closedBase}/v1/conversations/${seeded.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "令牌改名" }),
    });
    assert.equal(authPatch.status, 200);
    assert.equal(((await authPatch.json()) as { title: string }).title, "令牌改名");
  } finally {
    await closedChat.close();
  }

  // QBOT_PERSONAL_OPEN=1 -> PATCH and DELETE succeed without Bearer
  const openChat = await startChatServer({
    config: baseEnv({ QBOT_PERSONAL_OPEN: "1" }),
    store: memStore,
    runtime: stubRuntime(),
  });
  const openBase = `http://127.0.0.1:${openChat.port}`;
  try {
    const patchRes = await fetch(`${openBase}/v1/conversations/${seeded.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "免登录改名" }),
    });
    assert.equal(patchRes.status, 200);
    assert.equal(((await patchRes.json()) as { title: string }).title, "免登录改名");

    const delRes = await fetch(`${openBase}/v1/conversations/${seeded.id}`, {
      method: "DELETE",
    });
    assert.equal(delRes.status, 204);
    assert.equal((await fetch(`${openBase}/v1/conversations/${seeded.id}`)).status, 404);
  } finally {
    await openChat.close();
  }
});
