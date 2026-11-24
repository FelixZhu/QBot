import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertNode24, loadConfig } from "./config.ts";
import { createPool } from "./db.ts";

const LOCK = 84218421;

export async function applyMigrations(options: { runtimeUrl: string; migrateUrl?: string | null; directory: string }): Promise<string[]> {
  const runtime = createPool(options.runtimeUrl);
  let migrate: ReturnType<typeof createPool> | null = null;
  const client = await runtime.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         id text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const files = (await readdir(options.directory)).filter((name) => name.endsWith(".sql")).sort();
    const applied: string[] = [];
    for (const file of files) {
      const seen = await client.query("SELECT 1 FROM schema_migrations WHERE id = $1", [file]);
      if (seen.rowCount === 1) continue;
      const sql = await readFile(path.join(options.directory, file), "utf8");
      const role = migrationRole(sql, file);
      if (role === "superuser") {
        if (!options.migrateUrl) {
          throw new Error(`DATABASE_MIGRATE_URL is required to apply superuser migration ${file}`);
        }
        migrate ??= createPool(options.migrateUrl);
      }
      const conn = role === "superuser" ? await migrate!.connect() : client;
      try {
        await conn.query("BEGIN");
        try {
          await conn.query(sql);
          await conn.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
          await conn.query("COMMIT");
        } catch (error) {
          await conn.query("ROLLBACK");
          throw error;
        }
      } finally {
        if (conn !== client) conn.release();
      }
      applied.push(file);
    }
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK]).catch(() => {});
    client.release();
    await runtime.end();
    if (migrate) await migrate.end();
  }
}

export function migrationRole(sql: string, file: string): "superuser" | "runtime" {
  const line = sql.split("\n").find((entry) => entry.startsWith("-- qbot-migrate-role:"));
  const role = line?.slice("-- qbot-migrate-role:".length).trim();
  if (role !== "superuser" && role !== "runtime") throw new Error(`${file} is missing qbot-migrate-role`);
  return role;
}

async function main(): Promise<void> {
  assertNode24();
  const config = loadConfig(process.env);
  const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  const applied = await applyMigrations({
    runtimeUrl: config.databaseUrl,
    migrateUrl: config.migrateUrl,
    directory,
  });
  console.log(applied.length ? `applied ${applied.join(", ")}` : "migrations already applied");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "migrate failed");
    process.exit(1);
  });
}
