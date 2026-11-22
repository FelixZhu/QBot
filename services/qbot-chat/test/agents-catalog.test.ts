import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { AGENTS_SQL, agentsCatalog, CatalogUnavailable, type SqlClient } from "../src/card-import/catalog.ts";

describe("agents catalog", () => {
  it("allows only the owner's slug and sends one SELECT", async () => {
    const queries: string[] = [];
    const client: SqlClient = {
      async query(sql, params) {
        queries.push(sql);
        assert.equal(sql, AGENTS_SQL);
        assert.match(sql, /^SELECT\b/);
        assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i);
        return { rowCount: params?.[1] === "example-bot" ? 1 : 0, rows: params?.[1] === "example-bot" ? [{}] : [] };
      },
    };
    const catalog = agentsCatalog(client);
    assert.equal(await catalog.botAllowed("owner", "example-bot"), true);
    assert.equal(await catalog.botAllowed("owner", "other-bot"), false);
    assert.deepEqual(queries, [AGENTS_SQL, AGENTS_SQL]);
  });

  it("does not treat a failed agents read as an allowed bot", async () => {
    const client: SqlClient = {
      async query() {
        throw Object.assign(new Error("relation missing"), { code: "42P01" });
      },
    };
    await assert.rejects(() => agentsCatalog(client).botAllowed("owner", "example-bot"), CatalogUnavailable);
  });

  it("does not mention a version table in the importer", () => {
    assert.doesNotMatch(AGENTS_SQL, /card_package_versions|INSERT|UPDATE|DELETE/i);
    const dir = fileURLToPath(new URL("../src/card-import/", import.meta.url));
    const problems: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts")) continue;
      const text = readFileSync(join(dir, name), "utf8");
      if (/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/.test(text)) problems.push(`${name} writes`);
    }
    assert.deepEqual(problems, []);
  });
});
