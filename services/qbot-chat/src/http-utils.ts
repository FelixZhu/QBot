import type { ServerResponse } from "node:http";
import { tokenDigest } from "./auth.ts";
import { LIMITS } from "./limits.ts";

export type RateLimiter = {
  allow(key: string, now?: number): boolean;
  size(): number;
};

/**
 * Bounded sliding-window rate limiter.
 * Keys are hashed with SHA-256 so raw bearer tokens are not retained in memory.
 */
export function createRateLimiter(options: {
  limit?: number;
  windowMs?: number;
  maxKeys?: number;
} = {}): RateLimiter {
  const limit = options.limit ?? LIMITS.ratePerMinute;
  const windowMs = options.windowMs ?? 60_000;
  const maxKeys = options.maxKeys ?? 1024;
  const hits = new Map<string, number[]>();
  let lastSweep = 0;

  const sweep = (now: number): void => {
    for (const [entryKey, stamps] of hits) {
      const fresh = stamps.filter((stamp) => now - stamp < windowMs);
      if (fresh.length === 0) hits.delete(entryKey);
      else hits.set(entryKey, fresh);
    }
    lastSweep = now;
  };

  return {
    allow(rawKey, now = Date.now()) {
      if (hits.size > 0 && (now - lastSweep >= windowMs || hits.size >= maxKeys)) {
        sweep(now);
      }
      const key = tokenDigest(rawKey).toString("hex");
      const stamps = (hits.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
      if (stamps.length >= limit) {
        hits.set(key, stamps);
        return false;
      }
      if (!hits.has(key) && hits.size >= maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest !== undefined) hits.delete(oldest);
      }
      stamps.push(now);
      hits.delete(key);
      hits.set(key, stamps);
      return true;
    },
    size() {
      return hits.size;
    },
  };
}

export type ArtifactCache = {
  get(key: string): Buffer | null;
  set(key: string, value: Buffer): void;
  sizeBytes(): number;
  count(): number;
};

/** Bounded in-memory LRU cache for immutable, SHA-256-verified artifact bytes. */
export function createArtifactCache(maxBytes = 16 * 1024 * 1024): ArtifactCache {
  const entries = new Map<string, Buffer>();
  let totalBytes = 0;

  return {
    get(key) {
      const found = entries.get(key);
      if (!found) return null;
      entries.delete(key);
      entries.set(key, found);
      return found;
    },
    set(key, value) {
      if (maxBytes <= 0 || value.length > maxBytes) return;
      const existing = entries.get(key);
      if (existing) {
        totalBytes -= existing.length;
        entries.delete(key);
      }
      while (totalBytes + value.length > maxBytes && entries.size > 0) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey === undefined) break;
        const oldestVal = entries.get(oldestKey);
        entries.delete(oldestKey);
        if (oldestVal) totalBytes -= oldestVal.length;
      }
      entries.set(key, value);
      totalBytes += value.length;
    },
    sizeBytes() {
      return totalBytes;
    },
    count() {
      return entries.size;
    },
  };
}

/** RFC 9110 weak comparison for If-None-Match against a strong quoted ETag. */
export function etagMatches(header: string | string[] | undefined, etag: string): boolean {
  if (!header) return false;
  const raw = Array.isArray(header) ? header.join(",") : header;
  for (const part of raw.split(",")) {
    const token = part.trim();
    if (!token) continue;
    if (token === "*") return true;
    const normalized = token.startsWith("W/") ? token.slice(2).trim() : token;
    if (normalized === etag) return true;
  }
  return false;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(payload);
}
