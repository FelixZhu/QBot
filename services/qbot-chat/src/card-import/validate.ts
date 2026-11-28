import { bundlePath, contentTypeFor } from "../feed/paths.ts";
import { collapseWhitespace, inspectCss, inspectHtml, inspectSvg } from "./html.ts";
import { jcsSha256, sha256Hex } from "./jcs.ts";
import { PACKAGE_LIMITS, PNG_MAGIC } from "./limits.ts";
import { validateManifestSchema } from "./schema.ts";
import type { ImportError, PackageIdentity, ValidatedPackage, ValidatedPackageFile } from "./types.ts";
import { readPackageZip } from "./zip.ts";

const SLUG = /^[a-z0-9-]{1,40}$/;

const ALLOWED_ASSET_CONTENT_TYPES: Record<string, readonly string[]> = {
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".webp": ["image/webp"],
  ".gif": ["image/gif"],
  ".svg": ["image/svg+xml"],
  ".css": ["text/css", "text/css; charset=utf-8"],
  ".woff2": ["font/woff2"],
  ".json": ["application/json"],
};

const PAGE_CONTENT_TYPES = new Set(["text/html", "text/html; charset=utf-8"]);
const COVER_CONTENT_TYPES = new Set(["image/png"]);

export type ValidationResult =
  | { ok: true; pkg: ValidatedPackage }
  | { ok: false; identity: PackageIdentity; errors: ImportError[] };

export type ValidateCardPackageInput = {
  zipBytes: Buffer;
  idempotencyKey: string;
  ownerId: string;
  resolveBot: (ownerId: string, slug: string) => Promise<{ id: string } | null>;
};

export function emptyIdentity(): PackageIdentity {
  return {
    agentId: null,
    botSlug: null,
    cardKey: null,
    contentVersion: null,
    expectedPreviousVersion: null,
    manifestDigest: null,
    contentDigest: null,
    sample: null,
    authoringClaim: null,
    cardTitle: null,
    cardAuthoredAt: null,
    visibilityMode: null,
    visibleFrom: null,
    visibleUntil: null,
  };
}

/**
 * Full async validation of a card-package ZIP according to docs/CARD-PACKAGE.md v1.0.
 * Never fetches source URLs; never writes objects or database rows.
 */
export async function validateCardPackage(input: ValidateCardPackageInput): Promise<ValidationResult> {
  const identity = emptyIdentity();
  const unzipped = await readPackageZip(input.zipBytes);
  if (unzipped.fatal) {
    return { ok: false, identity, errors: [unzipped.fatal] };
  }

  const blobs = new Map(unzipped.files);
  const manifestBytes = blobs.get("manifest.json");
  blobs.delete("manifest.json");
  if (!manifestBytes) {
    return { ok: false, identity, errors: [{ code: "manifest", message: "ZIP 里没有 manifest.json" }] };
  }
  if (blobs.size > PACKAGE_LIMITS.fileCount) {
    return { ok: false, identity, errors: [{ code: "file_count", message: "文件超过 32 个" }] };
  }

  let manifest: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, identity, errors: [{ code: "manifest", message: "manifest.json 必须是 JSON 对象" }] };
    }
    manifest = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, identity, errors: [{ code: "manifest", message: "manifest.json 不是 UTF-8 JSON" }] };
  }

  fillIdentity(identity, manifest);
  const errors: ImportError[] = [];

  // Schema validation (root `owner` is ignored per spec; auth determines owner).
  errors.push(...validateManifestSchema(manifest));

  // Recompute RFC 8785 JCS SHA-256 digests and verify against claimed digests.
  const contentInput = contentDigestInput(manifest);
  if (contentInput) {
    try {
      const contentDigest = jcsSha256(contentInput);
      const manifestDigest = jcsSha256(withoutManifestDigest(manifest));
      identity.contentDigest = contentDigest;
      identity.manifestDigest = manifestDigest;
      const claimedContent = digestField(manifest.contentDigest);
      const claimedManifest = digestField(manifest.manifestDigest);
      if (!claimedContent || claimedContent !== contentDigest) {
        errors.push({ code: "digest", message: "contentDigest 与服务端重算的不一致", path: "/contentDigest" });
      }
      if (!claimedManifest || claimedManifest !== manifestDigest) {
        errors.push({ code: "digest", message: "manifestDigest 与服务端重算的不一致", path: "/manifestDigest" });
      }
    } catch {
      errors.push({ code: "digest", message: "摘要无法按 RFC 8785 计算", path: "/manifestDigest" });
    }
  }

  // Verify manifest.files <-> ZIP contents, roles, hashes, sizes, PNG magic, and asset safety.
  const fileCheck = checkFiles(manifest, blobs);
  errors.push(...fileCheck.errors);

  // Verify safe-area geometry.
  errors.push(...checkCanvas(manifest));

  // Verify visibility window ordering.
  errors.push(...checkVisibility(manifest));

  // Verify sources (https only, no private sources for public OSS/Feed).
  const sourceIds = new Set<string>();
  const sourceUrls = new Set<string>();
  errors.push(...checkSources(manifest, sourceIds, sourceUrls));

  // Parse work/index.html for forbidden tags/attrs/CSP/links and anchor IDs.
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

  // Verify claim anchors and source references.
  errors.push(...checkClaims(manifest, sourceIds, htmlIds));

  // Verify Idempotency-Key header matches manifest.idempotencyKey.
  if (typeof manifest.idempotencyKey === "string" && manifest.idempotencyKey !== input.idempotencyKey) {
    errors.push({ code: "idempotency", message: "Idempotency-Key 与 manifest.idempotencyKey 不一致", path: "/idempotencyKey" });
  }

  // Resolve target bot from owner's allowed bots (ignoring manifest.owner).
  const slug = readSlug(manifest);
  let resolvedAgentId: string | null = null;
  if (slug && SLUG.test(slug)) {
    const bot = await input.resolveBot(input.ownerId, slug);
    if (!bot) {
      errors.push({ code: "bot_ref", message: "botRef.slug 不是这个 owner 已允许的 Bot", path: "/botRef/slug" });
    } else {
      resolvedAgentId = bot.id;
      identity.agentId = bot.id;
    }
  }

  const deduped = dedupe(errors).slice(0, 40);
  if (deduped.length > 0) {
    return { ok: false, identity, errors: deduped };
  }

  if (
    !resolvedAgentId
    || !identity.botSlug
    || !identity.cardKey
    || identity.contentVersion === null
    || !identity.manifestDigest
    || !identity.contentDigest
    || identity.sample === null
    || !identity.authoringClaim
    || !identity.cardTitle
    || !identity.cardAuthoredAt
    || !identity.visibilityMode
    || !identity.visibleFrom
    || !identity.visibleUntil
  ) {
    return {
      ok: false,
      identity,
      errors: [{ code: "manifest", message: "manifest 缺少必填字段" }],
    };
  }

  return {
    ok: true,
    pkg: {
      agentId: resolvedAgentId,
      botSlug: identity.botSlug,
      cardKey: identity.cardKey,
      contentVersion: identity.contentVersion,
      expectedPreviousVersion: identity.expectedPreviousVersion,
      manifestDigest: identity.manifestDigest,
      contentDigest: identity.contentDigest,
      sample: identity.sample,
      authoringClaim: identity.authoringClaim,
      cardTitle: identity.cardTitle,
      cardAuthoredAt: identity.cardAuthoredAt,
      visibilityMode: identity.visibilityMode,
      visibleFrom: identity.visibleFrom,
      visibleUntil: identity.visibleUntil,
      files: fileCheck.files,
    },
  };
}

function fillIdentity(identity: PackageIdentity, manifest: Record<string, unknown>): void {
  const botRef = asRecord(manifest.botRef);
  if (botRef && typeof botRef.slug === "string") identity.botSlug = botRef.slug;
  if (typeof manifest.cardKey === "string") identity.cardKey = manifest.cardKey;
  if (Number.isInteger(manifest.contentVersion) && (manifest.contentVersion as number) >= 1) {
    identity.contentVersion = manifest.contentVersion as number;
  }
  if (manifest.expectedPreviousVersion === null) {
    identity.expectedPreviousVersion = null;
  } else if (Number.isInteger(manifest.expectedPreviousVersion) && (manifest.expectedPreviousVersion as number) >= 1) {
    identity.expectedPreviousVersion = manifest.expectedPreviousVersion as number;
  }
  if (typeof manifest.sample === "boolean") identity.sample = manifest.sample;
  if (manifest.authoringClaim === "human" || manifest.authoringClaim === "bot") {
    identity.authoringClaim = manifest.authoringClaim;
  }
  const card = asRecord(manifest.card);
  if (card) {
    if (typeof card.title === "string") identity.cardTitle = card.title;
    if (typeof card.authoredAt === "string" && Number.isFinite(Date.parse(card.authoredAt))) {
      identity.cardAuthoredAt = new Date(Date.parse(card.authoredAt)).toISOString();
    }
  }
  const vis = asRecord(manifest.visibility);
  if (vis) {
    if (vis.mode === "manual" || vis.mode === "schedule") identity.visibilityMode = vis.mode;
    if (typeof vis.notBefore === "string" && Number.isFinite(Date.parse(vis.notBefore))) {
      identity.visibleFrom = new Date(Date.parse(vis.notBefore)).toISOString();
    }
    if (typeof vis.notAfter === "string" && Number.isFinite(Date.parse(vis.notAfter))) {
      identity.visibleUntil = new Date(Date.parse(vis.notAfter)).toISOString();
    }
  }
}

function checkVisibility(manifest: Record<string, unknown>): ImportError[] {
  const vis = asRecord(manifest.visibility);
  if (!vis) return [];
  const notBefore = typeof vis.notBefore === "string" ? Date.parse(vis.notBefore) : Number.NaN;
  const notAfter = typeof vis.notAfter === "string" ? Date.parse(vis.notAfter) : Number.NaN;
  if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter)) return [];
  if (notBefore >= notAfter) {
    return [{ code: "visibility", message: "visibility.notBefore 必须早于 visibility.notAfter", path: "/visibility" }];
  }
  return [];
}

function checkFiles(
  manifest: Record<string, unknown>,
  blobs: Map<string, Buffer>,
): { files: ValidatedPackageFile[]; errors: ImportError[] } {
  const errors: ImportError[] = [];
  const files: ValidatedPackageFile[] = [];
  if (!Array.isArray(manifest.files)) return { files, errors };

  const listed = new Map<string, Record<string, unknown>>();
  for (const entry of manifest.files) {
    const file = asRecord(entry);
    if (!file || typeof file.path !== "string") continue;
    if (listed.has(file.path)) {
      errors.push({ code: "files", message: `files 里路径重复: ${file.path}`, path: "/files" });
    }
    listed.set(file.path, file);
  }

  const zipPaths = new Set(blobs.keys());
  const filePaths = new Set(listed.keys());
  for (const filePath of filePaths) {
    if (!zipPaths.has(filePath)) {
      errors.push({ code: "files", message: `files 列出了 ZIP 里没有的 ${filePath}`, path: filePath });
    }
  }
  for (const filePath of zipPaths) {
    if (!filePaths.has(filePath)) {
      errors.push({ code: "files", message: `ZIP 里的 ${filePath} 没有出现在 files`, path: filePath });
    }
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

  for (const [filePath, file] of listed) {
    const bytes = blobs.get(filePath);
    const role = expectedRole(filePath);
    if (!role) {
      errors.push({ code: "files", message: `路径不在封面、work/index.html 或 work/assets/ 里: ${filePath}`, path: filePath });
      continue;
    }
    if (file.role !== role) {
      errors.push({ code: "files", message: `${filePath} 的 role 必须是 ${role}`, path: filePath });
    }
    if (!bundlePath(filePath)) {
      errors.push({ code: "files", message: `路径字符或后缀不被允许: ${filePath}`, path: filePath });
      continue;
    }
    const rawContentType = typeof file.contentType === "string" ? file.contentType.trim() : "";
    if (!contentTypeMatches(filePath, role, rawContentType)) {
      errors.push({ code: "files", message: `contentType 与文件不符或不允许: ${filePath}`, path: filePath });
    }
    if (bytes) {
      const actualSha = sha256Hex(bytes);
      if (actualSha !== file.sha256 || bytes.length !== file.bytes) {
        errors.push({ code: "files", message: `hash 或 bytes 与文件不符: ${filePath}`, path: filePath });
      }
      if (role === "cover" && !bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
        errors.push({ code: "cover", message: `封面不是 PNG: ${filePath}`, path: filePath });
      }
      if (role === "asset") {
        const lower = filePath.toLowerCase();
        if (lower.endsWith(".css")) {
          try {
            const cssText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
            errors.push(...inspectCss(cssText, filePath));
          } catch {
            errors.push({ code: "asset", message: `CSS 文件不是 UTF-8: ${filePath}`, path: filePath });
          }
        } else if (lower.endsWith(".svg")) {
          try {
            const svgText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
            errors.push(...inspectSvg(svgText, filePath));
          } catch {
            errors.push({ code: "asset", message: `SVG 文件不是 UTF-8: ${filePath}`, path: filePath });
          }
        }
      }
      const canonicalContentType = contentTypeFor(filePath) ?? rawContentType;
      files.push({
        path: filePath,
        role,
        sha256: actualSha,
        byteLength: bytes.length,
        contentType: canonicalContentType,
        bytes,
      });
    }
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, errors };
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
  if (
    width === null || height === null || insetTop === null || insetBottom === null
    || top === null || right === null || bottom === null || left === null
  ) {
    return [];
  }
  if (insetTop + insetBottom >= height) {
    return [{ code: "content_safe", message: "referenceCanvas 叠层超过画布高度", path: "/referenceCanvas" }];
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
    if (source.private === true) {
      errors.push({ code: "private_source", message: "来源标记为 private 时不能整包公开到 OSS 或 Feed", path: "/sources" });
    }
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

export function contentDigestInput(manifest: Record<string, unknown>): unknown | null {
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

export function withoutManifestDigest(manifest: Record<string, unknown>): Record<string, unknown> {
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

function isCoverName(filePath: string): boolean {
  return filePath === "cover.png" || filePath === "cover-light.png" || filePath === "cover-dark.png";
}

function expectedRole(filePath: string): "cover" | "page" | "asset" | null {
  if (isCoverName(filePath)) return "cover";
  if (filePath === "work/index.html") return "page";
  if (filePath.startsWith("work/assets/") && filePath.length > "work/assets/".length) return "asset";
  return null;
}

function contentTypeMatches(filePath: string, role: "cover" | "page" | "asset", contentType: string): boolean {
  if (role === "cover") return COVER_CONTENT_TYPES.has(contentType);
  if (role === "page") return PAGE_CONTENT_TYPES.has(contentType);
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return false;
  const extension = filePath.slice(dot).toLowerCase();
  const allowed = ALLOWED_ASSET_CONTENT_TYPES[extension];
  return Boolean(allowed && allowed.includes(contentType));
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
