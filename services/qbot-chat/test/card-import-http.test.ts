import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AGENTS_SQL } from "../src/card-import/catalog.ts";
import { loadConfig } from "../src/config.ts";
import { createChatServer, listen } from "../src/http.ts";
import type { ConversationEngine } from "../src/runtime/dsh.ts";
import type { ChatStore } from "../src/store.ts";
import { buildZip, IDEMPOTENCY_KEY, OWNER_ID } from "./build-package.ts";

const TOKEN = "qbot-card-import-test-token";

function config() {
  return loadConfig({
    DATABASE_URL: "postgres://qbot:qbot@127.0.0.1:5432/qbot",
    QBOT_OWNER_ID: OWNER_ID,
    QBOT_ACCESS_TOKEN: TOKEN,
    OPENROUTER_API_KEY: "fixture-openrouter-key-not-a-secret",
    HOST: "127.0.0.1",
    PORT: "0",
  });
}

describe("card import on the chat server", () => {
  it("uses the owner bearer and reads agents without a version check", async () => {
    const queries: { sql: string; params: readonly unknown[] | undefined }[] = [];
    const pool = {
      async query(sql: string, params?: readonly unknown[]) {
        queries.push({ sql, params });
        return { rowCount: params?.[1] === "example-bot" ? 1 : 0, rows: params?.[1] === "example-bot" ? [{}] : [] };
      },
    };
    const server = createChatServer({
      config: config(),
      store: {} as ChatStore,
      runtime: {} as ConversationEngine,
      pool: pool as never,
    });
    const port = await listen(server, "127.0.0.1", 0);
    const base = `http://127.0.0.1:${port}`;
    const zip = buildZip();
    try {
      const anonymous = await fetch(`${base}/v1/card-imports/dry-run`, {
        method: "POST",
        headers: { "content-type": "application/zip" },
        body: new Uint8Array(zip),
      });
      assert.equal(anonymous.status, 401);
      assert.equal(queries.length, 0);

      const response = await fetch(`${base}/v1/card-imports/dry-run`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/zip",
          "idempotency-key": IDEMPOTENCY_KEY,
        },
        body: new Uint8Array(zip),
      });
      assert.equal(response.status, 200);
      const body = await response.json() as { state: string; versionCheck: string; commitAllowed: boolean; publishAllowed: boolean };
      assert.equal(body.state, "validated");
      assert.equal(body.versionCheck, "unavailable");
      assert.equal(body.commitAllowed, false);
      assert.equal(body.publishAllowed, false);
      assert.deepEqual(queries.map((query) => query.sql), [AGENTS_SQL]);
      assert.deepEqual(queries[0]?.params, [OWNER_ID, "example-bot"]);

      const stage = await fetch(`${base}/v1/card-imports/stage`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(stage.status, 501);
      const denied = await stage.json() as { error: { message: string } };
      assert.match(denied.error.message, /不会写数据库/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});