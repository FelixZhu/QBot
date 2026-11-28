import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { isUuid } from "../feed/paths.ts";
import { PACKAGE_LIMITS } from "./limits.ts";

export type ZipStore = {
  save(importId: string, bytes: Buffer): Promise<void>;
  read(importId: string): Promise<Buffer | null>;
  remove(importId: string): Promise<void>;
};

/**
 * Durable local-disk storage for raw uploaded card-package ZIPs prior to validation.
 * Kept strictly outside the public OSS `qbot/cards/` prefix so rejected packages never
 * become public card objects and no server-side OSS DeleteObject permission is required.
 */
export function createLocalZipStore(directory: string): ZipStore {
  const base = path.resolve(directory);

  function resolveZipPath(importId: string, suffix = ".zip"): string {
    if (!isUuid(importId)) throw new Error("invalid import id");
    const full = path.resolve(base, `${importId}${suffix}`);
    if (!full.startsWith(base + path.sep)) throw new Error("import path escaped root");
    return full;
  }

  return {
    async save(importId, bytes) {
      if (bytes.length === 0 || bytes.length > PACKAGE_LIMITS.zipBytes) {
        throw new Error("invalid zip size");
      }
      await mkdir(base, { recursive: true, mode: 0o700 });
      const tmpPath = resolveZipPath(importId, ".zip.tmp");
      const finalPath = resolveZipPath(importId, ".zip");
      const handle = await open(tmpPath, "w", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(tmpPath, finalPath);
    },
    async read(importId) {
      let full: string;
      try {
        full = resolveZipPath(importId, ".zip");
      } catch {
        return null;
      }
      try {
        const bytes = await readFile(full);
        if (bytes.length === 0 || bytes.length > PACKAGE_LIMITS.zipBytes) return null;
        return bytes;
      } catch {
        return null;
      }
    },
    async remove(importId) {
      try {
        await rm(resolveZipPath(importId, ".zip"), { force: true });
        await rm(resolveZipPath(importId, ".zip.tmp"), { force: true });
      } catch {
        // Best-effort local cleanup; never fails the import state transition.
      }
    },
  };
}
