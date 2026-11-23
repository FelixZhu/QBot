import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.ts";
import { createPool } from "../src/db.ts";
import { applyMigrations } from "../src/migrate.ts";
import { SERVER_PERSONA } from "../src/runtime/persona.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createDshEngine, openaiBase, type ConversationEngine } from "../src/runtime/dsh.ts";
import { assessDatabase, assessmentProblems } from "../src/check-db.ts";
import { startChatServer, type ChatStore } from "../src/server.ts";
import { createStore } from "../src/store.ts";
import { startFixture, readSse, type FixtureHit } from "./fixture-upstream.ts";

const TOKEN = "qbot-fixture-token-not-a-secret";
const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

test("personal mode is off unless the private flag is exactly 1", async () => {
  const runtimeUrl = requiredEnv("DATABASE_URL");
  const migrateUrl = requiredEnv("DATABASE_MIGRATE_URL");
  const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  await applyMigrations({ runtimeUrl, migrateUrl, directory });
  const base = {
    DATABASE_URL: runtimeUrl,
    QBOT_OWNER_ID: OWNER,
    OPENROUTER_API_KEY: "fixture-openrouter-key-not-a-secret",
    HOST: "127.0.0.1",
    PORT: "0",
    QBOT_FIXTURE_UPSTREAM: "1",
    QBOT_FIXTURE_UPSTREAM_URL: "http://127.0.0.1:9/v1/chat/completions",
  };
  assert.equal(loadConfig({ ...base, QBOT_ACCESS_TOKEN: TOKEN }).personalOpen, false);
  assert.equal(loadConfig({ ...base, QBOT_ACCESS_TOKEN: TOKEN, QBOT_PERSONAL_OPEN: "yes" }).personalOpen, false);
  assert.equal(loadConfig({ ...base, QBOT_PERSONAL_OPEN: "1" }).personalOpen, true);
  const pool = createPool(runtimeUrl);
  const store = createStore(pool);
  const runtime = { engine: "dsh", id: "fixture", run() { throw new Error("unused"); }, async close() {} } as ConversationEngine;
  const closed = await startChatServer({ config: loadConfig({ ...base, QBOT_ACCESS_TOKEN: TOKEN, PORT: "0" }), store, runtime });
  try {
    const denied = await fetch(`http://127.0.0.1:${closed.port}/v1/session`);
    assert.equal(denied.status, 401);
    const body = await denied.text();
    assert.equal(body.includes(TOKEN), false);
  } finally {
    await closed.close();
  }
  const open = await startChatServer({ config: loadConfig({ ...base, QBOT_PERSONAL_OPEN: "1", PORT: "0" }), store, runtime });
  try {
    const session = await fetch(`http://127.0.0.1:${open.port}/v1/session`);
    assert.equal(session.status, 200);
    const body = await session.text();
    assert.equal(body.includes("fixture-openrouter-key"), false);
    assert.match(body, /"upstream":"fixture"/);
  } finally {
    await open.close();
    await pool.end();
  }
});

test("streamTurn aborts the runtime on upstream timeout and settles as failed", async () => {
  const config = loadConfig({
    DATABASE_URL: "postgres://qbot:qbot@127.0.0.1:5432/qbot",
    QBOT_OWNER_ID: OWNER,
    QBOT_ACCESS_TOKEN: TOKEN,
    OPENROUTER_API_KEY: "fixture-openrouter-key-not-a-secret",
    HOST: "127.0.0.1",
    PORT: "0",
    QBOT_FIXTURE_UPSTREAM: "1",
    QBOT_FIXTURE_UPSTREAM_URL: "http://127.0.0.1:9/v1/chat/completions",
  });
  let finishedStatus: string | null = null;
  let signalAborted = false;
  const store: ChatStore = {
    async health() { return true; },
    async ensureOwner() {},
    async ensureAgent() { return { id: "00000000-0000-4000-8000-0000000000a1", model: config.model }; },
    async getAgent() { return { id: "00000000-0000-4000-8000-0000000000a1", model: config.model }; },
    async failStaleRuns() {},
    async listConversations() { return []; },
    async createConversation() { throw new Error("unused"); },
    async listMessages() { return []; },
    async beginTurn() {
      return {
        assistantId: "00000000-0000-4000-8000-0000000000b1",
        runId: "00000000-0000-4000-8000-0000000000b2",
        persona: SERVER_PERSONA,
        model: config.model,
        dshSessionId: null,
        history: [],
      };
    },
    async finishTurn(_ownerId: string, _assistantId: string, _runId: string, status: "complete" | "failed" | "cancelled") {
      finishedStatus = status;
    },
    async setDshSession() {},
  };
  const runtime: ConversationEngine = {
    engine: "dsh",
    id: "fixture",
    run(turn) {
      const iter = (async function* () {
        await new Promise<void>((_, reject) => {
          const onAbort = () => {
            signalAborted = true;
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            reject(err);
          };
          if (turn.signal.aborted) onAbort();
          else turn.signal.addEventListener("abort", onAbort, { once: true });
        });
        yield "";
      })();
      return Object.assign(iter, { sessionId: () => null });
    },
    async close() {},
  };
  const started = await startChatServer({ config, store, runtime, upstreamTimeoutMs: 50 });
  try {
    const res = await fetch(`http://127.0.0.1:${started.port}/v1/conversations/00000000-0000-4000-8000-0000000000c9/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "ping" }),
    });
    assert.equal(res.status, 502);
    assert.match(await res.text(), /模型上游超时/);
    assert.equal(signalAborted, true);
    assert.equal(finishedStatus, "failed");
  } finally {
    await started.close();
  }
});

test("authenticated SSE persists a server-owned run and reloads it", { timeout: 180_000 }, async () => {
  const runtimeUrl = requiredEnv("DATABASE_URL");
  const migrateUrl = requiredEnv("DATABASE_MIGRATE_URL");
  const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  await applyMigrations({ runtimeUrl, migrateUrl, directory });
  const second = await applyMigrations({ runtimeUrl, migrateUrl, directory });
  assert.deepEqual(second, []);

  const found = await assessDatabase(runtimeUrl);
  assert.deepEqual(assessmentProblems(found, false), []);
  assert.equal(found.superuser, false);
  assert.ok(found.vectorVersion);
  assert.equal(atLeast(found.vectorVersion, "0.8.7"), true, found.vectorVersion);

  const runtimePool = createPool(runtimeUrl);
  const migratePool = createPool(migrateUrl);
  for (const table of [
    "artifact_capabilities",
    "artifact_files",
    "artifacts",
    "cards",
    "follows",
    "owner_bootstrap",
    "messages",
    "runs",
    "conversations",
    "agents",
    "owners",
  ]) {
    await runtimePool.query(`DELETE FROM ${table}`);
  }
  await assert.rejects(() => runtimePool.query("CREATE EXTENSION qbot_absent_extension"));

  const fixture = await startFixture();
  const config = loadConfig({
    DATABASE_URL: runtimeUrl,
    QBOT_OWNER_ID: OWNER,
    QBOT_ACCESS_TOKEN: TOKEN,
    OPENROUTER_API_KEY: fixture.expectedKey,
    HOST: "127.0.0.1",
    PORT: "0",
    QBOT_FIXTURE_UPSTREAM: "1",
    QBOT_FIXTURE_UPSTREAM_URL: fixture.url,
  });
  const store = createStore(runtimePool);
  const started = await startChatServer({
    config,
    store,
    runtime: createDshEngine({
      model: config.model,
      persona: SERVER_PERSONA,
      apiKey: fixture.expectedKey,
      fixture: true,
      openaiBaseUrl: openaiBase(fixture.url, true),
      dshHome: mkdtempSync(path.join(tmpdir(), "qbot-dsh-")),
    }),
  });
  const base = `http://127.0.0.1:${started.port}`;
  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, postgres: "up" });
    assert.equal((await fetch(`${base}/v1/session`)).status, 401);

    const session = await api(base, "/v1/session");
    assert.equal(session.status, 200);
    const sessionBody = await session.json() as { ownerId: string; agentId: string; model: string; upstream: string };
    assert.equal(sessionBody.ownerId, OWNER);
    assert.equal(sessionBody.model, "deepseek/deepseek-v4.1-flash-1017");
    assert.equal(sessionBody.upstream, "fixture");
    assert.match(sessionBody.agentId, /^[0-9a-f-]{36}$/i);

    for (const extra of ["model", "messages", "role", "system", "owner", "ownerId", "persona", "kind"]) {
      const rejected = await api(base, "/v1/conversations", {
        method: "POST",
        body: JSON.stringify({ title: "新对话", [extra]: "client-supplied" }),
      });
      assert.equal(rejected.status, 400, extra);
    }
    assert.equal(fixture.hits.length, 0);

    const created = await api(base, "/v1/conversations", { method: "POST", body: "{}" });
    assert.equal(created.status, 201);
    const conversation = await created.json() as { id: string };
    const posted = await api(base, `/v1/conversations/${conversation.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ text: "你好" }),
    });
    assert.equal(posted.status, 200, await posted.clone().text());
    assert.match(posted.headers.get("content-type") ?? "", /text\/event-stream/);
    const events = await readSse(posted);
    assert.equal(events.at(-1), "[DONE]");
    const text = events.filter((event) => event !== "[DONE]").join("\n");
    assert.match(text, /夹具固定句/);
    assert.equal(text.includes("演示回复"), false);

    const hit = fixture.hits.at(-1) as FixtureHit;
    assert.equal(hit.authorization, `Bearer ${fixture.expectedKey}`);
    assert.equal(hit.authorization?.includes(TOKEN), false);
    const upstream = hit.body as { model: string; messages: { role: string; content: string }[] };
    assert.equal(upstream.model, "deepseek/deepseek-v4.1-flash-1017");
    assert.equal(upstream.messages.some((message) => message.role === "system" && message.content.includes("You have no tools")), true);
    assert.equal(upstream.messages.some((message) => message.content === "你好"), true);
    assert.equal(upstream.messages.some((message) => message.role === "system" && message.content.includes(TOKEN)), false);

    const history = await api(base, `/v1/conversations/${conversation.id}/messages`);
    const messages = (await history.json() as { messages: { role: string; content: string; status: string }[] }).messages;
    assert.deepEqual(messages.map((message) => [message.role, message.status, message.content]), [
      ["user", "complete", "你好"],
      ["assistant", "complete", "夹具固定句"],
    ]);

    const runs = await runtimePool.query<{ owner_id: string; kind: string; status: string }>(
      "SELECT owner_id, kind, status FROM runs",
    );
    assert.deepEqual(runs.rows, [{ owner_id: OWNER, kind: "interactive", status: "complete" }]);

    await migratePool.query(
      "INSERT INTO owners (id) VALUES ($1) ON CONFLICT DO NOTHING",
      [OTHER],
    );
    await migratePool.query(
      `INSERT INTO agents (id, owner_id, slug, persona, model)
       VALUES ($1, $2, 'qbot', 'other persona', 'other/model')`,
      ["00000000-0000-4000-8000-000000000099", OTHER],
    );
    await migratePool.query(
      `INSERT INTO conversations (id, owner_id, agent_id, title)
       VALUES ($1, $2, $3, '别人的会话')`,
      ["00000000-0000-4000-8000-000000000098", OTHER, "00000000-0000-4000-8000-000000000099"],
    );
    const hidden = await api(base, "/v1/conversations/00000000-0000-4000-8000-000000000098/messages");
    assert.equal(hidden.status, 404);
    const visible = await api(base, "/v1/conversations");
    const titles = ((await visible.json()) as { conversations: { title: string }[] }).conversations.map((item) => item.title);
    assert.equal(titles.includes("别人的会话"), false);

    fixture.mode.current = "status";
    const failed = await api(base, `/v1/conversations/${conversation.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ text: "会失败" }),
    });
    assert.equal(failed.status, 502);
    const failedBody = await failed.text();
    assert.match(failedBody, /模型上游/);
    assert.equal(failedBody.includes("fixture-secret-body"), false);
    assert.equal(failedBody.includes(TOKEN), false);

    fixture.mode.current = "hold";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    await Promise.race([
      fetch(`${base}/v1/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ text: "停" }),
        signal: controller.signal,
      }).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);
    clearTimeout(timer);
    controller.abort();
    await waitFor(async () => {
      const rows = await runtimePool.query<{ status: string }>(
        "SELECT status FROM runs WHERE status = 'cancelled'",
      );
      return (rows.rowCount ?? 0) > 0;
    });
  } finally {
    await started.close();
    await fixture.close();
    await runtimePool.end();
    await migratePool.end();
  }
});

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function atLeast(version: string, minimum: string): boolean {
  const left = version.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

async function api(base: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${TOKEN}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${base}${path}`, { ...init, headers });
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out waiting for cancellation");
}
