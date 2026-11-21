import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { createPool } from "./db.ts";
import { contentTypeFor } from "./feed/paths.ts";
import { DEFAULT_MODEL } from "./config.ts";
import { SERVER_PERSONA } from "./runtime/persona.ts";

export type SeedFile = {
  path: string;
  role: "cover" | "page" | "asset";
  contentType: string;
  sha256: string;
};

export type SeedCard = {
  id: string;
  artifactId: string;
  version: number;
  title: string;
  publishedAt: string;
  provenance: "manual";
  visibility: "public";
  dir: string;
  manifestSha256: string;
  files: SeedFile[];
};

export type SeedManifest = {
  bot: { slug: string; displayName: string; visibility: "public"; bio: string };
  cards: SeedCard[];
};

export type SeedReport = {
  agentId: string;
  cardCount: number;
  followed: boolean;
  objects: { artifactId: string; path: string; sha256: string; bytes: number }[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function seedRoot(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "seed");
}

export async function loadManifest(root = seedRoot()): Promise<SeedManifest> {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as SeedManifest;
  if (manifest.bot.slug !== "qbot" || manifest.bot.displayName !== "Qbot" || manifest.cards.length !== 2) {
    throw new Error("seed manifest is not the two Qbot cards");
  }
  for (const card of manifest.cards) {
    if (card.provenance !== "manual" || card.visibility !== "public" || card.version !== 1) {
      throw new Error("seed card is not a manual public version");
    }
    const covers = card.files.filter((file) => file.role === "cover");
    const pages = card.files.filter((file) => file.role === "page" && file.path === "index.html");
    if (covers.length !== 1 || pages.length !== 1) throw new Error("each card needs one cover and index.html");
    const lines: string[] = [];
    for (const file of [...card.files].sort((a, b) => a.path < b.path ? -1 : 1)) {
      if (contentTypeFor(file.path) !== file.contentType) throw new Error("seed content type does not match the path");
      const bytes = await readFile(path.join(root, "bundles", card.dir, file.path));
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (sha256 !== file.sha256) throw new Error("seed file hash does not match the manifest");
      if (/<script|@font-face|url\(https?:/i.test(bytes.toString("utf8")) && !file.path.endsWith(".png")) {
        throw new Error("seed bundle has a script, a font, or a remote URL");
      }
      lines.push(`${file.path}\n${file.sha256}\n${bytes.length}\n`);
    }
    const digest = createHash("sha256").update(lines.join("")).digest("hex");
    if (digest !== card.manifestSha256) throw new Error("seed manifest hash does not match the files");
  }
  return manifest;
}

export async function seedCards(options: { databaseUrl: string; ownerId: string; root?: string }): Promise<SeedReport> {
  assertLoopback(options.databaseUrl);
  if (!UUID.test(options.ownerId)) throw new Error("QBOT_OWNER_ID must be a UUID");
  const root = options.root ?? seedRoot();
  const manifest = await loadManifest(root);
  const pool = createPool(options.databaseUrl);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO owners (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [options.ownerId]);
    const agent = await client.query<{ id: string }>(
      `INSERT INTO agents (id, owner_id, slug, persona, model, display_name, visibility, bio)
       VALUES ($1, $2, $3, $4, $5, $6, 'public', $7)
       ON CONFLICT (owner_id, slug) DO UPDATE SET
         display_name = COALESCE(agents.display_name, EXCLUDED.display_name),
         visibility = COALESCE(agents.visibility, EXCLUDED.visibility),
         bio = COALESCE(agents.bio, EXCLUDED.bio)
       RETURNING id`,
      [randomUUID(), options.ownerId, manifest.bot.slug, SERVER_PERSONA, DEFAULT_MODEL, manifest.bot.displayName, manifest.bot.bio],
    );
    const agentId = agent.rows[0]?.id;
    if (!agentId) throw new Error("seed did not find the Qbot agent");
    const objects: SeedReport["objects"] = [];
    for (const card of manifest.cards) {
      await upsertCard(client, agentId, root, card, objects);
    }
    await client.query(
      `INSERT INTO owner_bootstrap (owner_id, qbot_follow_seeded) VALUES ($1, false)
       ON CONFLICT (owner_id) DO NOTHING`,
      [options.ownerId],
    );
    await client.query(
      `WITH mark AS (
         UPDATE owner_bootstrap SET qbot_follow_seeded = true
         WHERE owner_id = $1 AND qbot_follow_seeded = false
         RETURNING owner_id
       )
       INSERT INTO follows (owner_id, agent_id)
       SELECT mark.owner_id, $2 FROM mark
       ON CONFLICT DO NOTHING`,
      [options.ownerId, agentId],
    );
    await client.query("COMMIT");
    const followed = await pool.query("SELECT 1 FROM follows WHERE owner_id = $1 AND agent_id = $2", [options.ownerId, agentId]);
    const cards = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM cards WHERE agent_id = $1", [agentId]);
    return { agentId, cardCount: cards.rows[0]?.n ?? 0, followed: followed.rowCount === 1, objects };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

export async function placeBundles(root: string, manifest: SeedManifest, source = seedRoot()): Promise<void> {
  if (!path.isAbsolute(root)) throw new Error("object root must be absolute");
  for (const card of manifest.cards) {
    for (const file of card.files) {
      const destination = path.join(root, card.artifactId, file.path);
      if (!destination.startsWith(path.resolve(root) + path.sep)) throw new Error("object path escaped the root");
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(source, "bundles", card.dir, file.path), destination);
    }
  }
}

async function upsertCard(
  client: pg.PoolClient,
  agentId: string,
  root: string,
  card: SeedCard,
  objects: SeedReport["objects"],
): Promise<void> {
  const existing = await client.query<{
    title: string;
    published_at: Date;
    visibility: string;
    provenance: string;
    artifact_id: string;
    agent_id: string;
    version: number;
    manifest_sha256: string;
  }>(
    `SELECT c.title, c.published_at, c.visibility, c.provenance, c.artifact_id, c.agent_id, a.version, a.manifest_sha256
     FROM cards c JOIN artifacts a ON a.id = c.artifact_id AND a.card_id = c.id
     WHERE c.id = $1`,
    [card.id],
  );
  if ((existing.rowCount ?? 0) > 0) {
    const row = existing.rows[0];
    const published = row ? new Date(row.published_at).toISOString() : "";
    if (
      row?.title !== card.title
      || published !== card.publishedAt
      || row?.visibility !== card.visibility
      || row?.provenance !== "manual"
      || row?.artifact_id !== card.artifactId
      || row?.agent_id !== agentId
      || row?.version !== card.version
      || row?.manifest_sha256 !== card.manifestSha256
    ) throw new Error("an existing card does not match the seed and was left unchanged");
    const files = await client.query<{ rel_path: string; sha256: string }>(
      "SELECT rel_path, sha256 FROM artifact_files WHERE artifact_id = $1 ORDER BY rel_path",
      [card.artifactId],
    );
    const wanted = [...card.files].sort((a, b) => a.path < b.path ? -1 : 1);
    if (files.rows.length !== wanted.length || wanted.some((file, index) => files.rows[index]?.rel_path !== file.path || files.rows[index]?.sha256 !== file.sha256)) {
      throw new Error("an existing bundle does not match the seed and was left unchanged");
    }
    return;
  }
  await client.query(
    `INSERT INTO cards (id, agent_id, visibility, title, published_at, provenance)
     VALUES ($1, $2, $3, $4, $5, 'manual')`,
    [card.id, agentId, card.visibility, card.title, card.publishedAt],
  );
  await client.query(
    `INSERT INTO artifacts (id, card_id, version, manifest_sha256) VALUES ($1, $2, $3, $4)`,
    [card.artifactId, card.id, card.version, card.manifestSha256],
  );
  for (const file of card.files) {
    const bytes = await readFile(path.join(root, "bundles", card.dir, file.path));
    await client.query(
      `INSERT INTO artifact_files (artifact_id, rel_path, sha256, byte_length, content_type, role)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [card.artifactId, file.path, file.sha256, bytes.length, file.contentType, file.role],
    );
    objects.push({ artifactId: card.artifactId, path: file.path, sha256: file.sha256, bytes: bytes.length });
  }
  const pointed = await client.query(
    "UPDATE cards SET artifact_id = $2 WHERE id = $1 AND artifact_id IS NULL",
    [card.id, card.artifactId],
  );
  if (pointed.rowCount !== 1) throw new Error("seed did not point the card at its artifact");
}

function assertLoopback(databaseUrl: string): void {
  let host = "";
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error("DATABASE_URL must be a loopback URL");
  }
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("seed only connects to a loopback database");
  }
}

async function main(): Promise<void> {
  if (process.env.QBOT_SEED_CONFIRM !== "cards") throw new Error("Set QBOT_SEED_CONFIRM=cards to publish the two cards");
  const databaseUrl = (process.env.DATABASE_URL ?? "").trim();
  const ownerId = (process.env.QBOT_OWNER_ID ?? "").trim();
  if (!databaseUrl || !ownerId) throw new Error("DATABASE_URL and QBOT_OWNER_ID are required");
  const report = await seedCards({ databaseUrl, ownerId });
  const objectRoot = (process.env.QBOT_OBJECT_ROOT ?? "").trim();
  if (objectRoot) await placeBundles(objectRoot, await loadManifest());
  console.log(`seed agent=${report.agentId} cards=${report.cardCount} followed=${report.followed} objects=${report.objects.length}`);
  for (const object of report.objects) {
    console.log(`${object.artifactId} ${object.path} sha256=${object.sha256} bytes=${object.bytes}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "seed failed");
    process.exit(1);
  });
}
