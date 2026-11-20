import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createMemoryStorage } from "./history.ts";
import { parseServerOrigin } from "./serverEndpoint.ts";
import { messageUrl } from "./serverClient.ts";
import { clearConnection, connectServer, CONVERSATION_KEY, TOKEN_KEY, URL_KEY, type SecretStore } from "./serverSession.ts";
import { createServerChatTransport } from "./liveTransport.ts";
import { createServerHistory } from "./serverHistory.ts";
import { startFixture } from "../../../../services/qbot-chat/test/fixture-upstream.ts";

const TOKEN = "qbot-fixture-token-not-a-secret";
const OWNER = "00000000-0000-4000-8000-000000000001";

test("server addresses reject public HTTP and keep the token out of plain storage", async () => {
  assert.equal(parseServerOrigin("https://chat.example/"), "https://chat.example");
  assert.equal(parseServerOrigin("https://chat.example/health"), "https://chat.example");
  assert.equal(parseServerOrigin("https://chat.example/v1/session"), "https://chat.example");
  assert.throws(() => parseServerOrigin("https://chat.example/other"), /根地址/);
  assert.equal(parseServerOrigin("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  assert.equal(parseServerOrigin("http://10.0.2.2:8787"), "http://10.0.2.2:8787");
  assert.throws(() => parseServerOrigin("http://example.com"), /HTTPS/);
  assert.throws(() => parseServerOrigin(`http://${["192", "168", "1", "20"].join(".")}`), /HTTPS/);
  assert.throws(() => parseServerOrigin("https://user:secret@chat.example"), /令牌/);

  const secrets = memorySecrets();
  const settings = createMemoryStorage();
  await assert.rejects(() => connectServer({
    secrets: failingSecrets(),
    settings,
    url: "http://127.0.0.1:9",
    token: TOKEN,
  }));
  assert.equal(await settings.getItem(URL_KEY), null);
  await secrets.set(TOKEN_KEY, TOKEN);
  await clearConnection(secrets, settings);
  assert.equal(await secrets.get(TOKEN_KEY), null);
});

test("the app reloads server history after the process restarts", { timeout: 30_000 }, async () => {
  const runtimeUrl = process.env.DATABASE_URL;
  const migrateUrl = process.env.DATABASE_MIGRATE_URL;
  if (!runtimeUrl || !migrateUrl) throw new Error("DATABASE_URL and DATABASE_MIGRATE_URL are required");
  const fixture = await startFixture();
  const serverRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "services", "qbot-chat");
  const env = {
    ...process.env,
    DATABASE_URL: runtimeUrl,
    DATABASE_MIGRATE_URL: migrateUrl,
    QBOT_OWNER_ID: OWNER,
    QBOT_ACCESS_TOKEN: TOKEN,
    OPENROUTER_API_KEY: fixture.expectedKey,
    HOST: "127.0.0.1",
    PORT: "0",
    QBOT_FIXTURE_UPSTREAM: "1",
    QBOT_FIXTURE_UPSTREAM_URL: fixture.url,
    QBOT_DSH_HOME: mkdtempSync(path.join(tmpdir(), "qbot-dsh-app-")),
  };
  await runNode(serverRoot, ["--experimental-strip-types", "src/migrate.ts"], env);
  let createdId = "";
  const first = await startServer(serverRoot, env);
  try {
    const secrets = memorySecrets();
    const settings = createMemoryStorage();
    const ready = await connectServer({
      secrets,
      settings,
      url: `http://127.0.0.1:${first.port}`,
      token: TOKEN,
    });
    assert.equal(ready.session.upstream, "fixture");
    assert.equal(ready.session.model, "deepseek/deepseek-v4.1-flash-1017");
    const dumped = await settings.getItem(URL_KEY);
    const conversation = await settings.getItem(CONVERSATION_KEY);
    assert.equal(dumped?.includes(TOKEN), false);
    assert.equal(conversation?.includes(TOKEN), false);
    assert.equal(await secrets.get(TOKEN_KEY), TOKEN);

    const created = await ready.client.createConversation();
    createdId = created.id;
    const transport = createServerChatTransport({
      url: messageUrl(ready.origin, created.id),
      token: TOKEN,
    });
    const deltas: string[] = [];
    for await (const delta of transport.reply([{ role: "user", text: "你好" }], new AbortController().signal)) deltas.push(delta);
    assert.equal(deltas.join(""), "夹具固定句");
    const hit = fixture.hits.at(-1);
    assert.equal(hit?.authorization, `Bearer ${fixture.expectedKey}`);
    assert.equal(hit?.authorization?.includes(TOKEN), false);
    const upstream = hit?.body as { model?: string; messages?: { role: string; content: string }[] };
    assert.equal(upstream.model, "deepseek/deepseek-v4.1-flash-1017");
    assert.equal(upstream.messages?.some((message) => message.role === "system" && message.content.includes("You have no tools")), true);
    assert.equal(upstream.messages?.some((message) => message.content === "你好"), true);

    const loaded = await createServerHistory(() => ready.client.listMessages(created.id)).load();
    const texts = loaded.messages.map((item) => item.message.content[0]?.type === "text" ? item.message.content[0].text : "");
    assert.deepEqual(texts, ["你好", "夹具固定句"]);
  } finally {
    first.stop();
  }

  const second = await startServer(serverRoot, env);
  try {
    const secrets = memorySecrets();
    await secrets.set(TOKEN_KEY, TOKEN);
    const settings = createMemoryStorage();
    await settings.setItem(URL_KEY, `http://127.0.0.1:${second.port}`);
    const ready = await connectServer({
      secrets,
      settings,
      url: `http://127.0.0.1:${second.port}`,
      token: "",
    });
    const messages = await ready.client.listMessages(createdId);
    assert.equal(messages.some((message) => message.content === "夹具固定句" && message.status === "complete"), true);
    assert.equal(ready.session.upstream, "fixture");
  } finally {
    second.stop();
    await fixture.close();
  }
});

function memorySecrets(): SecretStore {
  const items = new Map<string, string>();
  return {
    async get(key) { return items.get(key) ?? null; },
    async set(key, value) { items.set(key, value); },
    async remove(key) { items.delete(key); },
  };
}

function failingSecrets(): SecretStore {
  return {
    async get() { return null; },
    async set() { throw new Error("这台安装包没有安全存储"); },
    async remove() {},
  };
}

function runNode(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr || `exit ${code}`)));
  });
}

function startServer(cwd: string, env: NodeJS.ProcessEnv): Promise<{ port: number; stop: () => void }> {
  const child = spawn(process.execPath, ["--experimental-strip-types", "src/main.ts"], { cwd, env });
  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`server did not listen\n${buffer}`));
    }, 10_000);
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      const match = buffer.match(/port=(\d+)/);
      if (!match?.[1] || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ port: Number(match[1]), stop: () => child.kill("SIGTERM") });
    });
    child.stderr.on("data", (chunk) => {
      buffer += String(chunk);
      appendFileSync("/tmp/qbot-live-server.err", String(chunk));
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`server exited ${code}\n${buffer}`));
    });
  });
}
