import { randomUUID } from "node:crypto";
import type { ObjectStore } from "../feed/objects.ts";
import { sha256Hex } from "./jcs.ts";
import type { CardImportStore } from "./store.ts";
import type { ClaimedImportJob } from "./types.ts";
import type { ZipStore } from "./uploads.ts";
import { emptyIdentity, validateCardPackage } from "./validate.ts";

export type CardImportWorker = {
  start(): Promise<void>;
  notify(): void;
  drain(): Promise<void>;
  stop(): Promise<void>;
};

export type CardImportWorkerDeps = {
  store: CardImportStore;
  zips: ZipStore;
  objects: ObjectStore;
  pollIntervalMs?: number;
};

const DEFAULT_POLL_MS = 2_000;

/**
 * In-process async worker for card-package imports.
 * Recovers jobs stuck in `validating` on startup, drains `queued` jobs serially,
 * stages immutable validated objects under `qbot/cards/`, and never auto-publishes.
 */
export function createCardImportWorker(deps: CardImportWorkerDeps): CardImportWorker {
  const pollMs = deps.pollIntervalMs ?? DEFAULT_POLL_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running: Promise<void> | null = null;
  let dirty = false;
  let stopped = false;

  async function processOne(job: ClaimedImportJob): Promise<void> {
    const zipBytes = await deps.zips.read(job.id);
    if (!zipBytes || sha256Hex(zipBytes) !== job.zipSha256) {
      await deps.store.markRejected(job.id, emptyIdentity(), [
        { code: "zip", message: "上传的 ZIP 文件不存在或校验和不一致" },
      ]);
      await deps.zips.remove(job.id);
      return;
    }

    const validated = await validateCardPackage({
      zipBytes,
      idempotencyKey: job.idempotencyKey,
      ownerId: job.ownerId,
      resolveBot: (ownerId, slug) => deps.store.findAllowedBot(ownerId, slug),
    });

    if (!validated.ok) {
      await deps.store.markRejected(job.id, validated.identity, validated.errors);
      await deps.zips.remove(job.id);
      return;
    }

    const { pkg } = validated;
    const identity = {
      agentId: pkg.agentId,
      botSlug: pkg.botSlug,
      cardKey: pkg.cardKey,
      contentVersion: pkg.contentVersion,
      expectedPreviousVersion: pkg.expectedPreviousVersion,
      manifestDigest: pkg.manifestDigest,
      contentDigest: pkg.contentDigest,
      sample: pkg.sample,
      authoringClaim: pkg.authoringClaim,
      cardTitle: pkg.cardTitle,
      cardAuthoredAt: pkg.cardAuthoredAt,
      visibilityMode: pkg.visibilityMode,
      visibleFrom: pkg.visibleFrom,
      visibleUntil: pkg.visibleUntil,
    };

    const precheck = await deps.store.checkPreconditions(job, pkg);
    if (precheck.kind === "conflict") {
      await deps.store.markRejected(job.id, identity, [precheck.error]);
      await deps.zips.remove(job.id);
      return;
    }
    if (precheck.kind === "duplicate") {
      await deps.store.markRejected(job.id, identity, [
        { code: "duplicate_import", message: `重复导入：请查询原任务 ${precheck.existing.importId}` },
      ]);
      await deps.zips.remove(job.id);
      return;
    }

    if (!deps.objects.write) {
      await deps.store.markRejected(job.id, identity, [
        { code: "storage_readonly", message: "当前对象存储不支持写入，无法暂存对象" },
      ]);
      await deps.zips.remove(job.id);
      return;
    }

    const artifactId = randomUUID();
    for (const file of pkg.files) {
      const ok = await deps.objects.write(artifactId, pkg.contentVersion, file.path, file.bytes, file.contentType);
      if (!ok) {
        await deps.store.markRejected(job.id, identity, [
          { code: "object_write", message: `不可变对象写入失败: ${file.path}`, path: file.path },
        ]);
        await deps.zips.remove(job.id);
        return;
      }
    }

    if (pkg.sample) {
      await deps.store.markStagedSample(job.id, pkg, artifactId);
      await deps.zips.remove(job.id);
      return;
    }

    const ready = await deps.store.markReady(job.id, pkg, artifactId);
    if (!ready.ok) {
      await deps.store.markRejected(job.id, identity, [ready.error]);
    }
    await deps.zips.remove(job.id);
  }

  async function loop(): Promise<void> {
    try {
      while (!stopped) {
        dirty = false;
        const job = await deps.store.claimNext();
        if (!job) {
          if (!dirty) break;
          continue;
        }
        try {
          await processOne(job);
        } catch (error) {
          console.error("card-import worker failed", error instanceof Error ? error.name : "error");
          await deps.store
            .markRejected(job.id, emptyIdentity(), [{ code: "internal", message: "异步校验过程中发生内部错误" }])
            .catch(() => {});
          await deps.zips.remove(job.id);
        }
      }
    } finally {
      running = null;
      if (dirty && !stopped) {
        kick();
      }
    }
  }

  function kick(): void {
    if (stopped) return;
    dirty = true;
    if (!running) {
      running = loop();
    }
  }

  return {
    async start() {
      stopped = false;
      await deps.store.recoverStuck();
      kick();
      timer = setInterval(() => {
        kick();
      }, pollMs);
      timer.unref();
    },
    notify() {
      kick();
    },
    async drain() {
      kick();
      while (running) {
        await running;
      }
    },
    async stop() {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (running) {
        await running;
      }
    },
  };
}
