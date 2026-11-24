import assert from "node:assert/strict";
import { test } from "node:test";
import { createArtifactCache, createRateLimiter, etagMatches } from "../src/http-utils.ts";

test("rate limiter enforces limits, expires old windows, and bounds key count", () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 1_000, maxKeys: 3 });
  assert.equal(limiter.allow("token-a", 1_000), true);
  assert.equal(limiter.allow("token-a", 1_100), true);
  assert.equal(limiter.allow("token-a", 1_200), false);
  assert.equal(limiter.allow("token-a", 2_050), true);

  assert.equal(limiter.allow("token-b", 2_100), true);
  assert.equal(limiter.allow("token-c", 2_200), true);
  assert.equal(limiter.size(), 3);
  assert.equal(limiter.allow("token-d", 2_300), true);
  assert.equal(limiter.size(), 3);

  // After the window elapses, stale keys are swept on the next request.
  assert.equal(limiter.allow("token-e", 5_000), true);
  assert.equal(limiter.size(), 1);
});

test("artifact cache enforces LRU eviction and max byte budget", () => {
  const cache = createArtifactCache(10);
  const a = Buffer.from("aaaa"); // 4
  const b = Buffer.from("bbbb"); // 4
  const c = Buffer.from("cccc"); // 4
  cache.set("a", a);
  cache.set("b", b);
  assert.equal(cache.sizeBytes(), 8);
  assert.equal(cache.count(), 2);

  // Touch "a" so "b" becomes least recently used.
  assert.deepEqual(cache.get("a"), a);
  cache.set("c", c);
  assert.equal(cache.get("b"), null);
  assert.deepEqual(cache.get("a"), a);
  assert.deepEqual(cache.get("c"), c);
  assert.equal(cache.sizeBytes(), 8);

  // Oversize entry is ignored without evicting existing entries.
  cache.set("huge", Buffer.alloc(11));
  assert.equal(cache.get("huge"), null);
  assert.equal(cache.count(), 2);
});

test("etagMatches handles strong, weak, multi-value, and wildcard If-None-Match headers", () => {
  const etag = '"abc123"';
  assert.equal(etagMatches(undefined, etag), false);
  assert.equal(etagMatches('"other"', etag), false);
  assert.equal(etagMatches('"abc123"', etag), true);
  assert.equal(etagMatches('W/"abc123"', etag), true);
  assert.equal(etagMatches('"x", W/"abc123", "y"', etag), true);
  assert.equal(etagMatches("*", etag), true);
});
