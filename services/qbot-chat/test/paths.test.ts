import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { authorizeOss, createLocalObjectStore } from "../src/feed/objects.ts";
import { bundlePath, contentTypeFor, decodeCursor, encodeCursor } from "../src/feed/paths.ts";

const base = {
  DATABASE_URL: "postgres://qbot:secret@127.0.0.1:5432/qbot",
  QBOT_OWNER_ID: "00000000-0000-4000-8000-000000000001",
  QBOT_ACCESS_TOKEN: "qbot-fixture-token-not-a-secret",
  OPENROUTER_API_KEY: "fixture-openrouter-key-not-a-secret",
};

test("bundle paths reject traversal and accept a relative file", () => {
  assert.equal(bundlePath("index.html"), "index.html");
  assert.equal(bundlePath("assets/mark.svg"), "assets/mark.svg");
  assert.equal(bundlePath("brief.css"), "brief.css");
  for (const bad of ["", "..", "../secret", "a/../../secret", "/etc/passwd", "\\secret", "..%2Fsecret", "%2e%2e", "a//b", "index.html%00.png", "note.txt"]) {
    assert.equal(bundlePath(bad), null, bad);
  }
  assert.equal(contentTypeFor("index.html"), "text/html; charset=utf-8");
  assert.equal(contentTypeFor("phrase.css"), "text/css; charset=utf-8");
  assert.equal(contentTypeFor("note.txt"), null);
});

test("a cursor round-trips and the OSS signature leaves the secret out of the URL", () => {
  const cursor = encodeCursor("2026-11-21T08:48:00.000Z", "00000000-0000-4000-8000-0000000000c2");
  assert.deepEqual(decodeCursor(cursor), {
    publishedAt: "2026-11-21T08:48:00.000Z",
    id: "00000000-0000-4000-8000-0000000000c2",
  });
  assert.equal(decodeCursor("not-a-cursor"), null);
  const secret = "test-secret-value";
  const signed = authorizeOss({
    method: "GET",
    bucket: "cards",
    key: "qbot-cards/00000000-0000-4000-8000-0000000000d1/index.html",
    endpointHost: "example.invalid",
    accessKeyId: "test-access-key",
    accessKeySecret: secret,
    date: "Sat, 21 Nov 2026 08:44:00 GMT",
  });
  assert.equal(signed.url.includes(secret), false);
  assert.match(signed.headers.Authorization, /^OSS test-access-key:/);
  assert.equal(signed.url, "https://cards.example.invalid/qbot-cards/00000000-0000-4000-8000-0000000000d1/index.html");
});

test("a local object root cannot be read outside one artifact", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "qbot-objects-"));
  const artifact = "00000000-0000-4000-8000-0000000000d1";
  writeFileSync(path.join(root, "secret.txt"), "hidden");
  const store = createLocalObjectStore(root);
  assert.equal(await store.read(artifact, "../secret.txt"), null);
  assert.equal(await store.read(artifact, "..%2Fsecret.txt"), null);
});

test("feed access is a separate switch from personal chat", () => {
  assert.equal(loadConfig(base).feedOpen, false);
  assert.equal(loadConfig(base).personalOpen, false);
  assert.equal(loadConfig({ ...base, QBOT_PERSONAL_OPEN: "1" }).feedOpen, false);
  assert.equal(loadConfig({ ...base, QBOT_FEED_OPEN: "1" }).feedOpen, true);
  assert.equal(loadConfig({ ...base, QBOT_FEED_OPEN: "1" }).personalOpen, false);
  assert.throws(() => loadConfig({ ...base, QBOT_OBJECT_ROOT: "/tmp/qbot-objects", QBOT_OSS_BUCKET: "cards" }), /not both/);
  const secret = "test-secret-value";
  assert.throws(() => loadConfig({ ...base, QBOT_OSS_ACCESS_KEY_SECRET: secret }), (error: unknown) => {
    assert.equal(error instanceof Error && error.message.includes(secret), false);
    return true;
  });
});
