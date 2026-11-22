import type { OwnerCatalog } from "./types.ts";

/** The agents read failed. The import did not write. */
export class CatalogUnavailable extends Error {
  constructor() {
    super("不能读取 agents 表，导入没有继续");
    this.name = "CatalogUnavailable";
  }
}

export type QueryResult = { rowCount: number | null; rows: readonly unknown[] };

export type SqlClient = {
  query(sql: string, params?: readonly unknown[]): Promise<QueryResult>;
};

/** The only statement this slice sends. It does not create or update a version table. */
export const AGENTS_SQL = "SELECT 1 FROM agents WHERE owner_id = $1 AND slug = $2";

export function agentsCatalog(client: SqlClient): OwnerCatalog {
  return {
    async botAllowed(ownerId, slug) {
      let result: QueryResult;
      try {
        result = await client.query(AGENTS_SQL, [ownerId, slug]);
      } catch {
        throw new CatalogUnavailable();
      }
      return (result.rowCount ?? result.rows.length) === 1;
    },
  };
}

export function memoryCatalog(input: { ownerId: string; slugs: readonly string[] }): OwnerCatalog {
  const allowed = new Set(input.slugs);
  return {
    async botAllowed(ownerId, slug) {
      return ownerId === input.ownerId && allowed.has(slug);
    },
  };
}
