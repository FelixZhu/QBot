import pg from "pg";

const { Pool } = pg;

export type Queryable = {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<pg.QueryResult<T>>;
};

export function createPool(connectionString: string): pg.Pool {
  const pool = new Pool({
    connectionString,
    max: 4,
    statement_timeout: 10_000,
    idleTimeoutMillis: 10_000,
    application_name: "qbot-chat",
  });
  pool.on("error", (error: Error) => {
    console.error(`postgres client error ${error.name}`);
  });
  return pool;
}
