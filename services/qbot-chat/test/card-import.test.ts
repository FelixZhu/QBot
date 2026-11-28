import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { jcs, jcsSha256, sha256Hex } from "../src/card-import/jcs.ts";
import { PACKAGE_LIMITS } from "../src/card-import/limits.ts";
import { createLocalZipStore } from "../src/card-import/uploads.ts";
import { validateCardPackage } from "../src/card-import/validate.ts";
import { createCardImportWorker } from "../src/card-import/worker.ts";
import { loadConfig } from "../src/config.ts";
import { createLocalObjectStore, type ObjectStore } from "../src/feed/objects.ts";
import type { ConversationEngine } from "../src/runtime/dsh.ts";
import { startChatServer, type ChatStore } from "../src/server.ts";
import { buildCardPackageZip, SAMPLE_LIGHT_PNG } from "./build-package.ts";
import { createMemoryCardImportStore } from "./memory-card-import-store.ts";
import { buildZip } from "./zip-writer.ts";

const TOKEN = "qbot-fixture-token-not-a-secret";
const OWNER = "00000000-0000-4000-8000-000000000001";
const BOT_ID = "00000000-0000-4000-8000-0000000000b1";
const PRIVATE_BOT_ID = "00000000-0000-4000-8000-0000000000b2";

function stubChatStore(): ChatStore {
  return {
    async health() { return true; },
    async ensureOwner() {},
    async ensureAgent(_ownerId, _persona, model) { return { id: BOT_ID, model }; },
    async getAgent() { return { id: BOT_ID, model: "deepseek/deepseek-v4.1-flash-1017" }; },
    async failStaleRuns() {},
    async listConversations() { return []; },
    async getConversation() { return null; },
    async createConversation() { throw new Error("unused"); },
    async renameConversation() { return null; },
    async deleteConversation() { return false; },
    async listMessages() { return []; },
    async beginTurn() { throw new Error("unused"); },
    async finishTurn() {},
    async setDshSession() {},
  };
}

function stubRuntime(): ConversationEngine {
  return { engine: "dsh", id: "fixture", run() { throw new Error("unused"); }, async close() {} };
}

function makeConfig(extra: Record<string, string> = {}) {
  return loadConfig({
    DATABASE_URL: "postgres://qbot:qbot@127.0.0.1:5432/qbot",
    QBOT_OWNER_ID: OWNER,
    QBOT_ACCESS_TOKEN: TOKEN,
    OPENROUTER_API_KEY: "fixture-openrouter-key-not-a-secret",
    HOST: "127.0.0.1",
    PORT: "0",
    QBOT_FIXTURE_UPSTREAM: "1",
    QBOT_FIXTURE_UPSTREAM_URL: "http://127.0.0.1:9/v1/chat/completions",
    ...extra,
  });
}

async function pollState(base: string, importId: string, terminal: readonly string[]): Promise<Record<string, unknown>> {
  for (let i = 0; i < 60; i += 1) {
    const res = await fetch(`${base}/v1/card-imports/${importId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200, await res.clone().text());
    const body = await res.json() as Record<string, unknown>;
    assert.notEqual(body.state, "accepted", "GET must never return accepted as persistent state");
    if (terminal.includes(String(body.state))) return body;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${importId} to reach ${terminal.join("|")}`);
}

test("JCS canonicalization and validation rules enforce CARD-PACKAGE v1.0", async () => {
  assert.equal(jcs({ b: 1, a: [true, -0, "x"] }), '{"a":[true,0,"x"],"b":1}');
  assert.throws(() => jcs({ x: Number.NaN }), /JCS/);

  const resolveBot = async (ownerId: string, slug: string) => (ownerId === OWNER && slug === "qbot" ? { id: BOT_ID } : null);

  // 1. Documented card-package/ layout with dual covers passes, and `owner` in manifest is ignored.
  const validWithOwner = buildCardPackageZip({ ownerField: "spoofed-owner-id", idempotencyKey: "valid-owner-ignored-1" });
  const okRes = await validateCardPackage({
    zipBytes: validWithOwner.zip,
    idempotencyKey: validWithOwner.idempotencyKey,
    ownerId: OWNER,
    resolveBot,
  });
  assert.equal(okRes.ok, true, okRes.ok ? "" : JSON.stringify(okRes.errors));

  // 2. Unknown fields rejected (additionalProperties: false).
  const unknownField = buildCardPackageZip({
    extraManifestFields: { extraStuff: 123 },
    idempotencyKey: "unknown-field-key-1",
  });
  const unknownRes = await validateCardPackage({
    zipBytes: unknownField.zip,
    idempotencyKey: unknownField.idempotencyKey,
    ownerId: OWNER,
    resolveBot,
  });
  assert.equal(unknownRes.ok, false);
  assert.ok(!unknownRes.ok && unknownRes.errors.some((e) => e.code === "unknown_field"));

  // 3. v1.example.json (importable: false) is never accepted.
  const examplePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/card-package/v1.example.json");
  const exampleJson = readFileSync(examplePath);
  const exampleZip = buildZip([
    { name: "card-package/manifest.json", data: exampleJson },
    { name: "card-package/cover-light.png", data: SAMPLE_LIGHT_PNG },
    { name: "card-package/cover-dark.png", data: SAMPLE_LIGHT_PNG },
    { name: "card-package/work/index.html", data: Buffer.from("<body><p id='claim1'>example conclusion</p></body>") },
    { name: "card-package/work/assets/page.css", data: Buffer.from("body{}") },
  ]);
  const exampleRes = await validateCardPackage({
    zipBytes: exampleZip,
    idempotencyKey: "client-label-not-the-unique-key",
    ownerId: OWNER,
    resolveBot,
  });
  assert.equal(exampleRes.ok, false);

  // 4. Banned HTML tags, undeclared https links, missing anchor, private source, and bad safe-area are rejected.
  const badHtml = buildCardPackageZip({
    html: '<body><p id="claim1">这是一条有锚点佐证的核心结论</p><script>alert(1)</script><a href="https://undeclared.invalid/x">x</a></body>',
    idempotencyKey: "bad-html-key-123",
  });
  const badHtmlRes = await validateCardPackage({
    zipBytes: badHtml.zip,
    idempotencyKey: badHtml.idempotencyKey,
    ownerId: OWNER,
    resolveBot,
  });
  assert.equal(badHtmlRes.ok, false);
  assert.ok(!badHtmlRes.ok && badHtmlRes.errors.some((e) => e.message.includes("<script>")));
  assert.ok(!badHtmlRes.ok && badHtmlRes.errors.some((e) => e.message.includes("sources 里声明")));

  const privateSrc = buildCardPackageZip({ sourcePrivate: true, idempotencyKey: "private-source-key-1" });
  const privateRes = await validateCardPackage({
    zipBytes: privateSrc.zip,
    idempotencyKey: privateSrc.idempotencyKey,
    ownerId: OWNER,
    resolveBot,
  });
  assert.equal(privateRes.ok, false);
  assert.ok(!privateRes.ok && privateRes.errors.some((e) => e.code === "private_source"));

  const badSafe = buildCardPackageZip({
    idempotencyKey: "bad-safe-area-key-1",
    mutateManifest(m) {
      m.contentSafe = { top: 10, right: 20, bottom: 148, left: 20 }; // top < insetTop (44)
      const cd = jcsSha256({
        title: (m.card as { title: string }).title,
        claims: m.claims,
        files: m.files,
        contentSafe: m.contentSafe,
        referenceCanvas: m.referenceCanvas,
        sources: (m.sources as { id: string; url: string }[]).map((s) => ({ id: s.id, url: s.url })),
      });
      m.contentDigest = { alg: "sha256-jcs", value: cd };
      const copy = { ...m };
      delete copy.manifestDigest;
      m.manifestDigest = { alg: "sha256-jcs", value: jcsSha256(copy) };
    },
  });
  const badSafeRes = await validateCardPackage({
    zipBytes: badSafe.zip,
    idempotencyKey: badSafe.idempotencyKey,
    ownerId: OWNER,
    resolveBot,
  });
  assert.equal(badSafeRes.ok, false);
  assert.ok(!badSafeRes.ok && badSafeRes.errors.some((e) => e.code === "content_safe"));

  // 5. Mixed prefix layout and compression bomb ratio > 100:1 rejected.
  const mixed = buildCardPackageZip({
    idempotencyKey: "mixed-prefix-key-1",
    extraZipEntries: [{ name: "outside.txt", data: Buffer.from("nope") }],
  });
  const mixedRes = await validateCardPackage({
    zipBytes: mixed.zip,
    idempotencyKey: mixed.idempotencyKey,
    ownerId: OWNER,
    resolveBot,
  });
  assert.equal(mixedRes.ok, false);
  assert.ok(!mixedRes.ok && mixedRes.errors.some((e) => e.code === "path"));

  const bomb = buildZip([{ name: "card-package/work/assets/zero.css", data: Buffer.alloc(200_000, 0x20), method: 8 }]);
  const bombRes = await validateCardPackage({
    zipBytes: bomb,
    idempotencyKey: "bomb-ratio-key-1",
    ownerId: OWNER,
    resolveBot,
  });
  assert.equal(bombRes.ok, false);
  assert.ok(!bombRes.ok && bombRes.errors.some((e) => e.code === "compression_ratio"));
});

test("async card-import HTTP lifecycle: shallow checks, 202 queue, idempotency, rejection release, sample=true, publish, rollback, recovery, and auth isolation", async () => {
  const objectRoot = mkdtempSync(path.join(tmpdir(), "qbot-import-objects-"));
  const importDir = mkdtempSync(path.join(tmpdir(), "qbot-import-zips-"));
  const mem = createMemoryCardImportStore([
    { id: BOT_ID, ownerId: OWNER, slug: "qbot", visibility: "public" },
    { id: PRIVATE_BOT_ID, ownerId: OWNER, slug: "secret-bot", visibility: "private" },
  ]);
  const innerObjects = createLocalObjectStore(objectRoot);
  const writtenKeys: string[] = [];
  const spyObjects: ObjectStore = {
    read: innerObjects.read,
    async write(artifactId, version, relPath, bytes, contentType) {
      writtenKeys.push(`${artifactId}/v${version}/${relPath}`);
      return innerObjects.write!(artifactId, version, relPath, bytes, contentType);
    },
  };
  const zipStore = createLocalZipStore(importDir);
  const worker = createCardImportWorker({ store: mem.store, zips: zipStore, objects: spyObjects, pollIntervalMs: 60_000 });

  // Server with BOTH QBOT_FEED_OPEN=1 and QBOT_PERSONAL_OPEN=1 to prove write paths stay closed without Bearer.
  const started = await startChatServer({
    config: makeConfig({ QBOT_OBJECT_ROOT: objectRoot, QBOT_IMPORT_DIR: importDir, QBOT_FEED_OPEN: "1", QBOT_PERSONAL_OPEN: "1" }),
    store: stubChatStore(),
    runtime: stubRuntime(),
    objects: spyObjects,
    zipStore,
    cardImports: mem.store,
    cardImportWorker: worker,
  });
  const base = `http://127.0.0.1:${started.port}`;

  try {
    // 0. POST /v1/cards is deleted (404, never a successful publish).
    const oldPublishBearer = await fetch(`${base}/v1/cards`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "old", files: [] }),
    });
    assert.equal(oldPublishBearer.status, 404);
    const oldPublishOpen = await fetch(`${base}/v1/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "old", files: [] }),
    });
    assert.equal(oldPublishOpen.status, 404);

    // 1. Write & read paths under /v1/card-imports* stay 401 without Bearer even with QBOT_FEED_OPEN=1 & QBOT_PERSONAL_OPEN=1.
    const validV1 = buildCardPackageZip({ cardKey: "brief-1", contentVersion: 1, idempotencyKey: "idem-brief-1-v1" });
    assert.equal((await fetch(`${base}/v1/card-imports`, {
      method: "POST",
      headers: { "Content-Type": "application/zip", "Idempotency-Key": validV1.idempotencyKey },
      body: new Uint8Array(validV1.zip),
    })).status, 401);
    const fakeId = randomUUID();
    assert.equal((await fetch(`${base}/v1/card-imports/${fakeId}`)).status, 401);
    assert.equal((await fetch(`${base}/v1/card-imports/${fakeId}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedPreviousVersion: null }),
    })).status, 401);
    assert.equal((await fetch(`${base}/v1/card-imports/${fakeId}/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })).status, 401);

    // 2. Shallow-check rejections (bad Content-Type, bad Idempotency-Key, bad ZIP magic, > 8 MiB).
    assert.equal((await fetch(`${base}/v1/card-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "Idempotency-Key": "shallow-ct-1" },
      body: "{}",
    })).status, 415);

    assert.equal((await fetch(`${base}/v1/card-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": "short" },
      body: new Uint8Array(validV1.zip),
    })).status, 400);

    assert.equal((await fetch(`${base}/v1/card-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": "shallow-magic-1" },
      body: Buffer.from("not-a-zip-payload"),
    })).status, 400);

    const oversized = Buffer.alloc(PACKAGE_LIMITS.zipBytes + 1, 0);
    oversized.set([0x50, 0x4b, 0x03, 0x04], 0);
    assert.equal((await fetch(`${base}/v1/card-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": "shallow-size-1" },
      body: new Uint8Array(oversized),
    })).status, 413);

    // 3. 202 queue: accepted -> queued -> ready (and durable ZIP persisted before 202).
    // Pause worker briefly to assert persistent `queued` state and durable ZIP on disk before drain.
    await worker.stop();
    const postV1 = await fetch(`${base}/v1/card-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": validV1.idempotencyKey },
      body: new Uint8Array(validV1.zip),
    });
    assert.equal(postV1.status, 202, await postV1.clone().text());
    const acceptedV1 = await postV1.json() as { importId: string; state: string };
    assert.equal(acceptedV1.state, "accepted");
    assert.equal(existsSync(path.join(importDir, `${acceptedV1.importId}.zip`)), true, "ZIP must be persisted durably before 202");

    const queuedGet = await fetch(`${base}/v1/card-imports/${acceptedV1.importId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(queuedGet.status, 200);
    const queuedBody = await queuedGet.json() as Record<string, unknown>;
    assert.equal(queuedBody.state, "queued");
    assert.equal(queuedBody.ownerBound, true);
    assert.equal(queuedBody.publishAllowed, false);
    assert.equal(queuedBody.visibility, "hidden");
    assert.equal(queuedBody.notification, "not-authorized");

    // 4. Idempotency: same key + same ZIP hash returns the same importId; different ZIP hash returns 409 conflict.
    const dupV1 = await fetch(`${base}/v1/card-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": validV1.idempotencyKey },
      body: new Uint8Array(validV1.zip),
    });
    assert.equal(dupV1.status, 202);
    assert.equal(((await dupV1.json()) as { importId: string }).importId, acceptedV1.importId);

    const diffZipSameKey = buildCardPackageZip({ cardKey: "brief-1", contentVersion: 1, title: "不同内容", idempotencyKey: validV1.idempotencyKey });
    const conflictInFlight = await fetch(`${base}/v1/card-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": validV1.idempotencyKey },
      body: new Uint8Array(diffZipSameKey.zip),
    });
    assert.equal(conflictInFlight.status, 409);

    // 5. Simulate process restart recovery: mark job stuck in `validating`, restart worker -> recovers to `ready`.
    mem.imports.get(acceptedV1.importId)!.state = "validating";
    await worker.start();
    const readyV1 = await pollState(base, acceptedV1.importId, ["ready", "rejected"]);
    assert.equal(readyV1.state, "ready", JSON.stringify(readyV1));
    assert.equal(readyV1.botSlug, "qbot");
    assert.equal(readyV1.cardKey, "brief-1");
    assert.equal(readyV1.contentVersion, 1);
    assert.equal(readyV1.manifestDigest, validV1.manifestDigest);
    assert.equal(readyV1.contentDigest, validV1.contentDigest);
    assert.equal(readyV1.sample, false);
    assert.equal(readyV1.publishAllowed, true);
    assert.equal(readyV1.visibility, "hidden");
    assert.equal(readyV1.notification, "not-authorized");
    // Must NOT auto-publish to Feed!
    const cardV1 = mem.cards.get(String(readyV1.cardId))!;
    assert.equal(cardV1.artifactId, null, "async worker must not auto-publish");

    // Conflict persists after `ready` when same key + different ZIP hash is sent.
    assert.equal((await fetch(`${base}/v1/card-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": validV1.idempotencyKey },
      body: new Uint8Array(diffZipSameKey.zip),
    })).status, 409);

    // 6. Validation failure -> `rejected` with reasons, zero staging objects written, and key is RELEASED for retry!
    const writesBeforeBad = writtenKeys.length;
    const badPkg = buildCardPackageZip({
      cardKey: "retry-card",
      contentVersion: 1,
      idempotencyKey: "idem-retry-released-1",
      html: "<body><p id='wrong'>no anchor</p></body>",
    });
    const postBad = await fetch(`${base}/v1/card-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": badPkg.idempotencyKey },
      body: new Uint8Array(badPkg.zip),
    });
    assert.equal(postBad.status, 202);
    const badAccepted = await postBad.json() as { importId: string };
    const rejected = await pollState(base, badAccepted.importId, ["rejected", "ready"]);
    assert.equal(rejected.state, "rejected");
    assert.equal(typeof rejected.reason, "string");
    assert.ok(Array.isArray(rejected.errors) && rejected.errors.length > 0);
    assert.equal(writtenKeys.length, writesBeforeBad, "rejected package must not write objects under qbot/cards/");

    // Now reuse the SAME Idempotency-Key with a fixed valid ZIP -> allowed!
    const fixedPkg = buildCardPackageZip({
      cardKey: "retry-card",
      contentVersion: 1,
      idempotencyKey: badPkg.idempotencyKey,
    });
    const postRetry = await fetch(`${base}/v1/card-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": fixedPkg.idempotencyKey },
      body: new Uint8Array(fixedPkg.zip),
    });
    assert.equal(postRetry.status, 202);
    const retryAccepted = await postRetry.json() as { importId: string };
    assert.notEqual(retryAccepted.importId, badAccepted.importId);
    const retryReady = await pollState(base, retryAccepted.importId, ["ready", "rejected"]);
    assert.equal(retryReady.state, "ready", JSON.stringify(retryReady));

    // 7. Same 4-tuple + different manifestDigest (via different idempotencyKey) -> rejected conflict!
    const tupleConflictPkg = buildCardPackageZip({
      cardKey: "brief-1",
      contentVersion: 1,
      idempotencyKey: "idem-brief-1-v1-different-key",
    });
    const postTupleConflict = await fetch(`${base}/v1/card-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": tupleConflictPkg.idempotencyKey },
      body: new Uint8Array(tupleConflictPkg.zip),
    });
    assert.equal(postTupleConflict.status, 202);
    const tupleRejected = await pollState(base, ((await postTupleConflict.json()) as { importId: string }).importId, ["rejected", "ready"]);
    assert.equal(tupleRejected.state, "rejected");
    assert.ok((tupleRejected.errors as { code: string }[]).some((e) => e.code === "version_conflict"));

    // 8. sample=true -> validates and stages immutable objects, stops at `staged`, no version row, publish rejected!
    const writesBeforeSample = writtenKeys.length;
    const samplePkg = buildCardPackageZip({
      cardKey: "sample-card",
      contentVersion: 1,
      sample: true,
      idempotencyKey: "idem-sample-card-v1",
    });
    const postSample = await fetch(`${base}/v1/card-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": samplePkg.idempotencyKey },
      body: new Uint8Array(samplePkg.zip),
    });
    assert.equal(postSample.status, 202);
    const sampleId = ((await postSample.json()) as { importId: string }).importId;
    const sampleStatus = await pollState(base, sampleId, ["staged", "ready", "rejected"]);
    assert.equal(sampleStatus.state, "staged", JSON.stringify(sampleStatus));
    assert.equal(sampleStatus.sample, true);
    assert.equal(sampleStatus.publishAllowed, false);
    assert.equal(sampleStatus.visibility, "hidden");
    assert.equal(sampleStatus.cardId, null);
    assert.equal(sampleStatus.notification, "not-authorized");
    assert.ok(writtenKeys.length > writesBeforeSample, "sample=true may stage immutable objects");

    const samplePublish = await fetch(`${base}/v1/card-imports/${sampleId}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedPreviousVersion: null }),
    });
    assert.equal(samplePublish.status, 409);

    // 9. Publish v1 -> visible; publish v2 with identical contentDigest -> rejected (409 content_unchanged);
    //    publish v2 with changed content -> visible; rollback v2 -> restored to v1!
    const pubV1 = await fetch(`${base}/v1/card-imports/${acceptedV1.importId}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedPreviousVersion: null }),
    });
    assert.equal(pubV1.status, 200, await pubV1.clone().text());
    const pubV1Body = await pubV1.json() as Record<string, unknown>;
    assert.equal(pubV1Body.state, "published");
    assert.equal(pubV1Body.visibility, "public");
    assert.equal(pubV1Body.notification, "not-authorized");
    assert.equal(cardV1.currentVersion, 1);
    const v1ArtifactId = cardV1.artifactId;
    assert.ok(v1ArtifactId);

    // v2 with identical semantic contentDigest:
    const v2SameContent = buildCardPackageZip({
      cardKey: "brief-1",
      contentVersion: 2,
      expectedPreviousVersion: 1,
      idempotencyKey: "idem-brief-1-v2-same-content",
    });
    assert.equal(v2SameContent.contentDigest, validV1.contentDigest);
    const postV2Same = await fetch(`${base}/v1/card-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": v2SameContent.idempotencyKey },
      body: new Uint8Array(v2SameContent.zip),
    });
    assert.equal(postV2Same.status, 202);
    const v2SameId = ((await postV2Same.json()) as { importId: string }).importId;
    assert.equal((await pollState(base, v2SameId, ["ready", "rejected"])).state, "ready");
    const pubV2Same = await fetch(`${base}/v1/card-imports/${v2SameId}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedPreviousVersion: 1 }),
    });
    assert.equal(pubV2Same.status, 409);
    assert.equal(((await pubV2Same.json()) as { error?: { code?: string } }).error?.code, "content_unchanged");
    assert.equal(cardV1.artifactId, v1ArtifactId, "failed publish must leave visible pointer unchanged");

    // v3 with genuinely updated title/content -> publishes, then rolls back to v1!
    const v3Changed = buildCardPackageZip({
      cardKey: "brief-1",
      contentVersion: 3,
      expectedPreviousVersion: 1,
      title: "更新后的标题 v3",
      quote: "这是更新后的第三版核心结论",
      idempotencyKey: "idem-brief-1-v3-changed",
    });
    const postV3 = await fetch(`${base}/v1/card-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": v3Changed.idempotencyKey },
      body: new Uint8Array(v3Changed.zip),
    });
    assert.equal(postV3.status, 202);
    const v3Id = ((await postV3.json()) as { importId: string }).importId;
    assert.equal((await pollState(base, v3Id, ["ready", "rejected"])).state, "ready");

    // Wrong expectedPreviousVersion rejected:
    assert.equal((await fetch(`${base}/v1/card-imports/${v3Id}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedPreviousVersion: null }),
    })).status, 409);

    const pubV3 = await fetch(`${base}/v1/card-imports/${v3Id}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedPreviousVersion: 1 }),
    });
    assert.equal(pubV3.status, 200, await pubV3.clone().text());
    assert.equal(cardV1.currentVersion, 3);
    assert.equal(cardV1.title, "更新后的标题 v3");
    assert.notEqual(cardV1.artifactId, v1ArtifactId);

    const rbV3 = await fetch(`${base}/v1/card-imports/${v3Id}/rollback`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(rbV3.status, 200, await rbV3.clone().text());
    const rbBody = await rbV3.json() as Record<string, unknown>;
    assert.equal(rbBody.state, "rolled-back");
    assert.equal(rbBody.visibility, "hidden");
    assert.equal(rbBody.notification, "not-authorized");
    assert.equal(cardV1.currentVersion, 1);
    assert.equal(cardV1.artifactId, v1ArtifactId, "rollback must restore previous visible pointer");

    // 10. Expired visibility window (past notAfter) cannot be published.
    const expiredPkg = buildCardPackageZip({
      cardKey: "expired-card",
      contentVersion: 1,
      idempotencyKey: "idem-expired-card-v1",
      notBefore: new Date(Date.now() - 120_000).toISOString(),
      notAfter: new Date(Date.now() - 60_000).toISOString(),
    });
    const postExpired = await fetch(`${base}/v1/card-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": expiredPkg.idempotencyKey },
      body: new Uint8Array(expiredPkg.zip),
    });
    assert.equal(postExpired.status, 202);
    const expiredId = ((await postExpired.json()) as { importId: string }).importId;
    assert.equal((await pollState(base, expiredId, ["ready", "rejected"])).state, "ready");
    const pubExpired = await fetch(`${base}/v1/card-imports/${expiredId}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedPreviousVersion: null }),
    });
    assert.equal(pubExpired.status, 409);
    assert.equal(((await pubExpired.json()) as { error?: { code?: string } }).error?.code, "window_expired");

    // 11. Conflicts when same key + different hash against staged, published, and rolled-back jobs.
    const diffForSample = buildCardPackageZip({ cardKey: "sample-card", contentVersion: 1, title: "变了", idempotencyKey: samplePkg.idempotencyKey });
    assert.equal((await fetch(`${base}/v1/card-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": samplePkg.idempotencyKey },
      body: new Uint8Array(diffForSample.zip),
    })).status, 409);

    const diffForPublished = buildCardPackageZip({ cardKey: "brief-1", contentVersion: 1, title: "变了", idempotencyKey: validV1.idempotencyKey });
    assert.equal((await fetch(`${base}/v1/card-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": validV1.idempotencyKey },
      body: new Uint8Array(diffForPublished.zip),
    })).status, 409);

    const diffForRolledBack = buildCardPackageZip({ cardKey: "brief-1", contentVersion: 3, title: "变了", idempotencyKey: v3Changed.idempotencyKey });
    assert.equal((await fetch(`${base}/v1/card-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": v3Changed.idempotencyKey },
      body: new Uint8Array(diffForRolledBack.zip),
    })).status, 409);

    // 12. Private bot not on allow-list is rejected.
    const privateBotPkg = buildCardPackageZip({
      botSlug: "secret-bot",
      cardKey: "private-bot-card",
      contentVersion: 1,
      idempotencyKey: "idem-private-bot-card-v1",
    });
    const postPrivBot = await fetch(`${base}/v1/card-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": privateBotPkg.idempotencyKey },
      body: new Uint8Array(privateBotPkg.zip),
    });
    assert.equal(postPrivBot.status, 202);
    const privBotId = ((await postPrivBot.json()) as { importId: string }).importId;
    const privBotStatus = await pollState(base, privBotId, ["rejected", "ready"]);
    assert.equal(privBotStatus.state, "rejected");
    assert.ok((privBotStatus.errors as { code: string }[]).some((e) => e.code === "bot_ref"));

    // 13. Rollback of v1 hides the card (artifactId -> null).
    const rbV1 = await fetch(`${base}/v1/card-imports/${acceptedV1.importId}/rollback`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(rbV1.status, 200);
    assert.equal(cardV1.artifactId, null);
    assert.equal(cardV1.currentVersion, null);

    // 14. Owner isolation: another owner cannot read/publish/rollback this owner's import.
    const otherOwner = "00000000-0000-4000-8000-000000000002";
    const otherServer = await startChatServer({
      config: makeConfig({ QBOT_OWNER_ID: otherOwner, QBOT_OBJECT_ROOT: objectRoot, QBOT_IMPORT_DIR: importDir }),
      store: stubChatStore(),
      runtime: stubRuntime(),
      objects: spyObjects,
      zipStore,
      cardImports: mem.store,
    });
    try {
      const otherBase = `http://127.0.0.1:${otherServer.port}`;
      assert.equal((await fetch(`${otherBase}/v1/card-imports/${retryAccepted.importId}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })).status, 404);
      assert.equal((await fetch(`${otherBase}/v1/card-imports/${retryAccepted.importId}/publish`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedPreviousVersion: null }),
      })).status, 404);
    } finally {
      await otherServer.close();
    }
  } finally {
    await started.close();
  }
});
