import { pathToFileURL } from "node:url";
import { assertNode24, loadConfig } from "./config.ts";
import { createPool } from "./db.ts";

export type Assessment = {
  version: string;
  encoding: string;
  collate: string;
  ctype: string;
  role: string;
  superuser: boolean;
  createdb: boolean;
  vectorVersion: string | null;
  vectorColumns: number;
  listenAddresses: string;
};

export async function assessDatabase(connectionString: string): Promise<Assessment> {
  const pool = createPool(connectionString);
  try {
    const version = await pool.query<{ server_version: string }>("SHOW server_version");
    const db = await pool.query<{ enc: string; datcollate: string; datctype: string }>(
      `SELECT pg_encoding_to_char(encoding) AS enc, datcollate, datctype
       FROM pg_database WHERE datname = current_database()`,
    );
    const role = await pool.query<{ rolname: string; rolsuper: boolean; rolcreatedb: boolean }>(
      "SELECT rolname, rolsuper, rolcreatedb FROM pg_roles WHERE rolname = current_user",
    );
    const vector = await pool.query<{ extversion: string }>("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
    const columns = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM information_schema.columns
       WHERE table_schema = 'public' AND udt_name = 'vector'`,
    );
    const listen = await pool.query<{ listen_addresses: string }>("SHOW listen_addresses");
    const dbRow = db.rows[0];
    const roleRow = role.rows[0];
    if (!dbRow || !roleRow) throw new Error("database assessment returned no row");
    return {
      version: version.rows[0]?.server_version ?? "",
      encoding: dbRow.enc,
      collate: dbRow.datcollate,
      ctype: dbRow.datctype,
      role: roleRow.rolname,
      superuser: roleRow.rolsuper,
      createdb: roleRow.rolcreatedb,
      vectorVersion: vector.rows[0]?.extversion ?? null,
      vectorColumns: columns.rows[0]?.n ?? 0,
      listenAddresses: listen.rows[0]?.listen_addresses ?? "",
    };
  } finally {
    await pool.end();
  }
}

export function localeOk(value: string): boolean {
  return /^c\.utf-?8$/i.test(value);
}

export function loopbackListen(value: string): boolean {
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => part === "localhost" || part === "127.0.0.1" || part === "::1");
}

export function assessmentProblems(found: Assessment, requireLoopback: boolean): string[] {
  const problems: string[] = [];
  if (found.encoding !== "UTF8") problems.push(`encoding is ${found.encoding}, expected UTF8`);
  if (!localeOk(found.collate) || !localeOk(found.ctype)) problems.push(`locale is ${found.collate}/${found.ctype}, expected C.utf8`);
  if (found.superuser || found.createdb) problems.push("runtime role must not be superuser and must not create databases");
  if (!found.vectorVersion) problems.push("vector extension is missing in this database");
  if (found.vectorColumns !== 0) problems.push("vector columns exist; this chat migration does not create them");
  if (requireLoopback && !loopbackListen(found.listenAddresses)) {
    problems.push(`listen_addresses is ${found.listenAddresses}, expected localhost only`);
  }
  return problems;
}

async function main(): Promise<void> {
  assertNode24();
  const config = loadConfig(process.env);
  const found = await assessDatabase(config.databaseUrl);
  const problems = assessmentProblems(found, process.env.QBOT_CHECK_LISTEN === "1");
  console.log(`postgres ${found.version} role ${found.role} encoding ${found.encoding} locale ${found.collate} vector ${found.vectorVersion ?? "missing"} listen ${found.listenAddresses}`);
  if (problems.length) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "check failed");
    process.exit(1);
  });
}
