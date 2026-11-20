import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { DEFAULT_MODEL, loadConfig } from "../src/config.ts";
import { LIMITS } from "../src/limits.ts";
import { buildModelMessages } from "../src/runtime/context.ts";
import { SERVER_PERSONA } from "../src/runtime/persona.ts";
import { streamAgentText } from "../src/runtime/run.ts";
import type { TextRuntime } from "../src/runtime/types.ts";

test("context keeps the persona and the newest turns inside the budget", () => {
  const history = Array.from({ length: 50 }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `turn-${index}-${"x".repeat(800)}`,
  }));
  const messages = buildModelMessages(SERVER_PERSONA, history);
  assert.equal(messages[0]?.role, "system");
  assert.equal(messages[0]?.content, SERVER_PERSONA);
  assert.ok(messages.length > 1);
  assert.ok(messages.length - 1 <= LIMITS.contextMessages);
  const chars = messages.reduce((sum, message) => sum + message.content.length, 0);
  assert.ok(chars <= LIMITS.contextChars + history.at(-1)!.content.length);
  assert.equal(messages.at(-1)?.content, history.at(-1)?.content);
  assert.equal(messages.some((message) => message.role === "system" && message !== messages[0]), false);
});

test("the default model is the server constant and the host must be loopback", () => {
  const config = loadConfig({
    DATABASE_URL: "postgres://qbot:secret@127.0.0.1:5432/qbot",
    QBOT_OWNER_ID: "00000000-0000-4000-8000-000000000001",
    QBOT_ACCESS_TOKEN: "qbot-fixture-token-not-a-secret",
    OPENROUTER_API_KEY: "fixture-openrouter-key-not-a-secret",
  });
  assert.equal(config.model, DEFAULT_MODEL);
  assert.equal(config.personalOpen, false);
  assert.equal(DEFAULT_MODEL, "deepseek/deepseek-v4.1-flash-1017");
  assert.throws(() => loadConfig({
    DATABASE_URL: "postgres://qbot:secret@127.0.0.1:5432/qbot",
    QBOT_OWNER_ID: "00000000-0000-4000-8000-000000000001",
    QBOT_ACCESS_TOKEN: "qbot-fixture-token-not-a-secret",
    OPENROUTER_API_KEY: "fixture-openrouter-key-not-a-secret",
    HOST: "0.0.0.0",
  }), /loopback/);
  assert.throws(() => loadConfig({
    DATABASE_URL: "postgres://qbot:secret@127.0.0.1:5432/qbot",
    QBOT_OWNER_ID: "00000000-0000-4000-8000-000000000001",
    QBOT_ACCESS_TOKEN: "replace-with-a-long-random-token",
    OPENROUTER_API_KEY: "fixture-openrouter-key-not-a-secret",
  }), /QBOT_ACCESS_TOKEN/);
});

test("streamAgentText is the only model pass and does not own storage", async () => {
  const seen: unknown[] = [];
  const runtime: TextRuntime = {
    id: "fixture",
    async *stream(request) {
      seen.push(request.messages.map((message) => message.role));
      yield "夹具";
      yield "固定句";
    },
  };
  const chunks: string[] = [];
  for await (const chunk of streamAgentText(runtime, {
    model: DEFAULT_MODEL,
    messages: [{ role: "system", content: SERVER_PERSONA }, { role: "user", content: "你好" }],
    signal: new AbortController().signal,
  })) chunks.push(chunk);
  assert.deepEqual(chunks, ["夹具", "固定句"]);
  assert.deepEqual(seen, [["system", "user"]]);
  const source = readFileSync(new URL("../src/runtime/run.ts", import.meta.url), "utf8");
  assert.equal(source.includes("pg"), false);
  assert.equal(source.includes("pi-agent"), false);
});

test("dependencies do not adopt an agent framework", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  const names = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)];
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
    "@deepseek-ai/dsh",
    "@deepseek-ai/dsh-llm-pi-ai",
    "@deepseek-ai/dsh-sdk-client",
    "assistant-stream",
    "pg",
  ]);
  for (const name of names) assert.equal(/pi-agent-core/i.test(name), false, name);
});
