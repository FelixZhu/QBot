import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type pg from "pg";
import { loadConfig } from "../src/config.ts";
import { createLocalObjectStore, createObjectStore, type ObjectStore } from "../src/feed/objects.ts";
import { startChatServer, type ChatStore } from "../src/server.ts";
import type { ConversationEngine } from "../src/runtime/dsh.ts";

const TOKEN = "qbot-fixture-token-not-a-secret";
const OWNER = "00000000-0000-4000-8000-000000000001";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
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

type FakeArtifact = {
  id: string;
  cardId: string;
  version: number;
  manifestSha256: string;
};

type FakeFile = {
  artifactId: string;
  relPath: string;
  sha256: string;
  byteLength: number;
  contentType: string;
  role: "cover" | "page" | "asset";
};

function createFakeFeedPool(agents: FakeAgent[]) {
  const cards = new Map<string, FakeCard>();
  const artifacts = new Map<string, FakeArtifact>();
  const files: FakeFile[] = [];
  const follows = new Set<string>();

  const query = async (sql: string, params: unknown[] = []) => {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
      return { rows: [], rowCount: 0 };
    }
    if (text.startsWith("SELECT 1 FROM agents WHERE owner_id = $1 AND slug = $2")) {
      const publicOnly = text.includes("visibility = 'public'");
      const hit = agents.find((a) => a.ownerId === params[0] && a.slug === params[1] && (!publicOnly || a.visibility === "public"));
      return { rows: hit ? [{ "?column?": 1 }] : [], rowCount: hit ? 1 : 0 };
    }
    if (text.startsWith("SELECT id FROM agents WHERE owner_id = $1 AND slug = $2")) {
      const publicOnly = text.includes("visibility = 'public'");
      const hit = agents.find((a) => a.ownerId === params[0] && a.slug === params[1] && (!publicOnly || a.visibility === "public"));
      return { rows: hit ? [{ id: hit.id }] : [], rowCount: hit ? 1 : 0 };
    }
    if (text.startsWith("INSERT INTO cards")) {
      const [id, agentId, visibility, title, , provenance] = params as [string, string, "public" | "followers", string, string, "manual" | "agent" | "scheduled"];
      cards.set(id, { id, agentId, visibility, title, publishedAt: new Date(), provenance, artifactId: null });
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("INSERT INTO artifacts")) {
      const [id, cardId, version, manifestSha256] = params as [string, string, number, string];
      artifacts.set(id, { id, cardId, version, manifestSha256 });
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("INSERT INTO artifact_files")) {
      const [artifactId, relPath, sha256, byteLength, contentType, role] = params as [string, string, string, number, string, "cover" | "page" | "asset"];
      files.push({ artifactId, relPath, sha256, byteLength, contentType, role });
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("UPDATE cards SET artifact_id = $2 WHERE id = $1")) {
      const card = cards.get(String(params[0]));
      if (card) card.artifactId = String(params[1]);
      return { rows: [], rowCount: card ? 1 : 0 };
    }
    if (text.startsWith("SELECT c.id, c.title, c.published_at") && text.includes("WHERE c.id = $2")) {
      const [ownerId, cardId] = params as [string, string];
      const card = cards.get(cardId);
      if (!card || !card.artifactId) return { rows: [], rowCount: 0 };
      const artifact = artifacts.get(card.artifactId);
      const agent = agents.find((a) => a.id === card.agentId);
      if (!artifact || !agent) return { rows: [], rowCount: 0 };
      const artFiles = files.filter((f) => f.artifactId === artifact.id && f.role === "cover");
      const cover = artFiles.find((f) => /^cover\./.test(f.relPath)) ?? artFiles[0];
      if (!cover) return { rows: [], rowCount: 0 };
      const coverLight = artFiles.find((f) => /^cover-light\./.test(f.relPath))?.relPath ?? null;
      const coverDark = artFiles.find((f) => /^cover-dark\./.test(f.relPath))?.relPath ?? null;
      return {
        rows: [{
          id: card.id,
          title: card.title,
          published_at: card.publishedAt,
          visibility: card.visibility,
          provenance: card.provenance,
          artifact_id: artifact.id,
          version: artifact.version,
          manifest_sha256: artifact.manifestSha256,
          cover_path: cover.relPath,
          cover_light_path: coverLight,
          cover_dark_path: coverDark,
          agent_id: agent.id,
          agent_visibility: agent.visibility,
          slug: agent.slug,
          display_name: agent.displayName,
          followed: follows.has(`${ownerId}:${agent.id}`),
        }],
        rowCount: 1,
      };
    }
    if (text.startsWith("SELECT rel_path, sha256, byte_length, content_type, role FROM artifact_files")) {
      const artFiles = files.filter((f) => f.artifactId === params[0]).sort((a, b) => a.relPath.localeCompare(b.relPath));
      return {
        rows: artFiles.map((f) => ({
          rel_path: f.relPath,
          sha256: f.sha256,
          byte_length: f.byteLength,
          content_type: f.contentType,
          role: f.role,
        })),
        rowCount: artFiles.length,
      };
    }
    if (text.startsWith("SELECT c.id FROM cards c JOIN agents g ON g.id = c.agent_id WHERE c.id = $1 AND g.owner_id = $2")) {
      const [cardId, ownerId] = params as [string, string];
      const card = cards.get(cardId);
      const agent = card ? agents.find((a) => a.id === card.agentId && a.ownerId === ownerId) : undefined;
      return { rows: agent && card ? [{ id: card.id }] : [], rowCount: agent && card ? 1 : 0 };
    }
    if (text.startsWith("DELETE FROM artifact_capabilities")) return { rows: [], rowCount: 0 };
    if (text.startsWith("DELETE FROM artifact_files")) {
      const cardId = String(params[0]);
      const artIds = new Set([...artifacts.values()].filter((a) => a.cardId === cardId).map((a) => a.id));
      for (let i = files.length - 1; i >= 0; i -= 1) {
        if (artIds.has(files[i]!.artifactId)) files.splice(i, 1);
      }
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("UPDATE cards SET artifact_id = NULL WHERE id = $1")) {
      const card = cards.get(String(params[0]));
      if (card) card.artifactId = null;
      return { rows: [], rowCount: card ? 1 : 0 };
    }
    if (text.startsWith("DELETE FROM artifacts WHERE card_id = $1")) {
      const cardId = String(params[0]);
      for (const [id, art] of artifacts) {
        if (art.cardId === cardId) artifacts.delete(id);
      }
      return { rows: [], rowCount: 1 };
    }
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

  return { pool, cards, follows };
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

function cardBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: "公开测试卡",
    provenance: "agent",
    files: [
      { path: "cover.png", contentBase64: PNG.toString("base64") },
      { path: "index.html", contentBase64: HTML.toString("base64") },
    ],
    ...overrides,
  });
}

test("POST /v1/cards open-mode isolation, DELETE bearer enforcement, and readonly 503", async () => {
  const publicBotId = "00000000-0000-4000-8000-0000000000b1";
  const privateBotId = "00000000-0000-4000-8000-0000000000b2";
  const nullVisBotId = "00000000-0000-4000-8000-0000000000b3";
  const fake = createFakeFeedPool([
    { id: publicBotId, ownerId: OWNER, slug: "qbot", displayName: "Qbot", visibility: "public" },
    { id: privateBotId, ownerId: OWNER, slug: "secret-bot", displayName: "Secret", visibility: "private" },
    { id: nullVisBotId, ownerId: OWNER, slug: "draft-bot", displayName: "Draft", visibility: null },
  ]);
  fake.follows.add(`${OWNER}:${publicBotId}`);

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

  // 1. QBOT_FEED_OPEN=1 + writable object store
  const openServer = await startChatServer({
    config: baseEnv({ QBOT_FEED_OPEN: "1", QBOT_OBJECT_ROOT: root }),
    store: createMemoryChatStore(),
    runtime: stubRuntime(),
    pool: fake.pool,
    objects: spyObjects,
  });
  const openBase = `http://127.0.0.1:${openServer.port}`;
  try {
    // Reject non-public visibilities without Bearer (404, zero object writes)
    for (const badVisibility of ["followers", "private", null, "unknown"]) {
      const res = await fetch(`${openBase}/v1/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: cardBody({ visibility: badVisibility }),
      });
      assert.equal(res.status, 404, `visibility=${String(badVisibility)}`);
    }
    // Reject non-public bots without Bearer (404, zero object writes)
    for (const badBot of ["secret-bot", "draft-bot", "nonexistent-bot"]) {
      const res = await fetch(`${openBase}/v1/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: cardBody({ botSlug: badBot, visibility: "public" }),
      });
      assert.equal(res.status, 404, `botSlug=${badBot}`);
    }
    assert.equal(writes.length, 0);

    // Allow public bot + explicit public visibility without Bearer
    const pubExplicit = await fetch(`${openBase}/v1/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: cardBody({ visibility: "public" }),
    });
    assert.equal(pubExplicit.status, 201);
    const createdPublic = await pubExplicit.json() as { id: string; visibility: string };
    assert.equal(createdPublic.visibility, "public");
    assert.equal(writes.length, 2);

    // Allow public bot + omitted visibility (defaults to public) without Bearer
    const pubDefault = await fetch(`${openBase}/v1/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: cardBody(),
    });
    assert.equal(pubDefault.status, 201);

    // Bearer can still publish followers-only card on public bot
    const followersByBearer = await fetch(`${openBase}/v1/cards`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: cardBody({ visibility: "followers" }),
    });
    assert.equal(followersByBearer.status, 201);

    // DELETE /v1/cards/:id MUST still require Bearer even when QBOT_FEED_OPEN=1
    assert.equal((await fetch(`${openBase}/v1/cards/${createdPublic.id}`, { method: "DELETE" })).status, 404);
    assert.equal((await fetch(`${openBase}/v1/cards/${createdPublic.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer invalid-token-not-matching" },
    })).status, 404);
    assert.equal(fake.cards.has(createdPublic.id), true);

    // Valid Bearer deletes the card
    const deleted = await fetch(`${openBase}/v1/cards/${createdPublic.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(deleted.status, 204);
    assert.equal(fake.cards.has(createdPublic.id), false);
  } finally {
    await openServer.close();
  }

  // 2. QBOT_FEED_OPEN=1 + QBOT_OSS_PUBLIC=1 (production readonly mode) -> 503 storage_readonly
  const readonlyServer = await startChatServer({
    config: baseEnv({
      QBOT_FEED_OPEN: "1",
      QBOT_OSS_PUBLIC: "1",
      QBOT_OSS_PUBLIC_ORIGIN: "https://cards.example.invalid",
    }),
    store: createMemoryChatStore(),
    runtime: stubRuntime(),
    pool: fake.pool,
  });
  const readonlyBase = `http://127.0.0.1:${readonlyServer.port}`;
  try {
    const anonWrite = await fetch(`${readonlyBase}/v1/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: cardBody(),
    });
    assert.equal(anonWrite.status, 503);
    assert.equal(((await anonWrite.json()) as { error?: { code?: string } }).error?.code, "storage_readonly");

    const bearerWrite = await fetch(`${readonlyBase}/v1/cards`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: cardBody(),
    });
    assert.equal(bearerWrite.status, 503);
    assert.equal(((await bearerWrite.json()) as { error?: { code?: string } }).error?.code, "storage_readonly");
  } finally {
    await readonlyServer.close();
  }

  // 3. QBOT_FEED_OPEN=1 + coexisting QBOT_OSS_PUBLIC=1 (public read) + ECS RAM role STS (authorized write)
  const stsPuts: { url: string; sts: string | null; acl: string | null }[] = [];
  const hybridConfig = baseEnv({
    QBOT_FEED_OPEN: "1",
    QBOT_OSS_PUBLIC: "1",
    QBOT_OSS_PUBLIC_ORIGIN: "https://cards.example.invalid",
    QBOT_OSS_ENDPOINT: "https://oss.example.invalid",
    QBOT_OSS_BUCKET: "cards",
    QBOT_OSS_ECS_RAM_ROLE: "qbot-cards-writer",
    QBOT_OSS_ECS_METADATA_ORIGIN: "http://127.0.0.1:18080",
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
  });
  try {
    const res = await fetch(`http://127.0.0.1:${hybridServer.port}/v1/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: cardBody({ title: "ECS STS 公开写入卡" }),
    });
    assert.equal(res.status, 201);
    const created = await res.json() as { artifactId: string };
    assert.equal(stsPuts.length, 2);
    assert.equal(stsPuts.every((put) => put.url.startsWith(`https://cards.oss.example.invalid/qbot/cards/${created.artifactId}/v1/`)), true);
    assert.equal(stsPuts.every((put) => put.sts === "hybrid-sts-token" && put.acl === null), true);
  } finally {
    await hybridServer.close();
  }

  // 4. QBOT_FEED_OPEN=0 -> unauthenticated POST and DELETE rejected with 401
  const closedFeedServer = await startChatServer({
    config: baseEnv({ QBOT_PERSONAL_OPEN: "1", QBOT_OBJECT_ROOT: root }),
    store: createMemoryChatStore(),
    runtime: stubRuntime(),
    pool: fake.pool,
  });
  const closedFeedBase = `http://127.0.0.1:${closedFeedServer.port}`;
  try {
    assert.equal((await fetch(`${closedFeedBase}/v1/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: cardBody(),
    })).status, 401);
    assert.equal((await fetch(`${closedFeedBase}/v1/cards/00000000-0000-4000-8000-0000000000c1`, {
      method: "DELETE",
    })).status, 401);
  } finally {
    await closedFeedServer.close();
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
