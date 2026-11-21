import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import { LIMITS } from "../limits.ts";
import { decodeCursor, encodeCursor } from "./paths.ts";

export type FeedScope = "following" | "recommended";

export type FeedCard = {
  id: string;
  title: string;
  publishedAt: string;
  visibility: "public" | "followers";
  provenance: "manual";
  artifactId: string;
  manifestSha256: string;
  coverPath: string;
  bot: { id: string; slug: string; displayName: string; followed: boolean };
};

export type FeedFile = {
  path: string;
  sha256: string;
  bytes: number;
  contentType: string;
  role: "cover" | "page" | "asset";
};

export type CardDetail = FeedCard & { files: FeedFile[] };

export type BotProfile = {
  id: string;
  slug: string;
  displayName: string;
  visibility: "public" | "private";
  bio: string;
  followed: boolean;
};

export type MintedCapability = {
  token: string;
  expiresAt: string;
  artifactId: string;
  files: FeedFile[];
};

export type ResolvedFile = {
  relPath: string;
  sha256: string;
  contentType: string;
  byteLength: number;
};

type CardRow = {
  id: string;
  title: string;
  published_at: Date;
  visibility: "public" | "followers";
  provenance: "manual";
  artifact_id: string;
  manifest_sha256: string;
  cover_path: string;
  agent_id: string;
  agent_visibility: "public" | "private" | null;
  slug: string;
  display_name: string;
  followed: boolean;
};

const CARD_SELECT = `
  SELECT c.id, c.title, c.published_at, c.visibility, c.provenance,
         a.id AS artifact_id, a.manifest_sha256,
         cover.rel_path AS cover_path,
         g.id AS agent_id, g.visibility AS agent_visibility, g.slug,
         COALESCE(g.display_name, g.slug) AS display_name,
         EXISTS (SELECT 1 FROM follows f WHERE f.owner_id = $1 AND f.agent_id = g.id) AS followed
  FROM cards c
  JOIN artifacts a ON a.id = c.artifact_id AND a.card_id = c.id
  JOIN agents g ON g.id = c.agent_id
  JOIN LATERAL (
    SELECT rel_path FROM artifact_files
    WHERE artifact_id = a.id AND role = 'cover'
    ORDER BY rel_path
    LIMIT 1
  ) cover ON true
`;

export type FeedStore = {
  list(ownerId: string, scope: FeedScope, limit: number, cursor: string | null): Promise<{ cards: FeedCard[]; next: string | null }>;
  bot(ownerId: string, agentId: string): Promise<BotProfile | null>;
  botBySlug(ownerId: string, slug: string): Promise<BotProfile | null>;
  follow(ownerId: string, agentId: string): Promise<boolean>;
  unfollow(ownerId: string, agentId: string): Promise<boolean>;
  card(ownerId: string, cardId: string): Promise<CardDetail | null>;
  mint(ownerId: string, cardId: string): Promise<MintedCapability | null>;
  resolve(token: string, artifactId: string, relPath: string): Promise<"expired" | "denied" | ResolvedFile>;
};

export function createFeedStore(pool: pg.Pool): FeedStore {
  return {
    async list(ownerId, scope, limit, cursor) {
      const parsed = cursor ? decodeCursor(cursor) : null;
      if (cursor && !parsed) throw new Error("bad cursor");
      const result = await pool.query<CardRow>(
        `${CARD_SELECT}
         WHERE (
           ($2::text = 'following' AND EXISTS (
             SELECT 1 FROM follows f WHERE f.owner_id = $1 AND f.agent_id = g.id
           ) AND c.visibility IN ('public', 'followers'))
           OR ($2::text = 'recommended' AND g.visibility = 'public' AND c.visibility = 'public')
         )
         AND ($3::timestamptz IS NULL OR (c.published_at, c.id) < ($3::timestamptz, $4::uuid))
         ORDER BY c.published_at DESC, c.id DESC
         LIMIT $5`,
        [ownerId, scope, parsed?.publishedAt ?? null, parsed?.id ?? null, limit + 1],
      );
      const page = result.rows.slice(0, limit).map(toCard);
      const extra = result.rows.length > limit ? page.at(-1) : undefined;
      return { cards: page, next: extra ? encodeCursor(extra.publishedAt, extra.id) : null };
    },
    async bot(ownerId, agentId) {
      return oneBot(pool, ownerId, "id", agentId);
    },
    async botBySlug(ownerId, slug) {
      return oneBot(pool, ownerId, "slug", slug);
    },
    async follow(ownerId, agentId) {
      const visible = await visibleAgent(pool, ownerId, agentId);
      if (!visible) return false;
      await pool.query(
        `INSERT INTO follows (owner_id, agent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [ownerId, agentId],
      );
      return true;
    },
    async unfollow(ownerId, agentId) {
      const visible = await visibleAgent(pool, ownerId, agentId);
      if (!visible) return false;
      await pool.query("DELETE FROM follows WHERE owner_id = $1 AND agent_id = $2", [ownerId, agentId]);
      return true;
    },
    async card(ownerId, cardId) {
      const result = await pool.query<CardRow>(`${CARD_SELECT} WHERE c.id = $2`, [ownerId, cardId]);
      const row = result.rows[0];
      if (!row || !canRead(row)) return null;
      const files = await filesFor(pool, row.artifact_id);
      return { ...toCard(row), files };
    },
    async mint(ownerId, cardId) {
      const detail = await this.card(ownerId, cardId);
      if (!detail) return null;
      await pool.query("DELETE FROM artifact_capabilities WHERE expires_at < now()");
      const token = randomBytes(32).toString("base64url");
      const hash = createHash("sha256").update(token).digest();
      const expires = new Date(Date.now() + LIMITS.capabilitySeconds * 1000);
      await pool.query(
        `INSERT INTO artifact_capabilities (token_hash, artifact_id, owner_id, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [hash, detail.artifactId, ownerId, expires.toISOString()],
      );
      return { token, expiresAt: expires.toISOString(), artifactId: detail.artifactId, files: detail.files };
    },
    async resolve(token, artifactId, relPath) {
      const hash = createHash("sha256").update(token).digest();
      const result = await pool.query<{
        expires_at: Date;
        artifact_id: string;
        rel_path: string | null;
        sha256: string | null;
        content_type: string | null;
        byte_length: number | null;
      }>(
        `SELECT c.expires_at, c.artifact_id, f.rel_path, f.sha256, f.content_type, f.byte_length
         FROM artifact_capabilities c
         LEFT JOIN artifact_files f ON f.artifact_id = c.artifact_id AND f.rel_path = $3
         WHERE c.token_hash = $1 AND c.artifact_id = $2`,
        [hash, artifactId, relPath],
      );
      const row = result.rows[0];
      if (!row) return "denied";
      if (row.expires_at.getTime() <= Date.now()) return "expired";
      if (!row.rel_path || !row.sha256 || !row.content_type || !row.byte_length) return "denied";
      return { relPath: row.rel_path, sha256: row.sha256, contentType: row.content_type, byteLength: row.byte_length };
    },
  };
}

function canRead(row: CardRow): boolean {
  if (row.followed && (row.visibility === "public" || row.visibility === "followers")) return true;
  return row.agent_visibility === "public" && row.visibility === "public";
}

function toCard(row: CardRow): FeedCard {
  return {
    id: row.id,
    title: row.title,
    publishedAt: row.published_at.toISOString(),
    visibility: row.visibility,
    provenance: row.provenance,
    artifactId: row.artifact_id,
    manifestSha256: row.manifest_sha256,
    coverPath: row.cover_path,
    bot: { id: row.agent_id, slug: row.slug, displayName: row.display_name, followed: row.followed },
  };
}

async function filesFor(pool: pg.Pool, artifactId: string): Promise<FeedFile[]> {
  const result = await pool.query<{ rel_path: string; sha256: string; byte_length: number; content_type: string; role: FeedFile["role"] }>(
    `SELECT rel_path, sha256, byte_length, content_type, role
     FROM artifact_files WHERE artifact_id = $1 ORDER BY rel_path`,
    [artifactId],
  );
  return result.rows.map((row) => ({
    path: row.rel_path,
    sha256: row.sha256,
    bytes: row.byte_length,
    contentType: row.content_type,
    role: row.role,
  }));
}

async function oneBot(pool: pg.Pool, ownerId: string, column: "id" | "slug", value: string): Promise<BotProfile | null> {
  const result = await pool.query<{
    id: string;
    slug: string;
    display_name: string;
    visibility: "public" | "private" | null;
    bio: string | null;
    followed: boolean;
    owner_id: string;
  }>(
    `SELECT id, slug, COALESCE(display_name, slug) AS display_name, visibility, bio, owner_id,
            EXISTS (SELECT 1 FROM follows f WHERE f.owner_id = $1 AND f.agent_id = agents.id) AS followed
     FROM agents WHERE ${column} = $2`,
    [ownerId, value],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.visibility !== "public" && row.owner_id !== ownerId) return null;
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    visibility: row.visibility === "public" ? "public" : "private",
    bio: row.bio ?? "",
    followed: row.followed,
  };
}

async function visibleAgent(pool: pg.Pool, ownerId: string, agentId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM agents WHERE id = $2 AND (visibility = 'public' OR owner_id = $1)`,
    [ownerId, agentId],
  );
  return result.rowCount === 1;
}
