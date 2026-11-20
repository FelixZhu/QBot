import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { tokenDigest } from "../src/auth.ts";
import { loadConfig } from "../src/config.ts";
import { createPool } from "../src/db.ts";
import { applyMigrations } from "../src/migrate.ts";
import { SERVER_PERSONA } from "../src/runtime/persona.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createDshEngine, openaiBase, type ConversationEngine } from "../src/runtime/dsh.ts";
import { encodeSetup, issueSetupCode } from "../src/setup-code.ts";
import { assessDatabase, assessmentProblems } from "../src/check-db.ts";
import { startChatServer } from "../src/server.ts";
import { createStore } from "../src/store.ts";
import { startFixture, readSse, type FixtureHit } from "./fixture-upstream.ts";

const TOKEN = "qbot-fixture-token-not-a-secret";
const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

test("a one-time code becomes a revocable device credential", async () => {
  const runtimeUrl = requiredEnv("DATABASE_URL");
  const migrateUrl = requiredEnv("DATABASE_MIGRATE_URL");
  const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  await applyMigrations({ runtimeUrl, migrateUrl, directory });
  const config = loadConfig({
    ...process.env,
    DATABASE_URL: runtimeUrl,
    QBOT_OWNER_ID: OWNER,
    QBOT_ACCESS_TOKEN: TOKEN,
    OPENROUTER_API_KEY: "fixture-openrouter-key-not-a-secret",
    HOST: "127.0.0.1",
    PORT: "0",
    QBOT_FIXTURE_UPSTREAM: "1",
    QBOT_FIXTURE_UPSTREAM_URL: "http://127.0.0.1:9/v1/chat/completions",
  });
  const pool = createPool(runtimeUrl);
  const store = createStore(pool);
  const runtime = { engine: "dsh", id: "fixture", run() { throw new Error("unused"); }, async close() {} } as ConversationEngine;
  const started = await startChatServer({ config, store, runtime });
  try {
    const origin = `http://127.0.0.1:${started.port}`;
    const setup = await issueSetupCode(store, origin);
    const code = codeFrom(setup);
    const first = await fetch(`${origin}/v1/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ code }),
    });
    const raw = await first.text();
    assert.equal(first.status, 200);
    assert.equal(raw.includes(TOKEN), false);
    assert.equal(raw.includes(code), false);
    const body = JSON.parse(raw) as { token?: string; deviceId?: string };
    assert.equal(typeof body.token, "string");
    assert.notEqual(body.token, TOKEN);
    const session = await fetch(`${origin}/v1/session`, { headers: { Authorization: `Bearer ${body.token}` } });
    assert.equal(session.status, 200);
    const owner = await fetch(`${origin}/v1/session`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(owner.status, 200);
    const again = await fetch(`${origin}/v1/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    assert.equal(again.status, 401);
    const expiredCode = randomBytes(32).toString("base64url");
    await store.createEnrollment(tokenDigest(expiredCode), new Date(Date.now() - 1000));
    const expired = await fetch(`${origin}/v1/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: expiredCode }),
    });
    assert.equal(expired.status, 401);
    assert.equal(await store.revokeDevice(body.deviceId ?? ""), true);
    const revoked = await fetch(`${origin}/v1/session`, { headers: { Authorization: `Bearer ${body.token}` } });
    assert.equal(revoked.status, 401);
    const garbage = await fetch(`${origin}/v1/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "nope" }),
    });
    assert.equal(garbage.status, 400);
    assert.equal(encodeSetup("https://chat.example", expiredCode).startsWith("qbot1."), true);
  } finally {
    await started.close();
    await pool.end();
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
  await runtimePool.query("DELETE FROM messages");
  await runtimePool.query("DELETE FROM runs");
  await runtimePool.query("DELETE FROM conversations");
  await runtimePool.query("DELETE FROM agents");
  await runtimePool.query("DELETE FROM owners");
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

function codeFrom(setup: string): string {
  const parsed = JSON.parse(Buffer.from(setup.slice("qbot1.".length), "base64url").toString("utf8")) as { c?: string };
  if (typeof parsed.c !== "string") throw new Error("setup code missing");
  return parsed.c;
}

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
