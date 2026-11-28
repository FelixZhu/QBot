import { randomUUID } from "node:crypto";
import { HttpError } from "../src/errors.ts";
import { checkVersionOrder, type CardImportStore } from "../src/card-import/store.ts";
import type { CardImportStatus, ImportError, ImportState, ValidatedPackageFile } from "../src/card-import/types.ts";

export type MemoryBot = {
  id: string;
  ownerId: string;
  slug: string;
  visibility: "public" | "private" | null;
};

export type MemoryCard = {
  id: string;
  agentId: string;
  cardKey: string;
  artifactId: string | null;
  title: string;
  authoredAt: string;
  publishedAt: string | null;
  currentVersion: number | null;
  currentContentDigest: string | null;
  currentImportId: string | null;
  visibleFrom: string | null;
  visibleUntil: string | null;
  previous: {
    artifactId: string;
    version: number;
    title: string;
    authoredAt: string;
    publishedAt: string | null;
    contentDigest: string | null;
    visibleFrom: string | null;
    visibleUntil: string | null;
    importId: string | null;
  } | null;
};

type MemoryImport = {
  id: string;
  ownerId: string;
  idempotencyKey: string;
  zipSha256: string;
  zipBytes: number;
  state: ImportState;
  agentId: string | null;
  botSlug: string | null;
  cardKey: string | null;
  contentVersion: number | null;
  expectedPreviousVersion: number | null;
  manifestDigest: string | null;
  contentDigest: string | null;
  sample: boolean | null;
  cardTitle: string | null;
  cardAuthoredAt: string | null;
  visibleFrom: string | null;
  visibleUntil: string | null;
  cardId: string | null;
  artifactId: string | null;
  failureReason: string | null;
  failureErrors: ImportError[] | null;
  createdAt: number;
};

/**
 * In-memory implementation of CardImportStore with the exact same state machine,
 * idempotency rules, 4-tuple constraints, and publish/rollback pointer semantics as Postgres.
 */
export function createMemoryCardImportStore(bots: MemoryBot[]) {
  const imports = new Map<string, MemoryImport>();
  const cards = new Map<string, MemoryCard>();
  const artifacts = new Map<string, { id: string; cardId: string; version: number; manifestDigest: string; files: ValidatedPackageFile[] }>();
  let seq = 0;

  function toStatus(row: MemoryImport): CardImportStatus {
    const status: CardImportStatus = {
      importId: row.id,
      state: row.state,
      ownerBound: true,
      botSlug: row.botSlug,
      cardKey: row.cardKey,
      contentVersion: row.contentVersion,
      manifestDigest: row.manifestDigest,
      contentDigest: row.contentDigest,
      sample: row.sample,
      publishAllowed: row.state === "ready" && row.sample === false,
      visibility: row.state === "published" ? "public" : "hidden",
      notification: "not-authorized",
      cardId: row.cardId,
    };
    if (row.state === "rejected") {
      status.reason = row.failureReason ?? "卡片包校验失败";
      if (row.failureErrors) status.errors = row.failureErrors;
    }
    return status;
  }

  function findCard(agentId: string, cardKey: string): MemoryCard | undefined {
    for (const card of cards.values()) {
      if (card.agentId === agentId && card.cardKey === cardKey) return card;
    }
    return undefined;
  }

  function maxArtifactVersion(cardId: string): number | null {
    let max: number | null = null;
    for (const art of artifacts.values()) {
      if (art.cardId === cardId && (max === null || art.version > max)) max = art.version;
    }
    return max;
  }

  const store: CardImportStore = {
    async enqueue(input) {
      for (const row of imports.values()) {
        if (row.ownerId === input.ownerId && row.idempotencyKey === input.idempotencyKey && row.state !== "rejected") {
          if (row.zipSha256 === input.zipSha256) return { kind: "existing", importId: row.id };
          return { kind: "conflict" };
        }
      }
      seq += 1;
      imports.set(input.importId, {
        id: input.importId,
        ownerId: input.ownerId,
        idempotencyKey: input.idempotencyKey,
        zipSha256: input.zipSha256,
        zipBytes: input.zipBytes,
        state: "queued",
        agentId: null,
        botSlug: null,
        cardKey: null,
        contentVersion: null,
        expectedPreviousVersion: null,
        manifestDigest: null,
        contentDigest: null,
        sample: null,
        cardTitle: null,
        cardAuthoredAt: null,
        visibleFrom: null,
        visibleUntil: null,
        cardId: null,
        artifactId: null,
        failureReason: null,
        failureErrors: null,
        createdAt: seq,
      });
      return { kind: "created", importId: input.importId };
    },

    async get(ownerId, importId) {
      const row = imports.get(importId);
      if (!row || row.ownerId !== ownerId) return null;
      return toStatus(row);
    },

    async recoverStuck() {
      let count = 0;
      for (const row of imports.values()) {
        if (row.state === "validating") {
          row.state = "queued";
          count += 1;
        }
      }
      return count;
    },

    async claimNext() {
      const queued = [...imports.values()].filter((r) => r.state === "queued").sort((a, b) => a.createdAt - b.createdAt);
      const next = queued[0];
      if (!next) return null;
      next.state = "validating";
      return {
        id: next.id,
        ownerId: next.ownerId,
        idempotencyKey: next.idempotencyKey,
        zipSha256: next.zipSha256,
        zipBytes: next.zipBytes,
      };
    },

    async findAllowedBot(ownerId, slug) {
      const hit = bots.find((b) => b.ownerId === ownerId && b.slug === slug && b.visibility === "public");
      return hit ? { id: hit.id } : null;
    },

    async checkPreconditions(job, pkg) {
      if (pkg.sample) return { kind: "ok" };
      for (const row of imports.values()) {
        if (
          row.id !== job.id
          && row.ownerId === job.ownerId
          && row.agentId === pkg.agentId
          && row.cardKey === pkg.cardKey
          && row.contentVersion === pkg.contentVersion
          && row.state !== "rejected"
          && row.sample !== true
        ) {
          if (row.manifestDigest === pkg.manifestDigest) return { kind: "duplicate", existing: toStatus(row) };
          return {
            kind: "conflict",
            error: {
              code: "version_conflict",
              message: "同一 owner、Bot、cardKey 与 contentVersion 已存在不同的 manifestDigest",
              path: "/contentVersion",
            },
          };
        }
      }
      const card = findCard(pkg.agentId, pkg.cardKey);
      const currentVersion = card?.currentVersion ?? null;
      const maxVer = card ? maxArtifactVersion(card.id) : null;
      const err = checkVersionOrder(pkg.contentVersion, pkg.expectedPreviousVersion, currentVersion, maxVer);
      if (err) return { kind: "conflict", error: err };
      return { kind: "ok" };
    },

    async markRejected(importId, identity, errors) {
      const row = imports.get(importId);
      if (!row) return;
      row.state = "rejected";
      row.agentId = identity.agentId;
      row.botSlug = identity.botSlug;
      row.cardKey = identity.cardKey;
      row.contentVersion = identity.contentVersion;
      row.expectedPreviousVersion = identity.expectedPreviousVersion;
      row.manifestDigest = identity.manifestDigest;
      row.contentDigest = identity.contentDigest;
      row.sample = identity.sample;
      row.cardTitle = identity.cardTitle;
      row.cardAuthoredAt = identity.cardAuthoredAt;
      row.visibleFrom = identity.visibleFrom;
      row.visibleUntil = identity.visibleUntil;
      row.failureReason = errors.map((e) => e.message).join("; ") || "卡片包校验失败";
      row.failureErrors = errors;
    },

    async markStagedSample(importId, pkg, artifactId) {
      const row = imports.get(importId);
      if (!row) return;
      row.state = "staged";
      row.agentId = pkg.agentId;
      row.botSlug = pkg.botSlug;
      row.cardKey = pkg.cardKey;
      row.contentVersion = pkg.contentVersion;
      row.expectedPreviousVersion = pkg.expectedPreviousVersion;
      row.manifestDigest = pkg.manifestDigest;
      row.contentDigest = pkg.contentDigest;
      row.sample = true;
      row.cardTitle = pkg.cardTitle;
      row.cardAuthoredAt = pkg.cardAuthoredAt;
      row.visibleFrom = pkg.visibleFrom;
      row.visibleUntil = pkg.visibleUntil;
      row.artifactId = artifactId;
      row.cardId = null;
    },

    async markReady(importId, pkg, artifactId) {
      const row = imports.get(importId);
      if (!row) return { ok: false, error: { code: "not_found", message: "导入任务不存在" } };
      let card = findCard(pkg.agentId, pkg.cardKey);
      if (!card) {
        card = {
          id: randomUUID(),
          agentId: pkg.agentId,
          cardKey: pkg.cardKey,
          artifactId: null,
          title: pkg.cardTitle,
          authoredAt: pkg.cardAuthoredAt,
          publishedAt: null,
          currentVersion: null,
          currentContentDigest: null,
          currentImportId: null,
          visibleFrom: null,
          visibleUntil: null,
          previous: null,
        };
        cards.set(card.id, card);
      }
      const err = checkVersionOrder(pkg.contentVersion, pkg.expectedPreviousVersion, card.currentVersion, maxArtifactVersion(card.id));
      if (err) return { ok: false, error: err };
      artifacts.set(artifactId, {
        id: artifactId,
        cardId: card.id,
        version: pkg.contentVersion,
        manifestDigest: pkg.manifestDigest,
        files: pkg.files,
      });
      row.state = "ready";
      row.agentId = pkg.agentId;
      row.botSlug = pkg.botSlug;
      row.cardKey = pkg.cardKey;
      row.contentVersion = pkg.contentVersion;
      row.expectedPreviousVersion = pkg.expectedPreviousVersion;
      row.manifestDigest = pkg.manifestDigest;
      row.contentDigest = pkg.contentDigest;
      row.sample = false;
      row.cardTitle = pkg.cardTitle;
      row.cardAuthoredAt = pkg.cardAuthoredAt;
      row.visibleFrom = pkg.visibleFrom;
      row.visibleUntil = pkg.visibleUntil;
      row.cardId = card.id;
      row.artifactId = artifactId;
      return { ok: true };
    },

    async publish(ownerId, importId, expectedPreviousVersion, now = new Date()) {
      const row = imports.get(importId);
      if (!row || row.ownerId !== ownerId) throw new HttpError(404, "not_found", "没有这个导入任务");
      if (row.sample === true) throw new HttpError(409, "sample_not_publishable", "sample 卡片包不允许发布");
      if (row.state !== "ready") throw new HttpError(409, "invalid_state", `当前状态为 ${row.state}，只有 ready 可以发布`);
      if (row.expectedPreviousVersion !== expectedPreviousVersion) {
        throw new HttpError(409, "version_conflict", "expectedPreviousVersion 与导入清单不一致");
      }
      if (row.visibleUntil && now.getTime() > Date.parse(row.visibleUntil)) {
        throw new HttpError(409, "window_expired", "已超过 visibility.notAfter，不补发");
      }
      const card = row.cardId ? cards.get(row.cardId) : undefined;
      if (!card) throw new HttpError(409, "invalid_state", "目标卡片不存在");
      if (card.currentVersion !== expectedPreviousVersion) {
        throw new HttpError(409, "version_conflict", "expectedPreviousVersion 与服务端当前可见版本不一致");
      }
      if (card.currentVersion !== null && card.currentContentDigest === row.contentDigest) {
        throw new HttpError(409, "content_unchanged", "跨版本 contentDigest 与当前已公开版相同，不再重复公开");
      }
      card.previous = card.artifactId && card.currentVersion !== null
        ? {
          artifactId: card.artifactId,
          version: card.currentVersion,
          title: card.title,
          authoredAt: card.authoredAt,
          publishedAt: card.publishedAt,
          contentDigest: card.currentContentDigest,
          visibleFrom: card.visibleFrom,
          visibleUntil: card.visibleUntil,
          importId: card.currentImportId,
        }
        : null;
      card.artifactId = row.artifactId;
      card.currentVersion = row.contentVersion;
      card.title = row.cardTitle!;
      card.authoredAt = row.cardAuthoredAt!;
      card.publishedAt = now.toISOString();
      card.currentContentDigest = row.contentDigest;
      card.visibleFrom = row.visibleFrom;
      card.visibleUntil = row.visibleUntil;
      card.currentImportId = row.id;
      row.state = "published";
      return toStatus(row);
    },

    async rollback(ownerId, importId) {
      const row = imports.get(importId);
      if (!row || row.ownerId !== ownerId) throw new HttpError(404, "not_found", "没有这个导入任务");
      if (row.state !== "published") throw new HttpError(409, "invalid_state", `当前状态为 ${row.state}，只有 published 可以回滚`);
      const card = row.cardId ? cards.get(row.cardId) : undefined;
      if (!card || card.currentImportId !== row.id) {
        throw new HttpError(409, "invalid_state", "当前可见指针已不是这个导入版本，无法回滚");
      }
      if (card.previous) {
        card.artifactId = card.previous.artifactId;
        card.currentVersion = card.previous.version;
        card.title = card.previous.title;
        card.authoredAt = card.previous.authoredAt;
        card.publishedAt = card.previous.publishedAt;
        card.currentContentDigest = card.previous.contentDigest;
        card.visibleFrom = card.previous.visibleFrom;
        card.visibleUntil = card.previous.visibleUntil;
        card.currentImportId = card.previous.importId;
        card.previous = null;
      } else {
        card.artifactId = null;
        card.currentVersion = null;
        card.currentContentDigest = null;
        card.visibleFrom = null;
        card.visibleUntil = null;
        card.currentImportId = null;
      }
      row.state = "rolled-back";
      return toStatus(row);
    },
  };

  return { store, imports, cards, artifacts };
}
