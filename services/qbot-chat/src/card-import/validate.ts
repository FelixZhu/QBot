import { PACKAGE_LIMITS, PNG_MAGIC } from "./limits.ts";
import { jcsSha256, sha256Hex } from "./jcs.ts";
import { loadImportValidator, schemaErrors } from "./schema.ts";
import { readPackageZip } from "./zip.ts";
import { collapseWhitespace, inspectHtml } from "./html.ts";
import type { DryRunResponse, ImportError, OwnerCatalog } from "./types.ts";
import { emptyDryRun } from "./types.ts";

const SLUG = /^[a-z0-9-]{1,40}$/;
const CONTENT_TYPES: Record<string, readonly string[]> = {
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".webp": ["image/webp"],
  ".gif": ["image/gif"],
  ".svg": ["image/svg+xml"],
  ".css": ["text/css", "text/css; charset=utf-8"],
  ".html": ["text/html", "text/html; charset=utf-8"],
  ".woff2": ["font/woff2"],
  ".json": ["application/json"],
};

export type DryRunInput = {
  body: Buffer;
  idempotencyKey: string | undefined;
  ownerId: string;
  catalog: OwnerCatalog;
};

/**
 * Check one card package. Reads the catalog only. Does not write, fetch, or publish.
 */
export async function dryRunPackage(input: DryRunInput): Promise<DryRunResponse> {
  const unzipped = await readPackageZip(input.body);
  if (unzipped.fatal) return emptyDryRun([unzipped.fatal]);

  const blobs = new Map(unzipped.files);
  const manifestBytes = blobs.get("manifest.json");
  blobs.delete("manifest.json");
  if (!manifestBytes) return emptyDryRun([{ code: "manifest", message: "ZIP 里没有 manifest.json" }]);
  if (blobs.size > PACKAGE_LIMITS.fileCount) {
    return emptyDryRun([{ code: "file_count", message: "文件超过 32 个" }]);
  }

  let manifest: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return emptyDryRun([{ code: "manifest", message: "manifest.json 必须是 JSON 对象" }]);
    }
    manifest = parsed as Record<string, unknown>;
  } catch {
    return emptyDryRun([{ code: "manifest", message: "manifest.json 不是 UTF-8 JSON" }]);
  }

  const response = emptyDryRun([]);
  fillIdentity(response, manifest);
  const errors: ImportError[] = [];

  const validate = loadImportValidator();
  validate(manifest);
  errors.push(...schemaErrors(validate.errors));

  const contentInput = contentDigestInput(manifest);
  if (contentInput) {
    try {
      const contentDigest = jcsSha256(contentInput);
      const manifestDigest = jcsSha256(withoutManifestDigest(manifest));
      response.contentDigest = contentDigest;
      response.manifestDigest = manifestDigest;
      const claimedContent = digestField(manifest.contentDigest);
      const claimedManifest = digestField(manifest.manifestDigest);
      if (claimedContent && claimedContent !== contentDigest) {
        errors.push({ code: "digest", message: "contentDigest 与服务端重算的不一致", path: "/contentDigest" });
      }
      if (claimedManifest && claimedManifest !== manifestDigest) {
        errors.push({ code: "digest", message: "manifestDigest 与服务端重算的不一致", path: "/manifestDigest" });
      }
    } catch {
      errors.push({ code: "digest", message: "摘要无法按 RFC 8785 计算", path: "/manifestDigest" });
    }
  }

  errors.push(...checkFiles(manifest, blobs));
  errors.push(...checkCanvas(manifest));
  const sourceIds = new Set<string>();
  const sourceUrls = new Set<string>();
  errors.push(...checkSources(manifest, sourceIds, sourceUrls));

  const page = blobs.get("work/index.html");
  let htmlIds = new Map<string, { hidden: boolean; text: string }[]>();
  if (page) {
    let html = "";
    try {
      html = new TextDecoder("utf-8", { fatal: true }).decode(page);
    } catch {
      errors.push({ code: "html", message: "work/index.html 不是 UTF-8", path: "work/index.html" });
    }
    if (html) {
      const report = inspectHtml(html, sourceUrls);
      errors.push(...report.errors);
      htmlIds = report.ids;
    }
  }
  errors.push(...checkClaims(manifest, sourceIds, htmlIds));
  errors.push(...checkIdempotency(manifest, input.idempotencyKey));

  const slug = readSlug(manifest);
  if (slug && SLUG.test(slug)) {
    const allowed = await input.catalog.botAllowed(input.ownerId, slug);
    if (!allowed) {
      errors.push({ code: "bot_ref", message: "botRef.slug 不是这个 owner 可用的 Bot", path: "/botRef/slug" });
    }
  }
  response.versionCheck = "unavailable";

  response.errors = dedupe(errors).slice(0, 40);
  response.state = response.errors.length === 0 ? "validated" : "rejected";
  response.commitAllowed = false;
  response.publishAllowed = false;
  return response;
}

function fillIdentity(response: DryRunResponse, manifest: Record<string, unknown>): void {
  const botRef = manifest.botRef;
  if (botRef && typeof botRef === "object" && !Array.isArray(botRef) && typeof (botRef as { slug?: unknown }).slug === "string") {
    response.botSlug = (botRef as { slug: string }).slug;
  }
  if (typeof manifest.cardKey === "string") response.cardKey = manifest.cardKey;
  if (Number.isInteger(manifest.contentVersion)) response.contentVersion = manifest.contentVersion as number;
  if (manifest.expectedPreviousVersion === null || Number.isInteger(manifest.expectedPreviousVersion)) {
    response.expectedPreviousVersion = manifest.expectedPreviousVersion as number | null;
  }
  if (typeof manifest.sample === "boolean") response.sample = manifest.sample;
}

function checkIdempotency(manifest: Record<string, unknown>, header: string | undefined): ImportError[] {
  if (typeof manifest.idempotencyKey !== "string") {
    return header ? [] : [{ code: "idempotency", message: "需要 Idempotency-Key 头，并且等于 manifest 的 idempotencyKey" }];
  }
  if (!header) {
    return [{ code: "idempotency", message: "需要 Idempotency-Key 头，并且等于 manifest 的 idempotencyKey", path: "/idempotencyKey" }];
  }
  if (header !== manifest.idempotencyKey) {
    return [{ code: "idempotency", message: "Idempotency-Key 与 manifest.idempotencyKey 不一致", path: "/idempotencyKey" }];
  }
  return [];
}

function checkFiles(manifest: Record<string, unknown>, blobs: Map<string, Buffer>): ImportError[] {
  const errors: ImportError[] = [];
  if (!Array.isArray(manifest.files)) return errors;
  const listed = new Map<string, Record<string, unknown>>();
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const file = entry as Record<string, unknown>;
    if (typeof file.path !== "string") continue;
    if (listed.has(file.path)) {
      errors.push({ code: "files", message: `files 里路径重复: ${file.path}`, path: "/files" });
    }
    listed.set(file.path, file);
  }
  const zipPaths = new Set(blobs.keys());
  const filePaths = new Set(listed.keys());
  for (const path of filePaths) {
    if (!zipPaths.has(path)) errors.push({ code: "files", message: `files 列出了 ZIP 里没有的 ${path}`, path });
  }
  for (const path of zipPaths) {
    if (!filePaths.has(path)) errors.push({ code: "files", message: `ZIP 里的 ${path} 没有出现在 files`, path });
  }
  const coverNames = [...zipPaths].filter(isCoverName);
  const pair = coverNames.includes("cover-light.png") && coverNames.includes("cover-dark.png") && !coverNames.includes("cover.png");
  const single = coverNames.length === 1 && coverNames[0] === "cover.png";
  if (!pair && !single) {
    errors.push({ code: "cover", message: "封面必须是 cover-light.png 与 cover-dark.png 一对，或只有 cover.png", path: "/files" });
  }
  if (!zipPaths.has("work/index.html")) {
    errors.push({ code: "files", message: "缺少 work/index.html", path: "work/index.html" });
  }
  for (const [path, file] of listed) {
    const bytes = blobs.get(path);
    const role = expectedRole(path);
    if (!role) {
      errors.push({ code: "files", message: `路径不在封面、work/index.html 或 work/assets/ 里: ${path}`, path });
      continue;
    }
    if (file.role !== role) {
      errors.push({ code: "files", message: `${path} 的 role 必须是 ${role}`, path });
    }
    if (bytes) {
      if (sha256Hex(bytes) !== file.sha256 || bytes.length !== file.bytes) {
        errors.push({ code: "files", message: `hash 或 bytes 与文件不符: ${path}`, path });
      }
      if (role === "cover" && !bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
        errors.push({ code: "cover", message: `封面不是 PNG: ${path}`, path });
      }
    }
    if (typeof file.contentType !== "string" || !contentTypeMatches(path, file.contentType)) {
      errors.push({ code: "files", message: `contentType 与文件不符: ${path}`, path });
    }
  }
  return errors;
}

function checkCanvas(manifest: Record<string, unknown>): ImportError[] {
  const canvas = asRecord(manifest.referenceCanvas);
  const safe = asRecord(manifest.contentSafe);
  if (!canvas || !safe) return [];
  const width = finite(canvas.width);
  const height = finite(canvas.height);
  const insetTop = finite(canvas.insetTop);
  const insetBottom = finite(canvas.insetBottom);
  const top = finite(safe.top);
  const right = finite(safe.right);
  const bottom = finite(safe.bottom);
  const left = finite(safe.left);
  if (width === null || height === null || insetTop === null || insetBottom === null || top === null || right === null || bottom === null || left === null) {
    return [];
  }
  if (left + right >= width || top + bottom >= height) {
    return [{ code: "content_safe", message: "contentSafe 没有落在参考画布内", path: "/contentSafe" }];
  }
  if (top < insetTop || bottom < insetBottom) {
    return [{ code: "content_safe", message: "contentSafe 落在参考画布的叠层里", path: "/contentSafe" }];
  }
  return [];
}

function checkSources(manifest: Record<string, unknown>, ids: Set<string>, urls: Set<string>): ImportError[] {
  const errors: ImportError[] = [];
  if (!Array.isArray(manifest.sources)) return errors;
  for (const entry of manifest.sources) {
    const source = asRecord(entry);
    if (!source || typeof source.url !== "string") continue;
    if (typeof source.id === "string") ids.add(source.id);
    if (!isHttps(source.url)) {
      errors.push({ code: "source", message: "来源 url 必须是 https，导入不会去抓取它", path: "/sources" });
    } else {
      urls.add(source.url.trim());
    }
  }
  return errors;
}

function checkClaims(
  manifest: Record<string, unknown>,
  sourceIds: Set<string>,
  ids: Map<string, { hidden: boolean; text: string }[]>,
): ImportError[] {
  const errors: ImportError[] = [];
  if (!Array.isArray(manifest.claims)) return errors;
  for (const entry of manifest.claims) {
    const claim = asRecord(entry);
    const anchor = claim ? asRecord(claim.bodyAnchor) : null;
    if (!claim || !anchor) continue;
    const id = typeof claim.id === "string" ? claim.id : "claim";
    if (typeof anchor.fragment === "string" && typeof anchor.elementId === "string" && anchor.fragment !== `#${anchor.elementId}`) {
      errors.push({ code: "anchor", message: `${id}: fragment 必须是 # 加上 elementId`, path: "/claims" });
    }
    if (typeof claim.text === "string" && typeof anchor.quote === "string" && claim.text !== anchor.quote) {
      errors.push({ code: "anchor", message: `${id}: text 必须与 quote 相同`, path: "/claims" });
    }
    if (Array.isArray(claim.sourceIds) && claim.sourceIds.some((sourceId) => typeof sourceId !== "string" || !sourceIds.has(sourceId))) {
      errors.push({ code: "anchor", message: `${id}: sourceIds 里有 sources 中不存在的 id`, path: "/claims" });
    }
    if (typeof anchor.elementId !== "string" || typeof anchor.quote !== "string") continue;
    const hits = ids.get(anchor.elementId) ?? [];
    if (hits.length !== 1) {
      errors.push({ code: "anchor", message: `${id}: id=${anchor.elementId} 必须恰好有一个，实际 ${hits.length}`, path: "/claims" });
      continue;
    }
    const hit = hits[0];
    if (!hit) continue;
    if (hit.hidden) {
      errors.push({ code: "anchor", message: `${id}: 锚点必须在 body 里，且不能在 script、style 或 template 里`, path: "/claims" });
      continue;
    }
    if (!collapseWhitespace(hit.text).includes(collapseWhitespace(anchor.quote))) {
      errors.push({ code: "anchor", message: `${id}: quote 不是该元素文本里连续的一段`, path: "/claims" });
    }
  }
  return errors;
}

function contentDigestInput(manifest: Record<string, unknown>): unknown | null {
  const card = asRecord(manifest.card);
  if (!card || typeof card.title !== "string") return null;
  if (!Array.isArray(manifest.claims) || !Array.isArray(manifest.files) || !Array.isArray(manifest.sources)) return null;
  if (!asRecord(manifest.contentSafe) || !asRecord(manifest.referenceCanvas)) return null;
  try {
    return {
      title: card.title,
      claims: manifest.claims.map((entry) => {
        const claim = asRecord(entry);
        if (!claim) throw new Error("claim");
        return {
          id: claim.id,
          text: claim.text,
          sourceIds: claim.sourceIds,
          bodyAnchor: claim.bodyAnchor,
        };
      }),
      files: manifest.files.map((entry) => {
        const file = asRecord(entry);
        if (!file) throw new Error("file");
        return {
          path: file.path,
          role: file.role,
          sha256: file.sha256,
          bytes: file.bytes,
          contentType: file.contentType,
        };
      }),
      contentSafe: manifest.contentSafe,
      referenceCanvas: manifest.referenceCanvas,
      sources: manifest.sources.map((entry) => {
        const source = asRecord(entry);
        if (!source) throw new Error("source");
        return { id: source.id, url: source.url };
      }),
    };
  } catch {
    return null;
  }
}

function withoutManifestDigest(manifest: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...manifest };
  delete copy.manifestDigest;
  return copy;
}

function digestField(value: unknown): string | null {
  const record = asRecord(value);
  if (!record || record.alg !== "sha256-jcs" || typeof record.value !== "string") return null;
  if (!/^[0-9a-f]{64}$/.test(record.value)) return null;
  return record.value;
}

function readSlug(manifest: Record<string, unknown>): string | null {
  const botRef = asRecord(manifest.botRef);
  return botRef && typeof botRef.slug === "string" ? botRef.slug : null;
}

function isCoverName(path: string): boolean {
  return path === "cover.png" || path === "cover-light.png" || path === "cover-dark.png";
}

function expectedRole(path: string): "cover" | "page" | "asset" | null {
  if (isCoverName(path)) return "cover";
  if (path === "work/index.html") return "page";
  if (path.startsWith("work/assets/") && path.length > "work/assets/".length) return "asset";
  return null;
}

function contentTypeMatches(path: string, contentType: string): boolean {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  const allowed = CONTENT_TYPES[extension];
  if (allowed) return allowed.includes(contentType);
  return /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+(?:;\s*charset=utf-8)?$/.test(contentType);
}

function isHttps(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function dedupe(errors: ImportError[]): ImportError[] {
  const seen = new Set<string>();
  const out: ImportError[] = [];
  for (const error of errors) {
    const key = `${error.code}\0${error.path ?? ""}\0${error.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(error);
  }
  return out;
}
