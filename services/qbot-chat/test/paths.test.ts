import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import {
  authorizeOss,
  createLocalObjectStore,
  createOssObjectStore,
  createPublicOssObjectStore,
  normalizePrefix,
  objectKey,
  parseOssEndpoint,
  validateOssBucket,
} from "../src/feed/objects.ts";
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
  const key = objectKey("qbot/cards/", "00000000-0000-4000-8000-0000000000d1", 1, "index.html");
  assert.equal(key, "qbot/cards/00000000-0000-4000-8000-0000000000d1/v1/index.html");
  assert.equal(objectKey("other/", "00000000-0000-4000-8000-0000000000d1", 1, "index.html"), null);
  assert.throws(() => normalizePrefix("other/cards/"), /qbot\//);
  const signed = authorizeOss({
    method: "GET",
    bucket: "cards",
    key: key ?? "",
    endpointHost: "example.invalid",
    accessKeyId: "test-access-key",
    accessKeySecret: secret,
    date: "Sat, 21 Nov 2026 08:44:00 GMT",
  });
  assert.equal(signed.url.includes(secret), false);
  assert.equal(signed.headers["x-oss-object-acl"], undefined);
  assert.match(signed.headers.Authorization, /^OSS test-access-key:/);
  assert.equal(signed.url, "https://cards.example.invalid/qbot/cards/00000000-0000-4000-8000-0000000000d1/v1/index.html");
});

test("a local object root cannot be read outside one artifact", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "qbot-objects-"));
  const artifact = "00000000-0000-4000-8000-0000000000d1";
  writeFileSync(path.join(root, "secret.txt"), "hidden");
  const store = createLocalObjectStore(root);
  assert.equal(await store.read(artifact, 1, "../secret.txt"), null);
  assert.equal(await store.read(artifact, 1, "..%2Fsecret.txt"), null);
});

test("feed access is a separate switch from personal chat", () => {
  assert.equal(loadConfig(base).feedOpen, false);
  assert.equal(loadConfig(base).personalOpen, false);
  assert.equal(loadConfig({ ...base, QBOT_PERSONAL_OPEN: "1" }).feedOpen, false);
  assert.equal(loadConfig({ ...base, QBOT_FEED_OPEN: "1" }).feedOpen, true);
  assert.equal(loadConfig({ ...base, QBOT_FEED_OPEN: "1" }).personalOpen, false);
  assert.equal(loadConfig(base).publicOss, null);
  assert.equal(loadConfig({ ...base, QBOT_OSS_PUBLIC: "yes" }).publicOss, null);
  assert.throws(() => loadConfig({ ...base, QBOT_OBJECT_ROOT: "/tmp/qbot-objects", QBOT_OSS_BUCKET: "cards" }), /not both/);
  const secret = "test-secret-value";
  assert.throws(() => loadConfig({ ...base, QBOT_OSS_ACCESS_KEY_SECRET: secret }), (error: unknown) => {
    assert.equal(error instanceof Error && error.message.includes(secret), false);
    return true;
  });
});

test("public card reads use the fixed https origin and send no credential", async () => {
  const origin = "https://cards.example.invalid";
  const artifact = "00000000-0000-4000-8000-0000000000d1";
  const config = loadConfig({ ...base, QBOT_OSS_PUBLIC: "1", QBOT_OSS_PUBLIC_ORIGIN: origin });
  assert.equal(config.publicOss?.origin, origin);
  assert.equal(config.publicOss?.keyPrefix, "qbot/cards/");
  assert.equal(config.oss, null);
  assert.throws(() => loadConfig({ ...base, QBOT_OSS_PUBLIC: "1" }), /together/);
  assert.throws(() => loadConfig({ ...base, QBOT_OSS_PUBLIC_ORIGIN: origin }), /together/);
  assert.throws(() => loadConfig({ ...base, QBOT_OSS_PUBLIC: "1", QBOT_OSS_PUBLIC_ORIGIN: "http://cards.example.invalid" }), /https/);
  assert.throws(() => loadConfig({ ...base, QBOT_OSS_PUBLIC: "1", QBOT_OSS_PUBLIC_ORIGIN: "https://127.0.0.1" }), /hostname/);
  assert.throws(() => loadConfig({ ...base, QBOT_OSS_PUBLIC: "1", QBOT_OSS_PUBLIC_ORIGIN: "https://cards.example.invalid/qbot/cards" }), /path/);
  assert.throws(() => loadConfig({ ...base, QBOT_OSS_PUBLIC: "1", QBOT_OSS_PUBLIC_ORIGIN: origin, QBOT_OSS_ACCESS_KEY_ID: "test-access-key" }), /access key/);
  assert.throws(() => loadConfig({ ...base, QBOT_OSS_PUBLIC: "1", QBOT_OSS_PUBLIC_ORIGIN: origin, QBOT_OSS_KEY_PREFIX: "qbot/" }), /qbot\/cards/);
  const calls: { url: string; authorization: string | null }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), authorization: headers.get("authorization") });
    if (String(input).endsWith("/index.html")) return new Response(Buffer.from("card-bytes"), { status: 200 });
    return new Response(null, { status: 302, headers: { location: "https://other.example/secret" } });
  };
  const store = createPublicOssObjectStore(config.publicOss!, fetchImpl);
  assert.equal((await store.read(artifact, 1, "index.html"))?.toString(), "card-bytes");
  assert.deepEqual(calls, [{ url: `${origin}/qbot/cards/${artifact}/v1/index.html`, authorization: null }]);
  assert.equal(await store.read(artifact, 1, "cover.png"), null);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.url, `${origin}/qbot/cards/${artifact}/v1/cover.png`);
  assert.equal(calls.every((call) => call.url.startsWith(`${origin}/qbot/cards/`)), true);
  assert.equal(await store.read(artifact, 1, "../secret.txt"), null);
  assert.equal(await store.read(artifact, 1, "qbot/private/note.txt"), null);
  assert.equal(calls.length, 2);
  assert.equal(store.write, undefined);
});

test("OSS prefix, bucket, endpoint, and signed store lock all reads and writes under qbot/cards/", async () => {
  const artifact = "00000000-0000-4000-8000-0000000000d1";
  assert.equal(normalizePrefix(""), "qbot/cards/");
  assert.equal(normalizePrefix("qbot/cards"), "qbot/cards/");
  assert.equal(normalizePrefix("/qbot/cards/"), "qbot/cards/");
  assert.equal(normalizePrefix("qbot/cards/prod"), "qbot/cards/prod/");
  for (const bad of ["/", "qbot/", "qbot/private/", "qbot/cards-evil/", "other/cards/", "qbot/cards/../private/", "qbot/cards/./sub/", "qbot/cards//sub/", "qbot/cards/%2e%2e/"]) {
    assert.throws(() => normalizePrefix(bad), /QBOT_OSS_KEY_PREFIX/, bad);
    assert.equal(objectKey(bad, artifact, 1, "index.html"), null, bad);
  }
  assert.equal(objectKey("", artifact, 1, "index.html"), null);

  assert.equal(parseOssEndpoint("oss-cn-example.aliyuncs.com"), "oss-cn-example.aliyuncs.com");
  assert.equal(parseOssEndpoint("https://oss-cn-example-internal.aliyuncs.com/"), "oss-cn-example-internal.aliyuncs.com");
  for (const badHost of ["http://oss.example.invalid", "127.0.0.1", "10.0.2.2", "localhost", "oss..example.invalid", "oss.example.invalid/path", "user@oss.example.invalid"]) {
    assert.throws(() => parseOssEndpoint(badHost), /QBOT_OSS_ENDPOINT/, badHost);
  }
  assert.equal(validateOssBucket("cards-bucket-1"), "cards-bucket-1");
  for (const badBucket of ["bad..bucket", "bad.", "bad-", "UPPER"]) {
    assert.throws(() => validateOssBucket(badBucket), /QBOT_OSS_BUCKET/, badBucket);
  }

  assert.throws(() => authorizeOss({
    method: "PUT",
    bucket: "cards",
    key: `qbot/private/${artifact}/v1/index.html`,
    endpointHost: "oss.example.invalid",
    accessKeyId: "test-ak",
    accessKeySecret: "test-sk",
    date: "Sat, 21 Nov 2026 08:44:00 GMT",
    contentType: "text/html; charset=utf-8",
  }), /qbot\/cards\//);
  assert.throws(() => authorizeOss({
    method: "PUT",
    bucket: "cards",
    key: `qbot/cards/${artifact}/v1/index.html`,
    endpointHost: "oss.example.invalid",
    accessKeyId: "test-ak",
    accessKeySecret: "test-sk",
    date: "Sat, 21 Nov 2026 08:44:00 GMT",
    contentType: "text/html\r\nx-oss-object-acl: public-read",
  }), /newlines/);

  const ossEnv = {
    ...base,
    QBOT_OSS_ENDPOINT: "https://oss.example.invalid",
    QBOT_OSS_BUCKET: "cards",
    QBOT_OSS_ACCESS_KEY_ID: "test-access-key",
    QBOT_OSS_ACCESS_KEY_SECRET: "test-secret-value",
  };
  assert.equal(loadConfig(ossEnv).oss?.keyPrefix, "qbot/cards/");
  assert.equal(loadConfig({ ...ossEnv, QBOT_OSS_KEY_PREFIX: "qbot/cards/v2" }).oss?.keyPrefix, "qbot/cards/v2/");
  assert.throws(() => loadConfig({ ...ossEnv, QBOT_OSS_KEY_PREFIX: "qbot/" }), /qbot\/cards\//);
  assert.throws(() => loadConfig({ ...ossEnv, QBOT_OSS_KEY_PREFIX: "qbot/private/" }), /qbot\/cards\//);
  assert.throws(() => loadConfig({ ...ossEnv, QBOT_OSS_KEY_PREFIX: "qbot/cards/../private/" }), /QBOT_OSS_KEY_PREFIX/);

  assert.throws(() => createOssObjectStore({
    bucket: "cards",
    endpointHost: "oss.example.invalid",
    accessKeyId: "test-ak",
    accessKeySecret: "test-sk",
    keyPrefix: "qbot/private/",
  }), /qbot\/cards\//);
  assert.throws(() => createOssObjectStore({
    bucket: "cards",
    endpointHost: "127.0.0.1",
    accessKeyId: "test-ak",
    accessKeySecret: "test-sk",
    keyPrefix: "qbot/cards/",
  }), /QBOT_OSS_ENDPOINT/);

  const calls: { method: string; url: string; headers: Headers; redirect?: RequestRedirect }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      method: init?.method ?? "GET",
      url: String(input),
      headers: new Headers(init?.headers),
      redirect: init?.redirect,
    });
    if (init?.method === "PUT") return new Response(null, { status: 200 });
    return new Response(Buffer.from("oss-card-bytes"), { status: 200 });
  };
  const cfg = loadConfig(ossEnv).oss!;
  const ossStore = createOssObjectStore(cfg, fetchImpl);
  assert.equal(await ossStore.write!(artifact, 1, "index.html", Buffer.from("<main>ok</main>"), "text/html; charset=utf-8"), true);
  assert.equal((await ossStore.read(artifact, 1, "index.html"))?.toString(), "oss-card-bytes");
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.method, "PUT");
  assert.equal(calls[0]?.url, `https://cards.oss.example.invalid/qbot/cards/${artifact}/v1/index.html`);
  assert.equal(calls[0]?.headers.get("x-oss-object-acl"), null);
  assert.equal(calls[0]?.redirect, "manual");
  assert.equal(calls[0]?.url.includes(cfg.accessKeySecret), false);
  assert.equal(calls[1]?.method, "GET");
  assert.equal(calls[1]?.url, `https://cards.oss.example.invalid/qbot/cards/${artifact}/v1/index.html`);
  assert.equal(calls[1]?.redirect, "manual");

  assert.equal(await ossStore.write!(artifact, 1, "../secret.png", Buffer.from("x"), "image/png"), false);
  assert.equal(await ossStore.write!(artifact, 1, "..%2Fsecret.png", Buffer.from("x"), "image/png"), false);
  assert.equal(await ossStore.write!("not-a-uuid", 1, "index.html", Buffer.from("x"), "text/html; charset=utf-8"), false);
  assert.equal(await ossStore.write!(artifact, 1, "index.html", Buffer.alloc(0), "text/html; charset=utf-8"), false);
  assert.equal(await ossStore.write!(artifact, 1, "index.html", Buffer.from("x"), "text/html\r\nx-oss-object-acl: public-read"), false);
  assert.equal(await ossStore.read(artifact, 1, "../secret.txt"), null);
  assert.equal(calls.length, 2);
});
