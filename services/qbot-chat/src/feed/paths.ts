const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  js: "text/javascript; charset=utf-8",
};

/** CSP for a card document. The page cannot call the app, the network, or a parent frame. */
export const ARTIFACT_CSP = [
  "default-src 'none'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'none'",
  "script-src 'self'",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** One decode of each path segment. Rejects traversal, empty segments, and odd suffixes. */
export function bundlePath(raw: string): string | null {
  if (!raw || raw.length > 180 || raw.includes("\\") || raw.includes("\0")) return null;
  const parts: string[] = [];
  for (const segment of raw.split("/")) {
    if (!segment || segment.includes("%")) {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        return null;
      }
      if (!decoded || decoded.includes("/") || decoded.includes("\\") || decoded.includes("%") || decoded.includes("\0")) return null;
      if (!/^[A-Za-z0-9._-]+$/.test(decoded)) return null;
      parts.push(decoded);
      continue;
    }
    if (!/^[A-Za-z0-9._-]+$/.test(segment)) return null;
    parts.push(segment);
  }
  if (parts.length === 0 || parts.length > 8) return null;
  if (parts.some((part) => part === "." || part === "..")) return null;
  const joined = parts.join("/");
  if (!contentTypeFor(joined)) return null;
  return joined;
}

export function contentTypeFor(relPath: string): string | null {
  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  return TYPES[ext] ?? null;
}

export function encodeCursor(publishedAt: string, id: string): string {
  return Buffer.from(`${publishedAt}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { publishedAt: string; id: string } | null {
  if (!/^[A-Za-z0-9_-]{16,220}$/.test(cursor)) return null;
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  const cut = text.lastIndexOf("|");
  if (cut <= 0) return null;
  const publishedAt = text.slice(0, cut);
  const id = text.slice(cut + 1);
  if (!isUuid(id)) return null;
  const time = Date.parse(publishedAt);
  if (!Number.isFinite(time)) return null;
  return { publishedAt: new Date(time).toISOString(), id };
}
