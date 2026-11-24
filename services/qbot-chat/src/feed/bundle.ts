import { createHash } from "node:crypto";
import { LIMITS } from "../limits.ts";
import { bundlePath, contentTypeFor } from "./paths.ts";

export type CardProvenance = "manual" | "agent" | "scheduled";
export type CardVisibility = "public" | "followers";
export type BundleFileRole = "cover" | "page" | "asset";

export type RawBundleFile = {
  path: string;
  bytes: Buffer;
  role?: BundleFileRole;
};

export type ValidatedBundleFile = {
  path: string;
  role: BundleFileRole;
  contentType: string;
  sha256: string;
  byteLength: number;
  bytes: Buffer;
};

export type ValidatedBundle = {
  files: ValidatedBundleFile[];
  manifestSha256: string;
};

const MAX_FILES = 20;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const COVER_NAME = /^cover(?:-(?:light|dark))?\.(png|webp|jpe?g|svg)$/i;
const FORBIDDEN_MARKUP = /<script|@font-face|url\(\s*['"]?https?:/i;

export function inferRole(relPath: string): BundleFileRole {
  if (relPath === "index.html") return "page";
  if (COVER_NAME.test(relPath)) return "cover";
  return "asset";
}

/**
 * Validate a card bundle before writing to storage or PostgreSQL.
 * Enforces safe relative paths, allowed MIME types, size bounds, at least one
 * cover + index.html, and rejects inline scripts, fonts, or remote CSS URLs.
 */
export function validateBundle(rawFiles: readonly RawBundleFile[]): ValidatedBundle {
  if (rawFiles.length === 0) throw new Error("卡片包没有文件");
  if (rawFiles.length > MAX_FILES) throw new Error(`卡片包最多包含 ${MAX_FILES} 个文件`);

  const seen = new Set<string>();
  const validated: ValidatedBundleFile[] = [];
  let totalBytes = 0;

  for (const entry of rawFiles) {
    const safePath = bundlePath(entry.path);
    if (!safePath) throw new Error(`文件路径不合法: ${entry.path}`);
    if (seen.has(safePath)) throw new Error(`存在重复文件: ${safePath}`);
    seen.add(safePath);

    const contentType = contentTypeFor(safePath);
    if (!contentType) throw new Error(`不支持的文件类型: ${safePath}`);
    if (entry.bytes.length === 0 || entry.bytes.length > LIMITS.artifactBytes) {
      throw new Error(`文件大小超限: ${safePath}`);
    }
    totalBytes += entry.bytes.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("卡片包总大小超过限制");

    if (contentType.startsWith("text/") || contentType === "image/svg+xml") {
      if (FORBIDDEN_MARKUP.test(entry.bytes.toString("utf8"))) {
        throw new Error(`文件包含禁止的脚本、字体或外链: ${safePath}`);
      }
    }

    const role = entry.role ?? inferRole(safePath);
    if (role !== "cover" && role !== "page" && role !== "asset") {
      throw new Error(`文件角色不合法: ${safePath}`);
    }
    if (role === "page" && safePath !== "index.html") {
      throw new Error("page 角色仅允许 index.html");
    }

    const sha256 = createHash("sha256").update(entry.bytes).digest("hex");
    validated.push({
      path: safePath,
      role,
      contentType,
      sha256,
      byteLength: entry.bytes.length,
      bytes: entry.bytes,
    });
  }

  validated.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const covers = validated.filter((file) => file.role === "cover");
  const pages = validated.filter((file) => file.role === "page" && file.path === "index.html");
  if (covers.length === 0) throw new Error("卡片包至少需要一张封面图（cover.png / cover-light.png / cover-dark.png）");
  if (pages.length !== 1) throw new Error("卡片包必须包含一个 index.html");

  const digestLines = validated.map((file) => `${file.path}\n${file.sha256}\n${file.byteLength}\n`).join("");
  const manifestSha256 = createHash("sha256").update(digestLines).digest("hex");
  return { files: validated, manifestSha256 };
}
