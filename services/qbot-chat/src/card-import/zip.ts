import yauzl from "yauzl";
import { PACKAGE_LIMITS, ZIP_EMPTY_MAGIC, ZIP_LOCAL_MAGIC } from "./limits.ts";
import type { ImportError } from "./types.ts";

export const PACKAGE_PREFIX = "card-package/";

export type ZipRead = {
  files: Map<string, Buffer>;
  fatal: ImportError | null;
};

/** Shallow magic-byte check for POST /v1/card-imports before full async unzip. */
export function hasZipMagic(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  const head = buffer.subarray(0, 4);
  return head.equals(ZIP_LOCAL_MAGIC) || head.equals(ZIP_EMPTY_MAGIC);
}

/**
 * Read a card-package ZIP from an already size-capped buffer.
 * Streams each entry and aborts immediately when a size or compression-ratio limit trips.
 * Supports the documented `card-package/` top-level directory layout (and unprefixed root layout
 * when no `card-package/` directory is present); rejects mixed layouts.
 */
export async function readPackageZip(buffer: Buffer): Promise<ZipRead> {
  if (buffer.length > PACKAGE_LIMITS.zipBytes) {
    return { files: new Map(), fatal: { code: "zip_limit", message: "ZIP 超过 8MiB" } };
  }
  let zip: yauzl.ZipFile;
  try {
    zip = await openZip(buffer);
  } catch {
    return { files: new Map(), fatal: { code: "zip", message: "ZIP 无法打开" } };
  }
  const rawFiles = new Map<string, Buffer>();
  const rawDirs: string[] = [];
  let total = 0;
  let count = 0;
  try {
    for await (const entry of iterate(zip)) {
      const named = entryName(entry);
      if (typeof named !== "string") return fatal(zip, named);
      const name = named;
      if (name.endsWith("/")) {
        const dirName = name.slice(0, -1);
        const pathError = checkPath(dirName);
        if (pathError) return fatal(zip, pathError);
        rawDirs.push(dirName);
        continue;
      }
      const pathError = checkPath(name);
      if (pathError) return fatal(zip, pathError);
      if (isSymlink(entry)) {
        return fatal(zip, { code: "symlink", message: `禁止符号链接: ${clip(name)}`, path: clip(name) });
      }
      if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
        return fatal(zip, { code: "zip", message: "不接受加密 ZIP", path: clip(name) });
      }
      if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
        return fatal(zip, { code: "zip", message: "不接受这种压缩方法", path: clip(name) });
      }
      if (!Number.isSafeInteger(entry.uncompressedSize) || !Number.isSafeInteger(entry.compressedSize)) {
        return fatal(zip, { code: "unzipped_limit", message: `单文件超过 8MiB: ${clip(name)}`, path: clip(name) });
      }
      if (entry.uncompressedSize > PACKAGE_LIMITS.fileBytes) {
        return fatal(zip, { code: "unzipped_limit", message: `单文件超过 8MiB: ${clip(name)}`, path: clip(name) });
      }
      if (entry.compressedSize > PACKAGE_LIMITS.zipBytes) {
        return fatal(zip, { code: "zip_limit", message: "ZIP 超过 8MiB", path: clip(name) });
      }
      if (overRatio(entry.uncompressedSize, entry.compressedSize)) {
        return fatal(zip, { code: "compression_ratio", message: `压缩比超过 100:1: ${clip(name)}`, path: clip(name) });
      }
      count += 1;
      if (count > PACKAGE_LIMITS.zipEntries) {
        return fatal(zip, { code: "file_count", message: "文件超过 32 个" });
      }
      let bytes: Buffer;
      try {
        bytes = await inflateLimited(zip, entry);
      } catch (error) {
        const code = error instanceof LimitError ? error.limitCode : "zip";
        const message = code === "compression_ratio"
          ? `压缩比超过 100:1: ${clip(name)}`
          : code === "unzipped_limit"
            ? `解压超过限额: ${clip(name)}`
            : "ZIP 无法打开";
        return fatal(zip, { code, message, path: clip(name) });
      }
      total += bytes.length;
      if (total > PACKAGE_LIMITS.totalBytes) {
        return fatal(zip, { code: "unzipped_limit", message: "解压后超过 32MiB" });
      }
      if (rawFiles.has(name)) {
        return fatal(zip, { code: "files", message: `路径重复: ${clip(name)}`, path: clip(name) });
      }
      rawFiles.set(name, bytes);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      message.startsWith("absolute path:")
      || message.startsWith("invalid relative path:")
      || message.startsWith("invalid characters in fileName:")
    ) {
      const reported = message.split(": ").slice(1).join(": ");
      return fatal(zip, { code: "path", message: "路径不能包含 .. 、反斜杠或绝对路径", path: clip(reported) });
    }
    return fatal(zip, { code: "zip", message: "ZIP 无法打开" });
  }
  zip.close();

  const hasPrefix = [...rawFiles.keys()].some((name) => name.startsWith(PACKAGE_PREFIX))
    || rawDirs.some((dir) => dir === "card-package" || dir.startsWith(PACKAGE_PREFIX));

  if (!hasPrefix) {
    return { files: rawFiles, fatal: null };
  }

  for (const dir of rawDirs) {
    if (dir !== "card-package" && !dir.startsWith(PACKAGE_PREFIX)) {
      return { files: new Map(), fatal: { code: "path", message: `路径必须位于 ${PACKAGE_PREFIX} 目录下: ${clip(dir)}`, path: clip(dir) } };
    }
  }

  const normalized = new Map<string, Buffer>();
  for (const [name, bytes] of rawFiles) {
    if (!name.startsWith(PACKAGE_PREFIX)) {
      return { files: new Map(), fatal: { code: "path", message: `路径必须位于 ${PACKAGE_PREFIX} 目录下: ${clip(name)}`, path: clip(name) } };
    }
    const stripped = name.slice(PACKAGE_PREFIX.length);
    const strippedError = checkPath(stripped);
    if (strippedError) return { files: new Map(), fatal: strippedError };
    if (normalized.has(stripped)) {
      return { files: new Map(), fatal: { code: "files", message: `路径重复: ${clip(stripped)}`, path: clip(stripped) } };
    }
    normalized.set(stripped, bytes);
  }
  return { files: normalized, fatal: null };
}

export function checkPath(name: string): ImportError | null {
  if (!name || name.length > PACKAGE_LIMITS.path) {
    return { code: "path", message: "路径长度必须在 1 到 128 之间", path: clip(name) };
  }
  if (name.includes("\0") || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    return { code: "path", message: "路径必须是相对路径，不能是绝对路径", path: clip(name) };
  }
  const parts = name.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    return { code: "path", message: "路径不能包含 .. 或空段", path: clip(name) };
  }
  return null;
}

function entryName(entry: yauzl.Entry): string | ImportError {
  const raw = entry.fileName as unknown;
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), "utf8");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { code: "path", message: "路径必须是 UTF-8" };
  }
}

function overRatio(uncompressed: number, compressed: number): boolean {
  if (compressed === 0) return uncompressed > 0;
  return uncompressed > compressed * PACKAGE_LIMITS.ratio;
}

function isSymlink(entry: yauzl.Entry): boolean {
  const mode = entry.externalFileAttributes >>> 16;
  return (mode & 0o170000) === 0o120000;
}

function clip(name: string): string {
  return name.length > PACKAGE_LIMITS.path ? name.slice(0, PACKAGE_LIMITS.path) : name;
}

function fatal(zip: yauzl.ZipFile, error: ImportError): ZipRead {
  zip.close();
  return { files: new Map(), fatal: error };
}

function openZip(buffer: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: false, decodeStrings: false }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error("zip"));
      else resolve(zip);
    });
  });
}

async function* iterate(zip: yauzl.ZipFile): AsyncGenerator<yauzl.Entry> {
  const pending: yauzl.Entry[] = [];
  let ended = false;
  let failed: Error | null = null;
  let wake: (() => void) | null = null;
  const poke = () => {
    wake?.();
    wake = null;
  };
  zip.on("entry", (entry: yauzl.Entry) => {
    pending.push(entry);
    poke();
  });
  zip.on("end", () => {
    ended = true;
    poke();
  });
  zip.on("error", (error: Error) => {
    failed = error;
    poke();
  });
  zip.readEntry();
  while (true) {
    if (failed) throw failed;
    const next = pending.shift();
    if (next) {
      yield next;
      if (!ended) zip.readEntry();
      continue;
    }
    if (ended) return;
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
  }
}

class LimitError extends Error {
  readonly limitCode: "compression_ratio" | "unzipped_limit";

  constructor(limitCode: "compression_ratio" | "unzipped_limit") {
    super(limitCode);
    this.name = "LimitError";
    this.limitCode = limitCode;
  }
}

function inflateLimited(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  const ratioCap = entry.compressedSize === 0
    ? entry.uncompressedSize
    : entry.compressedSize * PACKAGE_LIMITS.ratio;
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error("stream"));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const finish = (result: Buffer | LimitError | Error) => {
        if (settled) return;
        settled = true;
        if (Buffer.isBuffer(result)) resolve(result);
        else reject(result);
      };
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > PACKAGE_LIMITS.fileBytes || size > entry.uncompressedSize) {
          stream.destroy();
          finish(new LimitError("unzipped_limit"));
          return;
        }
        if (size > ratioCap) {
          stream.destroy();
          finish(new LimitError("compression_ratio"));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("end", () => finish(Buffer.concat(chunks)));
      stream.on("error", (streamError: Error) => {
        if ((streamError as { code?: string }).code === "ERR_STREAM_PREMATURE_CLOSE") return;
        finish(streamError);
      });
    });
  });
}
