import { randomUUID } from "node:crypto";
import type pg from "pg";
import { HttpError } from "../errors.ts";
import { transaction } from "../store.ts";
import type {
  CardImportStatus,
  ClaimedImportJob,
  ImportError,
  ImportState,
  PackageIdentity,
  ValidatedPackage,
} from "./types.ts";

export type EnqueueInput = {
  importId: string;
  ownerId: string;
  idempotencyKey: string;
  zipSha256: string;
  zipBytes: number;
};

export type EnqueueResult =
  | { kind: "created"; importId: string }
  | { kind: "existing"; importId: string }
  | { kind: "conflict" };

export type PreconditionCheck =
  | { kind: "ok" }
  | { kind: "duplicate"; existing: CardImportStatus }
  | { kind: "conflict"; error: ImportError };

export type CardImportStore = {
  enqueue(input: EnqueueInput): Promise<EnqueueResult>;
  get(ownerId: string, importId: string): Promise<CardImportStatus | null>;
  recoverStuck(): Promise<number>;
  claimNext(): Promise<ClaimedImportJob | null>;
  findAllowedBot(ownerId: string, slug: string): Promise<{ id: string } | null>;
  checkPreconditions(job: ClaimedImportJob, pkg: ValidatedPackage): Promise<PreconditionCheck>;
  markRejected(importId: string, identity: PackageIdentity, errors: ImportError[]): Promise<void>;
  markStagedSample(importId: string, pkg: ValidatedPackage, artifactId: string): Promise<void>;
  markReady(importId: string, pkg: ValidatedPackage, artifactId: string): Promise<{ ok: true } | { ok: false; error: ImportError }>;
  publish(ownerId: string, importId: string, expectedPreviousVersion: number | null, now?: Date): Promise<CardImportStatus>;
  rollback(ownerId: string, importId: string): Promise<CardImportStatus>;
};

type ImportRow = {
  id: string;
  owner_id: string;
  idempotency_key: string;
  zip_sha256: string;
  zip_bytes: number;
  state: ImportState;
  agent_id: string | null;
  bot_slug: string | null;
  card_key: string | null;
  content_version: number | null;
  expected_previous_version: number | null;
  manifest_digest: string | null;
  content_digest: string | null;
  sample: boolean | null;
  authoring_claim: "human" | "bot" | null;
  card_title: string | null;
  card_authored_at: Date | null;
  visibility_mode: "manual" | "schedule" | null;
  visible_from: Date | null;
  visible_until: Date | null;
  card_id: string | null;
  artifact_id: string | null;
  failure_reason: string | null;
  failure_errors: ImportError[] | null;
};

type CardPointerRow = {
  id: string;
  artifact_id: string | null;
  title: string;
  authored_at: Date;
  published_at: Date;
  current_version: number | null;
  current_content_digest: string | null;
  current_import_id: string | null;
  visible_from: Date | null;
  visible_until: Date | null;
  previous_artifact_id: string | null;
  previous_version: number | null;
  previous_title: string | null;
  previous_authored_at: Date | null;
  previous_published_at: Date | null;
  previous_content_digest: string | null;
  previous_visible_from: Date | null;
  previous_visible_until: Date | null;
  previous_import_id: string | null;
};

export function createCardImportStore(pool: pg.Pool): CardImportStore {
  return {
    async enqueue(input) {
      return transaction(pool, async (query) => {
        const existing = await query<{ id: string; zip_sha256: string }>(
          `SELECT id, zip_sha256
           FROM card_imports
           WHERE owner_id = $1 AND idempotency_key = $2 AND state <> 'rejected'
           FOR UPDATE`,
          [input.ownerId, input.idempotencyKey],
        );
        const active = existing.rows[0];
        if (active) {
          if (active.zip_sha256 === input.zipSha256) {
            return { kind: "existing", importId: active.id };
          }
          return { kind: "conflict" };
        }
        const inserted = await query<{ id: string }>(
          `INSERT INTO card_imports (id, owner_id, idempotency_key, zip_sha256, zip_bytes, state)
           VALUES ($1, $2, $3, $4, $5, 'queued')
           ON CONFLICT (owner_id, idempotency_key) WHERE state <> 'rejected' DO NOTHING
           RETURNING id`,
          [input.importId, input.ownerId, input.idempotencyKey, input.zipSha256, input.zipBytes],
        );
        if (inserted.rows[0]) {
          return { kind: "created", importId: inserted.rows[0].id };
        }
        const raced = await query<{ id: string; zip_sha256: string }>(
          `SELECT id, zip_sha256
           FROM card_imports
           WHERE owner_id = $1 AND idempotency_key = $2 AND state <> 'rejected'`,
          [input.ownerId, input.idempotencyKey],
        );
        const row = raced.rows[0];
        if (row && row.zip_sha256 === input.zipSha256) {
          return { kind: "existing", importId: row.id };
        }
        return { kind: "conflict" };
      });
    },

    async get(ownerId, importId) {
      const result = await pool.query<ImportRow>(
        `SELECT * FROM card_imports WHERE id = $1 AND owner_id = $2`,
        [importId, ownerId],
      );
      const row = result.rows[0];
      return row ? toStatus(row) : null;
    },

    async recoverStuck() {
      const result = await pool.query(
        `UPDATE card_imports
         SET state = 'queued', updated_at = now()
         WHERE state = 'validating'`,
      );
      return result.rowCount ?? 0;
    },

    async claimNext() {
      const result = await pool.query<{
        id: string;
        owner_id: string;
        idempotency_key: string;
        zip_sha256: string;
        zip_bytes: number;
      }>(
        `UPDATE card_imports
         SET state = 'validating', updated_at = now()
         WHERE id = (
           SELECT id
           FROM card_imports
           WHERE state = 'queued'
           ORDER BY created_at ASC, id ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         RETURNING id, owner_id, idempotency_key, zip_sha256, zip_bytes`,
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        ownerId: row.owner_id,
        idempotencyKey: row.idempotency_key,
        zipSha256: row.zip_sha256,
        zipBytes: row.zip_bytes,
      };
    },

    async findAllowedBot(ownerId, slug) {
      const result = await pool.query<{ id: string }>(
        `SELECT id FROM agents WHERE owner_id = $1 AND slug = $2 AND visibility = 'public'`,
        [ownerId, slug],
      );
      return result.rows[0] ?? null;
    },

    async checkPreconditions(job, pkg) {
      if (pkg.sample) return { kind: "ok" };

      const tuple = await pool.query<ImportRow>(
        `SELECT *
         FROM card_imports
         WHERE owner_id = $1
           AND agent_id = $2
           AND card_key = $3
           AND content_version = $4
           AND state <> 'rejected'
           AND COALESCE(sample, false) = false
           AND id <> $5
         LIMIT 1`,
        [job.ownerId, pkg.agentId, pkg.cardKey, pkg.contentVersion, job.id],
      );
      const existingTuple = tuple.rows[0];
      if (existingTuple) {
        if (existingTuple.manifest_digest === pkg.manifestDigest) {
          return { kind: "duplicate", existing: toStatus(existingTuple) };
        }
        return {
          kind: "conflict",
          error: {
            code: "version_conflict",
            message: "同一 owner、Bot、cardKey 与 contentVersion 已存在不同的 manifestDigest",
            path: "/contentVersion",
          },
        };
      }

      const cardRes = await pool.query<{ id: string; current_version: number | null }>(
        `SELECT id, current_version FROM cards WHERE agent_id = $1 AND card_key = $2`,
        [pkg.agentId, pkg.cardKey],
      );
      const card = cardRes.rows[0];
      const currentVersion = card?.current_version ?? null;
      let maxArtifactVersion: number | null = null;
      if (card) {
        const maxRes = await pool.query<{ max_ver: number | null }>(
          `SELECT max(version)::int AS max_ver FROM artifacts WHERE card_id = $1`,
          [card.id],
        );
        maxArtifactVersion = maxRes.rows[0]?.max_ver ?? null;
      }
      const versionError = checkVersionOrder(pkg.contentVersion, pkg.expectedPreviousVersion, currentVersion, maxArtifactVersion);
      if (versionError) return { kind: "conflict", error: versionError };
      return { kind: "ok" };
    },

    async markRejected(importId, identity, errors) {
      const reason = errors.map((e) => e.message).join("; ") || "卡片包校验失败";
      await pool.query(
        `UPDATE card_imports
         SET state = 'rejected',
             agent_id = $2,
             bot_slug = $3,
             card_key = $4,
             content_version = $5,
             expected_previous_version = $6,
             manifest_digest = $7,
             content_digest = $8,
             sample = $9,
             authoring_claim = $10,
             card_title = $11,
             card_authored_at = $12::timestamptz,
             visibility_mode = $13,
             visible_from = $14::timestamptz,
             visible_until = $15::timestamptz,
             failure_reason = $16,
             failure_errors = $17::jsonb,
             updated_at = now()
         WHERE id = $1`,
        [
          importId,
          identity.agentId,
          identity.botSlug,
          identity.cardKey,
          identity.contentVersion,
          identity.expectedPreviousVersion,
          identity.manifestDigest,
          identity.contentDigest,
          identity.sample,
          identity.authoringClaim,
          identity.cardTitle,
          identity.cardAuthoredAt,
          identity.visibilityMode,
          identity.visibleFrom,
          identity.visibleUntil,
          reason,
          JSON.stringify(errors),
        ],
      );
    },

    async markStagedSample(importId, pkg, artifactId) {
      await pool.query(
        `UPDATE card_imports
         SET state = 'staged',
             agent_id = $2,
             bot_slug = $3,
             card_key = $4,
             content_version = $5,
             expected_previous_version = $6,
             manifest_digest = $7,
             content_digest = $8,
             sample = true,
             authoring_claim = $9,
             card_title = $10,
             card_authored_at = $11::timestamptz,
             visibility_mode = $12,
             visible_from = $13::timestamptz,
             visible_until = $14::timestamptz,
             artifact_id = $15,
             failure_reason = NULL,
             failure_errors = NULL,
             updated_at = now()
         WHERE id = $1`,
        [
          importId,
          pkg.agentId,
          pkg.botSlug,
          pkg.cardKey,
          pkg.contentVersion,
          pkg.expectedPreviousVersion,
          pkg.manifestDigest,
          pkg.contentDigest,
          pkg.authoringClaim,
          pkg.cardTitle,
          pkg.cardAuthoredAt,
          pkg.visibilityMode,
          pkg.visibleFrom,
          pkg.visibleUntil,
          artifactId,
        ],
      );
    },

    async markReady(importId, pkg, artifactId) {
      return transaction(pool, async (query) => {
        const jobRes = await query<{ owner_id: string }>(
          `SELECT owner_id FROM card_imports WHERE id = $1 FOR UPDATE`,
          [importId],
        );
        const ownerId = jobRes.rows[0]?.owner_id;
        if (!ownerId) {
          return { ok: false, error: { code: "not_found", message: "导入任务不存在" } };
        }

        const tuple = await query<{ id: string; manifest_digest: string | null }>(
          `SELECT id, manifest_digest
           FROM card_imports
           WHERE owner_id = $1
             AND agent_id = $2
             AND card_key = $3
             AND content_version = $4
             AND state <> 'rejected'
             AND COALESCE(sample, false) = false
             AND id <> $5
           LIMIT 1`,
          [ownerId, pkg.agentId, pkg.cardKey, pkg.contentVersion, importId],
        );
        if (tuple.rows[0]) {
          return {
            ok: false,
            error: {
              code: "version_conflict",
              message: "同一 owner、Bot、cardKey 与 contentVersion 已存在冲突任务",
              path: "/contentVersion",
            },
          };
        }

        // Ensure hidden card shell exists (artifact_id remains NULL until explicit publish).
        await query(
          `INSERT INTO cards (id, agent_id, card_key, visibility, title, published_at, authored_at, provenance, artifact_id)
           VALUES ($1, $2, $3, 'public', $4, now(), $5::timestamptz, 'manual', NULL)
           ON CONFLICT (agent_id, card_key) WHERE card_key IS NOT NULL DO NOTHING`,
          [randomUUID(), pkg.agentId, pkg.cardKey, pkg.cardTitle, pkg.cardAuthoredAt],
        );

        const cardRes = await query<{ id: string; current_version: number | null }>(
          `SELECT id, current_version FROM cards WHERE agent_id = $1 AND card_key = $2 FOR UPDATE`,
          [pkg.agentId, pkg.cardKey],
        );
        const card = cardRes.rows[0];
        if (!card) throw new HttpError(500, "persist", "数据库没有完成写入");

        const maxRes = await query<{ max_ver: number | null }>(
          `SELECT max(version)::int AS max_ver FROM artifacts WHERE card_id = $1`,
          [card.id],
        );
        const maxArtifactVersion = maxRes.rows[0]?.max_ver ?? null;
        const versionError = checkVersionOrder(
          pkg.contentVersion,
          pkg.expectedPreviousVersion,
          card.current_version,
          maxArtifactVersion,
        );
        if (versionError) return { ok: false, error: versionError };

        // Write hidden version row (cards.artifact_id is NOT changed).
        await query(
          `INSERT INTO artifacts (id, card_id, version, manifest_sha256)
           VALUES ($1, $2, $3, $4)`,
          [artifactId, card.id, pkg.contentVersion, pkg.manifestDigest],
        );
        for (const file of pkg.files) {
          await query(
            `INSERT INTO artifact_files (artifact_id, rel_path, sha256, byte_length, content_type, role)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [artifactId, file.path, file.sha256, file.byteLength, file.contentType, file.role],
          );
        }

        await query(
          `UPDATE card_imports
           SET state = 'ready',
               agent_id = $2,
               bot_slug = $3,
               card_key = $4,
               content_version = $5,
               expected_previous_version = $6,
               manifest_digest = $7,
               content_digest = $8,
               sample = false,
               authoring_claim = $9,
               card_title = $10,
               card_authored_at = $11::timestamptz,
               visibility_mode = $12,
               visible_from = $13::timestamptz,
               visible_until = $14::timestamptz,
               card_id = $15,
               artifact_id = $16,
               failure_reason = NULL,
               failure_errors = NULL,
               updated_at = now()
           WHERE id = $1`,
          [
            importId,
            pkg.agentId,
            pkg.botSlug,
            pkg.cardKey,
            pkg.contentVersion,
            pkg.expectedPreviousVersion,
            pkg.manifestDigest,
            pkg.contentDigest,
            pkg.authoringClaim,
            pkg.cardTitle,
            pkg.cardAuthoredAt,
            pkg.visibilityMode,
            pkg.visibleFrom,
            pkg.visibleUntil,
            card.id,
            artifactId,
          ],
        );
        return { ok: true };
      });
    },

    async publish(ownerId, importId, expectedPreviousVersion, now = new Date()) {
      return transaction(pool, async (query) => {
        const res = await query<ImportRow>(
          `SELECT * FROM card_imports WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
          [importId, ownerId],
        );
        const job = res.rows[0];
        if (!job) throw new HttpError(404, "not_found", "没有这个导入任务");
        if (job.sample === true) {
          throw new HttpError(409, "sample_not_publishable", "sample 卡片包不允许发布");
        }
        if (job.state !== "ready") {
          throw new HttpError(409, "invalid_state", `当前状态为 ${job.state}，只有 ready 可以发布`);
        }
        if (!job.card_id || !job.artifact_id || !job.content_version || !job.content_digest || !job.card_title || !job.card_authored_at) {
          throw new HttpError(409, "invalid_state", "导入任务缺少已暂存的版本信息");
        }
        if (job.expected_previous_version !== expectedPreviousVersion) {
          throw new HttpError(409, "version_conflict", "expectedPreviousVersion 与导入清单不一致");
        }
        if (job.visible_until && now.getTime() > job.visible_until.getTime()) {
          throw new HttpError(409, "window_expired", "已超过 visibility.notAfter，不补发");
        }

        const cardRes = await query<CardPointerRow>(
          `SELECT id, artifact_id, title, authored_at, published_at,
                  current_version, current_content_digest, current_import_id,
                  visible_from, visible_until,
                  previous_artifact_id, previous_version, previous_title,
                  previous_authored_at, previous_published_at, previous_content_digest,
                  previous_visible_from, previous_visible_until, previous_import_id
           FROM cards
           WHERE id = $1
           FOR UPDATE`,
          [job.card_id],
        );
        const card = cardRes.rows[0];
        if (!card) throw new HttpError(409, "invalid_state", "目标卡片不存在");

        if (card.current_version !== expectedPreviousVersion) {
          throw new HttpError(409, "version_conflict", "expectedPreviousVersion 与服务端当前可见版本不一致");
        }

        // Cross-version semantic digest deduplication: never publicly re-expose unchanged content across versions.
        if (card.current_version !== null && card.current_content_digest === job.content_digest) {
          throw new HttpError(409, "content_unchanged", "跨版本 contentDigest 与当前已公开版相同，不再重复公开");
        }

        await query(
          `UPDATE cards
           SET previous_artifact_id = artifact_id,
               previous_version = current_version,
               previous_title = title,
               previous_authored_at = authored_at,
               previous_published_at = published_at,
               previous_content_digest = current_content_digest,
               previous_visible_from = visible_from,
               previous_visible_until = visible_until,
               previous_import_id = current_import_id,
               artifact_id = $2,
               current_version = $3,
               title = $4,
               authored_at = $5::timestamptz,
               published_at = $6::timestamptz,
               current_content_digest = $7,
               visible_from = $8::timestamptz,
               visible_until = $9::timestamptz,
               current_import_id = $10,
               visibility = 'public'
           WHERE id = $1`,
          [
            card.id,
            job.artifact_id,
            job.content_version,
            job.card_title,
            job.card_authored_at.toISOString(),
            now.toISOString(),
            job.content_digest,
            job.visible_from ? job.visible_from.toISOString() : null,
            job.visible_until ? job.visible_until.toISOString() : null,
            job.id,
          ],
        );

        const updated = await query<ImportRow>(
          `UPDATE card_imports
           SET state = 'published', published_at = $2::timestamptz, updated_at = now()
           WHERE id = $1
           RETURNING *`,
          [job.id, now.toISOString()],
        );
        const row = updated.rows[0];
        if (!row) throw new HttpError(500, "persist", "数据库没有完成写入");
        return toStatus(row);
      });
    },

    async rollback(ownerId, importId) {
      return transaction(pool, async (query) => {
        const res = await query<ImportRow>(
          `SELECT * FROM card_imports WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
          [importId, ownerId],
        );
        const job = res.rows[0];
        if (!job) throw new HttpError(404, "not_found", "没有这个导入任务");
        if (job.state !== "published") {
          throw new HttpError(409, "invalid_state", `当前状态为 ${job.state}，只有 published 可以回滚`);
        }
        if (!job.card_id) {
          throw new HttpError(409, "invalid_state", "目标卡片已被删除，无法回滚");
        }

        const cardRes = await query<CardPointerRow>(
          `SELECT id, artifact_id, title, authored_at, published_at,
                  current_version, current_content_digest, current_import_id,
                  visible_from, visible_until,
                  previous_artifact_id, previous_version, previous_title,
                  previous_authored_at, previous_published_at, previous_content_digest,
                  previous_visible_from, previous_visible_until, previous_import_id
           FROM cards
           WHERE id = $1
           FOR UPDATE`,
          [job.card_id],
        );
        const card = cardRes.rows[0];
        if (!card || card.current_import_id !== job.id) {
          throw new HttpError(409, "invalid_state", "当前可见指针已不是这个导入版本，无法回滚");
        }

        if (card.previous_artifact_id) {
          await query(
            `UPDATE cards
             SET artifact_id = previous_artifact_id,
                 current_version = previous_version,
                 title = COALESCE(previous_title, title),
                 authored_at = COALESCE(previous_authored_at, authored_at),
                 published_at = COALESCE(previous_published_at, published_at),
                 current_content_digest = previous_content_digest,
                 visible_from = previous_visible_from,
                 visible_until = previous_visible_until,
                 current_import_id = previous_import_id,
                 previous_artifact_id = NULL,
                 previous_version = NULL,
                 previous_title = NULL,
                 previous_authored_at = NULL,
                 previous_published_at = NULL,
                 previous_content_digest = NULL,
                 previous_visible_from = NULL,
                 previous_visible_until = NULL,
                 previous_import_id = NULL
             WHERE id = $1`,
            [card.id],
          );
        } else {
          await query(
            `UPDATE cards
             SET artifact_id = NULL,
                 current_version = NULL,
                 current_content_digest = NULL,
                 visible_from = NULL,
                 visible_until = NULL,
                 current_import_id = NULL,
                 previous_artifact_id = NULL,
                 previous_version = NULL,
                 previous_title = NULL,
                 previous_authored_at = NULL,
                 previous_published_at = NULL,
                 previous_content_digest = NULL,
                 previous_visible_from = NULL,
                 previous_visible_until = NULL,
                 previous_import_id = NULL
             WHERE id = $1`,
            [card.id],
          );
        }

        const updated = await query<ImportRow>(
          `UPDATE card_imports
           SET state = 'rolled-back', rolled_back_at = now(), updated_at = now()
           WHERE id = $1
           RETURNING *`,
          [job.id],
        );
        const row = updated.rows[0];
        if (!row) throw new HttpError(500, "persist", "数据库没有完成写入");
        return toStatus(row);
      });
    },
  };
}

export function checkVersionOrder(
  contentVersion: number,
  expectedPreviousVersion: number | null,
  currentPublishedVersion: number | null,
  maxExistingArtifactVersion: number | null,
): ImportError | null {
  if (expectedPreviousVersion !== currentPublishedVersion) {
    return {
      code: "version_conflict",
      message: `expectedPreviousVersion 必须等于服务端当前已有版本 (${currentPublishedVersion === null ? "null" : currentPublishedVersion})`,
      path: "/expectedPreviousVersion",
    };
  }
  if (currentPublishedVersion === null && maxExistingArtifactVersion === null) {
    if (contentVersion !== 1) {
      return {
        code: "version_conflict",
        message: "第一版的 contentVersion 必须为 1",
        path: "/contentVersion",
      };
    }
    return null;
  }
  const floor = Math.max(currentPublishedVersion ?? 0, maxExistingArtifactVersion ?? 0);
  if (contentVersion <= floor) {
    return {
      code: "version_conflict",
      message: `contentVersion 必须严格递增并大于已有版本 (${floor})`,
      path: "/contentVersion",
    };
  }
  return null;
}

export function toStatus(row: ImportRow): CardImportStatus {
  const publishAllowed = row.state === "ready" && row.sample === false;
  const status: CardImportStatus = {
    importId: row.id,
    state: row.state,
    ownerBound: true,
    botSlug: row.bot_slug,
    cardKey: row.card_key,
    contentVersion: row.content_version === null ? null : Number(row.content_version),
    manifestDigest: row.manifest_digest,
    contentDigest: row.content_digest,
    sample: row.sample,
    publishAllowed,
    visibility: row.state === "published" ? "public" : "hidden",
    notification: "not-authorized",
    cardId: row.card_id,
  };
  if (row.state === "rejected") {
    status.reason = row.failure_reason ?? "卡片包校验失败";
    if (Array.isArray(row.failure_errors)) {
      status.errors = row.failure_errors;
    }
  }
  return status;
}
