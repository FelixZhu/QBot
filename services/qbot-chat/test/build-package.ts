import { jcsSha256, sha256Hex } from "../src/card-import/jcs.ts";
import { contentDigestInput, withoutManifestDigest } from "../src/card-import/validate.ts";
import { buildZip, type ZipEntryInput } from "./zip-writer.ts";

// Minimal valid PNG header + IHDR + IEND bytes.
export const SAMPLE_LIGHT_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
]);

export const SAMPLE_DARK_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
]);

export type BuildPackageOptions = {
  prefix?: string;
  botSlug?: string;
  cardKey?: string;
  contentVersion?: number;
  expectedPreviousVersion?: number | null;
  idempotencyKey?: string;
  sample?: boolean;
  title?: string;
  quote?: string;
  html?: string;
  css?: string;
  singleCover?: boolean;
  notBefore?: string;
  notAfter?: string;
  visibilityMode?: "manual" | "schedule";
  sourceUrl?: string;
  sourcePrivate?: boolean;
  ownerField?: string;
  extraManifestFields?: Record<string, unknown>;
  mutateManifest?: (manifest: Record<string, unknown>) => void;
  extraZipEntries?: ZipEntryInput[];
  recomputeDigests?: boolean;
};

export function buildCardPackageZip(options: BuildPackageOptions = {}): {
  zip: Buffer;
  manifest: Record<string, unknown>;
  contentDigest: string;
  manifestDigest: string;
  idempotencyKey: string;
} {
  const prefix = options.prefix ?? "card-package/";
  const quote = options.quote ?? "这是一条有锚点佐证的核心结论";
  const sourceUrl = options.sourceUrl ?? "https://example.invalid/source-1";
  const htmlText = options.html ?? `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="assets/page.css">
</head>
<body>
  <article>
    <p id="claim1">${quote}</p>
    <a href="${sourceUrl}">来源链接</a>
  </article>
</body>
</html>`;
  const cssText = options.css ?? "body { font-family: sans-serif; color: #111; }";

  const fileEntries: { path: string; role: "cover" | "page" | "asset"; contentType: string; bytes: Buffer }[] = options.singleCover
    ? [
      { path: "cover.png", role: "cover", contentType: "image/png", bytes: SAMPLE_LIGHT_PNG },
      { path: "work/index.html", role: "page", contentType: "text/html; charset=utf-8", bytes: Buffer.from(htmlText, "utf8") },
      { path: "work/assets/page.css", role: "asset", contentType: "text/css; charset=utf-8", bytes: Buffer.from(cssText, "utf8") },
    ]
    : [
      { path: "cover-light.png", role: "cover", contentType: "image/png", bytes: SAMPLE_LIGHT_PNG },
      { path: "cover-dark.png", role: "cover", contentType: "image/png", bytes: SAMPLE_DARK_PNG },
      { path: "work/index.html", role: "page", contentType: "text/html; charset=utf-8", bytes: Buffer.from(htmlText, "utf8") },
      { path: "work/assets/page.css", role: "asset", contentType: "text/css; charset=utf-8", bytes: Buffer.from(cssText, "utf8") },
    ];

  const now = Date.now();
  const notBefore = options.notBefore ?? new Date(now - 60_000).toISOString();
  const notAfter = options.notAfter ?? new Date(now + 24 * 60 * 60_000).toISOString();
  const idempotencyKey = options.idempotencyKey ?? "idem-key-card-package-v1";
  const cardKey = options.cardKey ?? "daily-brief";
  const contentVersion = options.contentVersion ?? 1;
  const expectedPreviousVersion = options.expectedPreviousVersion === undefined
    ? (contentVersion === 1 ? null : contentVersion - 1)
    : options.expectedPreviousVersion;

  const manifest: Record<string, unknown> = {
    protocol: "qbot.card-package",
    protocolMajor: 1,
    protocolMinor: 0,
    packageId: `pkg-${cardKey}-v${contentVersion}`,
    sample: options.sample ?? false,
    manifestDigest: { alg: "sha256-jcs", value: "0".repeat(64) },
    contentDigest: { alg: "sha256-jcs", value: "0".repeat(64) },
    botRef: { slug: options.botSlug ?? "qbot" },
    cardKey,
    contentVersion,
    expectedPreviousVersion,
    idempotencyKey,
    authoringClaim: "bot",
    createdAt: new Date(now).toISOString(),
    timezone: "Asia/Shanghai",
    card: {
      title: options.title ?? "测试卡片标题",
      authoredAt: new Date(now - 30_000).toISOString(),
    },
    sources: [
      {
        id: "src-1",
        url: sourceUrl,
        retrievedAt: new Date(now - 120_000).toISOString(),
        freshUntil: new Date(now + 3600_000).toISOString(),
        private: options.sourcePrivate ?? false,
      },
    ],
    claims: [
      {
        id: "claim-1",
        text: quote,
        sourceIds: ["src-1"],
        bodyAnchor: {
          path: "work/index.html",
          elementId: "claim1",
          fragment: "#claim1",
          quote,
        },
      },
    ],
    referenceCanvas: {
      width: 390,
      height: 844,
      insetTop: 44,
      insetBottom: 34,
    },
    contentSafe: {
      top: 98,
      right: 20,
      bottom: 148,
      left: 20,
    },
    visibility: {
      mode: options.visibilityMode ?? "manual",
      notBefore,
      notAfter,
    },
    notification: {
      mode: "none",
      dedupeKey: `${cardKey}-v${contentVersion}`,
      cooldownMinutes: 360,
      quietHours: { start: "22:00", end: "08:00" },
    },
    files: fileEntries.map((file) => ({
      path: file.path,
      role: file.role,
      sha256: sha256Hex(file.bytes),
      bytes: file.bytes.length,
      contentType: file.contentType,
    })),
    ...(options.ownerField !== undefined ? { owner: options.ownerField } : {}),
    ...(options.extraManifestFields ?? {}),
  };

  if (options.recomputeDigests !== false) {
    const contentDigest = jcsSha256(contentDigestInput(manifest));
    manifest.contentDigest = { alg: "sha256-jcs", value: contentDigest };
    const manifestDigest = jcsSha256(withoutManifestDigest(manifest));
    manifest.manifestDigest = { alg: "sha256-jcs", value: manifestDigest };
  }

  if (options.mutateManifest) {
    options.mutateManifest(manifest);
  }

  const contentDigest = ((manifest.contentDigest as { value?: string })?.value) ?? "";
  const manifestDigest = ((manifest.manifestDigest as { value?: string })?.value) ?? "";

  const entries: ZipEntryInput[] = [
    { name: `${prefix}manifest.json`, data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
    ...fileEntries.map((file) => ({ name: `${prefix}${file.path}`, data: file.bytes })),
    ...(options.extraZipEntries ?? []),
  ];

  return {
    zip: buildZip(entries),
    manifest,
    contentDigest,
    manifestDigest,
    idempotencyKey,
  };
}
