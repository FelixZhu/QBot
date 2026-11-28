import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.ts";
import { createPool } from "../src/db.ts";
import { applyMigrations } from "../src/migrate.ts";
import type { ConversationEngine } from "../src/runtime/dsh.ts";
import { loadManifest, placeBundles, seedCards } from "../src/seed-cards.ts";
import { startChatServer } from "../src/server.ts";
import { createStore } from "../src/store.ts";
import { buildCardPackageZip } from "./build-package.ts";

const TOKEN = "qbot-fixture-token-not-a-secret";
const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const INFO = "00000000-0000-4000-8000-0000000000c1";
const ENGLISH = "00000000-0000-4000-8000-0000000000c2";
const INFO_ARTIFACT = "00000000-0000-4000-8000-0000000000d1";

test("seed, feeds, follow, and bundle access against temporary postgres", { timeout: 120_000 }, async () => {
  const migrateUrl = requiredEnv("DATABASE_MIGRATE_URL");
  const admin = new URL(migrateUrl);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(admin.hostname));
  const name = `qbot_cards_${randomBytes(4).toString("hex")}`;
  const maintenance = new URL(migrateUrl);
  maintenance.pathname = "/postgres";
  const adminPool = createPool(maintenance.toString());
  const runtime = new URL(migrateUrl);
  runtime.pathname = `/${name}`;
  const runtimeUrl = runtime.toString();
  await adminPool.query(`CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8'`);
  try {
    const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
    await applyMigrations({ runtimeUrl, migrateUrl: runtimeUrl, directory });
    await applyMigrations({ runtimeUrl, migrateUrl: runtimeUrl, directory });
    const manifest = await loadManifest();
    assert.equal(manifest.cards.length, 2);
    const flat = manifest.cards.flatMap((card) => card.files);
    assert.ok(flat.length < 20);
    assert.equal(flat.some((file) => /\.(ttf|otf|woff2?)$/i.test(file.path)), false);

    const first = await seedCards({ databaseUrl: runtimeUrl, ownerId: OWNER });
    const second = await seedCards({ databaseUrl: runtimeUrl, ownerId: OWNER });
    assert.equal(first.cardCount, 2);
    assert.equal(first.objects.length, 7);
    assert.ok(first.objects.every((object) => object.key.startsWith("qbot/cards/") && object.key.includes("/v1/")));
    assert.equal(first.objects.some((object) => object.key.includes("qbot-cards")), false);
    assert.equal(first.followed, true);
    const stamped = await poolTimes(createPool(runtimeUrl), first.agentId);
    assert.equal(stamped.length, 2);
    for (const row of stamped) {
      assert.ok(Math.abs(Date.now() - Date.parse(row.publishedAt)) < 120_000, row.publishedAt);
      assert.equal(row.authoredAt, "2026-11-21T09:21:18.000Z");
    }
    const frozen = stamped.map((row) => row.publishedAt);
    assert.equal(second.cardCount, 2);
    assert.equal(second.objects.length, 0);
    assert.equal(second.agentId, first.agentId);
    assert.equal(second.followed, true);
    assert.deepEqual((await poolTimes(createPool(runtimeUrl), first.agentId)).map((row) => row.publishedAt), frozen);

    const pool = createPool(runtimeUrl);
    const agents = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM agents WHERE owner_id = $1", [OWNER]);
    assert.equal(agents.rows[0]?.n, 1);
    const conversationId = randomUUID();
    const runId = randomUUID();
    const messageId = randomUUID();
    await pool.query(
      `INSERT INTO conversations (id, owner_id, agent_id, title) VALUES ($1, $2, $3, '保留的会话')`,
      [conversationId, OWNER, first.agentId],
    );
    await pool.query(
      `INSERT INTO runs (id, owner_id, agent_id, conversation_id, kind, status) VALUES ($1, $2, $3, $4, 'interactive', 'complete')`,
      [runId, OWNER, first.agentId, conversationId],
    );
    await pool.query(
      `INSERT INTO messages (id, conversation_id, owner_id, run_id, role, content, status)
       VALUES ($1, $2, $3, $4, 'user', '保留的消息', 'complete')`,
      [messageId, conversationId, OWNER, runId],
    );
    const before = await counts(pool);
    await seedCards({ databaseUrl: runtimeUrl, ownerId: OWNER });
    assert.deepEqual(await counts(pool), before);

    await pool.query("DELETE FROM follows WHERE owner_id = $1 AND agent_id = $2", [OWNER, first.agentId]);
    const unfollowed = await seedCards({ databaseUrl: runtimeUrl, ownerId: OWNER });
    assert.equal(unfollowed.followed, false);
    assert.deepEqual(await counts(pool), before);
    await pool.query(
      `INSERT INTO follows (owner_id, agent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [OWNER, first.agentId],
    );

    const followersCard = randomUUID();
    const followersArtifact = randomUUID();
    const privateBot = randomUUID();
    const privateCard = randomUUID();
    const privateArtifact = randomUUID();
    await insertCard(pool, {
      cardId: followersCard,
      artifactId: followersArtifact,
      agentId: first.agentId,
      title: "仅关注可见",
      visibility: "followers",
      publishedAt: "2026-11-21T09:00:00.000Z",
    });
    await pool.query(
      `INSERT INTO agents (id, owner_id, slug, persona, model, display_name, visibility)
       VALUES ($1, $2, 'other', 'other', 'model', 'Other', 'private')`,
      [privateBot, OWNER],
    );
    await insertCard(pool, {
      cardId: privateCard,
      artifactId: privateArtifact,
      agentId: privateBot,
      title: "私有 bot 的公开卡",
      visibility: "public",
      publishedAt: "2026-11-21T10:00:00.000Z",
    });
    for (const [id, title, published] of [
      [randomUUID(), "更早的一", "2026-11-21T08:00:00.000Z"],
      [randomUUID(), "更早的二", "2026-11-21T07:00:00.000Z"],
      [randomUUID(), "更早的三", "2026-11-21T06:00:00.000Z"],
    ] as const) {
      await insertCard(pool, { cardId: id, artifactId: randomUUID(), agentId: first.agentId, title, visibility: "public", publishedAt: published });
    }

    const objectRoot = mkdtempSync(path.join(tmpdir(), "qbot-object-fixture-"));
    await placeBundles(objectRoot, manifest);
    const bundleDir = path.join(objectRoot, "qbot", "cards", INFO_ARTIFACT, "v1");
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(path.join(bundleDir, "secret.txt"), "not-a-card-file");
    writeFileSync(path.join(bundleDir, "extra.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const infoHtml = readFileSync(path.join(bundleDir, "index.html"), "utf8");
    assert.equal(infoHtml.includes("16:44"), false);
    assert.equal(infoHtml.includes("T08:44"), false);
    const runtimeEngine = stubRuntime();
    const open = await startChatServer({
      config: config(runtimeUrl, { feedOpen: true, objectRoot }),
      store: createStore(pool),
      runtime: runtimeEngine,
      pool,
    });
    const base = `http://127.0.0.1:${open.port}`;
    try {
      const feed = await readFeed(base, "following", null);
      assert.equal(JSON.stringify(feed).includes(objectRoot), false);
      assert.equal(JSON.stringify(feed).includes("secret"), false);
      assert.equal(JSON.stringify(feed).includes("qbot/cards"), false);
      assert.equal(JSON.stringify(feed).includes("persona"), false);
      assert.equal(feed.cards[0]?.bot.displayName, "Qbot");
      assert.equal(feed.cards.some((card) => card.title.includes("83")), false);
      const followed = await allCards(base, "following");
      const recommended = await allCards(base, "recommended");
      assert.deepEqual(followed.map((card) => card.id).slice(0, 2), [ENGLISH, INFO]);
      assert.equal(followed.some((card) => card.id === followersCard || card.id === privateCard), false);
      assert.equal(followed.some((card) => card.id === privateCard), false);
      assert.equal(recommended.some((card) => card.id === followersCard || card.id === privateCard), false);
      assert.deepEqual(recommended.map((card) => card.id).slice(0, 2), [ENGLISH, INFO]);
      assert.deepEqual(times(followed), [...times(followed)].sort((a, b) => b.localeCompare(a) || 0));
      assert.equal(new Set(followed.map((card) => card.id)).size, followed.length);

      const hidden = await json(base, `/v1/cards/${followersCard}/capability`, { method: "POST", body: "{}" });
      assert.equal(hidden.status, 404);
      assert.equal((await fetch(`${base}/v1/cards/${followersCard}`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 200);
      assert.equal((await fetch(`${base}/v1/cards/${privateCard}`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 404);
      const refused = await json(base, `/v1/bots/${privateBot}/follow`, { method: "POST", body: "{}" });
      assert.equal(refused.status, 404);
      const minted = await json(base, `/v1/cards/${INFO}/capability`, { method: "POST", body: "{}" });
      assert.equal(minted.status, 201);
      assert.equal(minted.headers.get("access-control-allow-origin"), null);
      const capability = await minted.json() as { token: string; artifactId: string; version: number; files: { path: string }[] };
      assert.equal(capability.artifactId, INFO_ARTIFACT);
      assert.equal(capability.version, 1);
      assert.ok(capability.files.some((file) => file.path === "brief.css"));
      const pagePath = `/v1/artifacts/${INFO_ARTIFACT}/v/1/${capability.token}/files/index.html`;
      const page = await fetch(`${base}${pagePath}`);
      const html = await page.text();
      assert.equal(page.status, 200);
      assert.match(html, /三个入口/);
      assert.match(html, /href="brief.css"/);
      assert.match(html, /项目说明/);
      assert.equal(html.includes("83 美元"), false);
      assert.equal(html.includes("<script"), false);
      assert.match(page.headers.get("content-security-policy") ?? "", /connect-src 'none'/);
      assert.equal(page.headers.get("set-cookie"), null);
      const css = await fetch(new URL("brief.css", `${base}${pagePath}`));
      assert.equal(css.status, 200);
      assert.equal(css.headers.get("content-type"), "text/css; charset=utf-8");
      const cssEtag = css.headers.get("etag");
      assert.ok(cssEtag);
      assert.match(await css.text(), /\.hero/);
      const notModified = await fetch(new URL("brief.css", `${base}${pagePath}`), {
        headers: { "If-None-Match": cssEtag },
      });
      assert.equal(notModified.status, 304);
      assert.equal(await notModified.text(), "");
      const svg = await fetch(new URL("mark.svg", `${base}${pagePath}`));
      assert.equal(svg.status, 200);
      assert.match(await svg.text(), /<svg/);

      const english = await json(base, `/v1/cards/${ENGLISH}/capability`, { method: "POST", body: "{}" });
      const englishBody = await english.json() as { token: string };
      const phrase = await (await fetch(`${base}/v1/artifacts/00000000-0000-4000-8000-0000000000d2/v/1/${englishBody.token}/files/index.html`)).text();
      assert.match(phrase, /get this over/);
      assert.equal(phrase.includes("<audio"), false);
      assert.equal(phrase.includes("样例"), false);

      assert.equal((await raw(open.port, `${pagePath.replace("index.html", "secret.txt")}`)).status, 404);
      assert.equal((await raw(open.port, `${pagePath.replace("index.html", "extra.png")}`)).status, 401);
      assert.equal((await raw(open.port, `/v1/artifacts/${INFO_ARTIFACT}/v/1/${capability.token}/files/..%2Fsecret.txt`)).status, 404);
      assert.equal((await raw(open.port, `/v1/artifacts/${INFO_ARTIFACT}/v/1/${capability.token}/files/%2e%2e/%2e%2e/secret.txt`)).status, 404);
      assert.equal((await fetch(`${base}/v1/artifacts/${INFO_ARTIFACT}/v/2/${capability.token}/files/index.html`)).status, 401);
      const crossed = await fetch(`${base}/v1/artifacts/${INFO_ARTIFACT}/v/1/${englishBody.token}/files/index.html`);
      assert.equal(crossed.status, 401);

      const hash = createHash("sha256").update(capability.token).digest();
      await pool.query("UPDATE artifact_capabilities SET expires_at = now() - interval '1 minute' WHERE token_hash = $1", [hash]);
      const expired = await fetch(`${base}${pagePath}`);
      assert.equal(expired.status, 401);
      assert.match(await expired.text(), /过期/);

      const removed = await json(base, `/v1/bots/${first.agentId}/follow`, { method: "DELETE", body: "{}" });
      assert.equal(removed.status, 200);
      assert.equal((await removed.json() as { followed: boolean }).followed, false);
      const afterUnfollow = await allCards(base, "following");
      assert.equal(afterUnfollow.some((card) => card.bot.id === first.agentId), false);
      const stillPublic = await allCards(base, "recommended");
      assert.ok(stillPublic.some((card) => card.id === ENGLISH));
      const badBody = await json(base, `/v1/bots/${first.agentId}/follow`, { method: "POST", body: JSON.stringify({ ownerId: OTHER }) });
      assert.equal(badBody.status, 400);
      const restored = await json(base, `/v1/bots/${first.agentId}/follow`, { method: "POST", body: "{}" });
      assert.equal((await restored.json() as { followed: boolean }).followed, true);
      assert.deepEqual(await counts(pool), before);

      // Old sync JSON+Base64 publish route POST /v1/cards is deleted.
      const deletedAuthed = await fetch(`${base}/v1/cards`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "旧入口已删除", files: [] }),
      });
      assert.ok([404, 405].includes(deletedAuthed.status), `unexpected status ${deletedAuthed.status}`);
      const deletedAnon = await fetch(`${base}/v1/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "旧入口已删除", files: [] }),
      });
      assert.ok([401, 404, 405].includes(deletedAnon.status), `unexpected status ${deletedAnon.status}`);

      // QBOT_FEED_OPEN=1 must NOT open /v1/card-imports* write paths without Bearer.
      const pkgV1 = buildCardPackageZip({
        cardKey: "pg-async-card",
        contentVersion: 1,
        title: "异步导入测试卡片",
        quote: "这是 Postgres 端到端异步导入验证结论",
        idempotencyKey: "pg-feed-async-card-v1",
      });
      assert.equal((await fetch(`${base}/v1/card-imports`, {
        method: "POST",
        headers: { "Content-Type": "application/zip", "Idempotency-Key": pkgV1.idempotencyKey },
        body: new Uint8Array(pkgV1.zip),
      })).status, 401);

      const readonlyFeed = await startChatServer({
        config: loadConfig({
          DATABASE_URL: runtimeUrl,
          QBOT_OWNER_ID: OWNER,
          QBOT_ACCESS_TOKEN: TOKEN,
          OPENROUTER_API_KEY: "fixture-openrouter-key-not-a-secret",
          HOST: "127.0.0.1",
          PORT: "0",
          QBOT_FIXTURE_UPSTREAM: "1",
          QBOT_FIXTURE_UPSTREAM_URL: "http://127.0.0.1:9/v1/chat/completions",
          QBOT_FEED_OPEN: "1",
          QBOT_OSS_PUBLIC: "1",
          QBOT_OSS_PUBLIC_ORIGIN: "https://cards.example.invalid",
          QBOT_IMPORT_DIR: mkdtempSync(path.join(tmpdir(), "qbot-pg-ro-imports-")),
        }),
        store: createStore(pool),
        runtime: stubRuntime(),
        pool,
      });
      try {
        const roRes = await fetch(`http://127.0.0.1:${readonlyFeed.port}/v1/card-imports`, {
          method: "POST",
          headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": pkgV1.idempotencyKey },
          body: new Uint8Array(pkgV1.zip),
        });
        assert.equal(roRes.status, 503);
        const roBody = await roRes.json() as { error?: { code?: string } };
        assert.equal(roBody.error?.code, "storage_readonly");
      } finally {
        await readonlyFeed.close();
      }

      // Async import v1 -> queued -> ready (hidden from Feed) -> publish -> visible -> capability/files -> rollback -> hidden -> v2 publish -> DELETE.
      const importedV1 = await fetch(`${base}/v1/card-imports`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": pkgV1.idempotencyKey },
        body: new Uint8Array(pkgV1.zip),
      });
      assert.equal(importedV1.status, 202, await importedV1.clone().text());
      const v1Job = await importedV1.json() as { importId: string; state: string };
      assert.equal(v1Job.state, "accepted");
      const v1Ready = await pollImportState(base, v1Job.importId, ["ready", "rejected"]);
      assert.equal(v1Ready.state, "ready", JSON.stringify(v1Ready));
      assert.equal(v1Ready.visibility, "hidden");
      assert.equal(v1Ready.publishAllowed, true);
      assert.equal(v1Ready.notification, "not-authorized");
      const importedCardId = String(v1Ready.cardId);
      assert.equal((await fetch(`${base}/v1/cards/${importedCardId}`)).status, 404, "ready import must stay hidden until publish");

      // sample=true stops at staged and publish is rejected.
      const samplePkg = buildCardPackageZip({
        cardKey: "pg-sample-card",
        contentVersion: 1,
        sample: true,
        idempotencyKey: "pg-feed-sample-v1",
      });
      const samplePost = await fetch(`${base}/v1/card-imports`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": samplePkg.idempotencyKey },
        body: new Uint8Array(samplePkg.zip),
      });
      assert.equal(samplePost.status, 202);
      const sampleId = ((await samplePost.json()) as { importId: string }).importId;
      const sampleStaged = await pollImportState(base, sampleId, ["staged", "ready", "rejected"]);
      assert.equal(sampleStaged.state, "staged");
      assert.equal(sampleStaged.publishAllowed, false);
      assert.equal((await fetch(`${base}/v1/card-imports/${sampleId}/publish`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedPreviousVersion: null }),
      })).status, 409);

      // Publish v1
      const publishedV1 = await fetch(`${base}/v1/card-imports/${v1Job.importId}/publish`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedPreviousVersion: null }),
      });
      assert.equal(publishedV1.status, 200, await publishedV1.clone().text());
      const pubV1Body = await publishedV1.json() as { state: string; visibility: string; cardId: string };
      assert.equal(pubV1Body.state, "published");
      assert.equal(pubV1Body.visibility, "public");

      const afterPublish = await readFeed(base, "following", null);
      assert.equal(afterPublish.cards[0]?.id, importedCardId);
      const dynDetailRes = await fetch(`${base}/v1/cards/${importedCardId}`);
      assert.equal(dynDetailRes.status, 200);
      const dynCard = await dynDetailRes.json() as {
        id: string;
        artifactId: string;
        coverLightPath: string | null;
        coverDarkPath: string | null;
      };
      assert.equal(dynCard.coverLightPath, "cover-light.png");
      assert.equal(dynCard.coverDarkPath, "cover-dark.png");
      const dynCap = await (await json(base, `/v1/cards/${dynCard.id}/capability`, { method: "POST", body: "{}" })).json() as { token: string };
      const dynPage = await fetch(`${base}/v1/artifacts/${dynCard.artifactId}/v/1/${dynCap.token}/files/work/index.html`);
      assert.equal(dynPage.status, 200);
      assert.match(await dynPage.text(), /异步导入验证结论/);
      const dynDarkCover = await fetch(`${base}/v1/artifacts/${dynCard.artifactId}/v/1/${dynCap.token}/files/cover-dark.png`);
      assert.equal(dynDarkCover.status, 200);
      assert.equal(dynDarkCover.headers.get("content-type"), "image/png");

      // Publish v2 then rollback to v1
      const pkgV2 = buildCardPackageZip({
        cardKey: "pg-async-card",
        contentVersion: 2,
        expectedPreviousVersion: 1,
        title: "异步导入第二版",
        quote: "这是第二版更新后的核心结论",
        idempotencyKey: "pg-feed-async-card-v2",
      });
      const postV2 = await fetch(`${base}/v1/card-imports`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/zip", "Idempotency-Key": pkgV2.idempotencyKey },
        body: new Uint8Array(pkgV2.zip),
      });
      assert.equal(postV2.status, 202);
      const v2Id = ((await postV2.json()) as { importId: string }).importId;
      assert.equal((await pollImportState(base, v2Id, ["ready", "rejected"])).state, "ready");
      const pubV2 = await fetch(`${base}/v1/card-imports/${v2Id}/publish`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedPreviousVersion: 1 }),
      });
      assert.equal(pubV2.status, 200);
      assert.equal(((await (await fetch(`${base}/v1/cards/${importedCardId}`)).json()) as { artifactVersion: number }).artifactVersion, 2);

      const rbV2 = await fetch(`${base}/v1/card-imports/${v2Id}/rollback`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal(rbV2.status, 200);
      assert.equal(((await rbV2.json()) as { state: string }).state, "rolled-back");
      assert.equal(((await (await fetch(`${base}/v1/cards/${importedCardId}`)).json()) as { artifactVersion: number }).artifactVersion, 1);

      // DELETE /v1/cards/:id still enforces Bearer and works after card-import publish/rollback.
      assert.equal((await fetch(`${base}/v1/cards/${dynCard.id}`, { method: "DELETE" })).status, 404);
      const deleted = await fetch(`${base}/v1/cards/${dynCard.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(deleted.status, 204);
      assert.equal((await fetch(`${base}/v1/cards/${dynCard.id}`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 404);
      assert.deepEqual(await applyMigrations({ runtimeUrl, directory }), []);

      const stranger = await startChatServer({
        config: config(runtimeUrl, { feedOpen: true, objectRoot, ownerId: OTHER }),
        store: createStore(pool),
        runtime: stubRuntime(),
        pool,
      });
      try {
        const empty = await readFeed(`http://127.0.0.1:${stranger.port}`, "following", null);
        assert.deepEqual(empty.cards, []);
        const strangerFollow = await json(`http://127.0.0.1:${stranger.port}`, `/v1/bots/${first.agentId}/follow`, { method: "POST", body: "{}" });
        assert.equal(strangerFollow.status, 200);
        const ownerFollow = await fetch(`${base}/v1/bots/${first.agentId}`);
        assert.equal((await ownerFollow.json() as { followed: boolean }).followed, true);
      } finally {
        await stranger.close();
      }

      const personal = await startChatServer({
        config: config(runtimeUrl, { personalOpen: true, objectRoot }),
        store: createStore(pool),
        runtime: stubRuntime(),
        pool,
      });
      try {
        assert.equal((await fetch(`http://127.0.0.1:${personal.port}/v1/session`)).status, 200);
        assert.equal((await fetch(`http://127.0.0.1:${personal.port}/v1/feed?scope=following`)).status, 401);
        const personalDeleted = await fetch(`http://127.0.0.1:${personal.port}/v1/cards`, { method: "POST" });
        assert.ok([401, 404, 405].includes(personalDeleted.status), `unexpected status ${personalDeleted.status}`);
        assert.equal((await fetch(`http://127.0.0.1:${personal.port}/v1/card-imports`, {
          method: "POST",
          headers: { "Content-Type": "application/zip", "Idempotency-Key": pkgV1.idempotencyKey },
          body: new Uint8Array(pkgV1.zip),
        })).status, 401);
        assert.equal((await fetch(`http://127.0.0.1:${personal.port}/v1/cards/${INFO}`, { method: "DELETE" })).status, 401);
      } finally {
        await personal.close();
      }
      assert.equal((await fetch(`${base}/v1/session`)).status, 401);
      assert.equal((await fetch(`${base}/v1/conversations`, { method: "POST" })).status, 401);
    } finally {
      await open.close();
      await pool.end();
    }
  } finally {
    await adminPool.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [name]);
    await adminPool.query(`DROP DATABASE IF EXISTS ${name}`);
    await adminPool.end();
  }
});

function config(runtimeUrl: string, options: { feedOpen?: boolean; personalOpen?: boolean; objectRoot: string; ownerId?: string }) {
  return loadConfig({
    DATABASE_URL: runtimeUrl,
    QBOT_OWNER_ID: options.ownerId ?? OWNER,
    QBOT_ACCESS_TOKEN: TOKEN,
    OPENROUTER_API_KEY: "fixture-openrouter-key-not-a-secret",
    HOST: "127.0.0.1",
    PORT: "0",
    QBOT_FIXTURE_UPSTREAM: "1",
    QBOT_FIXTURE_UPSTREAM_URL: "http://127.0.0.1:9/v1/chat/completions",
    QBOT_OBJECT_ROOT: options.objectRoot,
    ...(options.feedOpen ? { QBOT_FEED_OPEN: "1" } : {}),
    ...(options.personalOpen ? { QBOT_PERSONAL_OPEN: "1" } : {}),
  });
}

function stubRuntime(): ConversationEngine {
  return { engine: "dsh", id: "fixture", run() { throw new Error("unused"); }, async close() {} };
}

async function poolTimes(pool: ReturnType<typeof createPool>, agentId: string): Promise<{ publishedAt: string; authoredAt: string }[]> {
  try {
    const result = await pool.query<{ id: string; published_at: Date; authored_at: Date }>(
      "SELECT id, published_at, authored_at FROM cards WHERE agent_id = $1",
      [agentId],
    );
    return result.rows.map((row) => ({ publishedAt: row.published_at.toISOString(), authoredAt: row.authored_at.toISOString() }));
  } finally {
    await pool.end();
  }
}

async function counts(pool: ReturnType<typeof createPool>): Promise<{ conversations: number; runs: number; messages: number }> {
  const conversations = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM conversations");
  const runs = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM runs");
  const messages = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM messages");
  return { conversations: conversations.rows[0]?.n ?? 0, runs: runs.rows[0]?.n ?? 0, messages: messages.rows[0]?.n ?? 0 };
}

async function insertCard(pool: ReturnType<typeof createPool>, input: {
  cardId: string;
  artifactId: string;
  agentId: string;
  title: string;
  visibility: "public" | "followers";
  publishedAt: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO cards (id, agent_id, visibility, title, published_at, authored_at, provenance) VALUES ($1, $2, $3, $4, $5, $5, 'manual')`,
    [input.cardId, input.agentId, input.visibility, input.title, input.publishedAt],
  );
  await pool.query(
    `INSERT INTO artifacts (id, card_id, version, manifest_sha256) VALUES ($1, $2, 1, $3)`,
    [input.artifactId, input.cardId, "a".repeat(64)],
  );
  await pool.query(
    `INSERT INTO artifact_files (artifact_id, rel_path, sha256, byte_length, content_type, role)
     VALUES ($1, 'cover.png', $2, 1, 'image/png', 'cover')`,
    [input.artifactId, "b".repeat(64)],
  );
  await pool.query("UPDATE cards SET artifact_id = $2 WHERE id = $1", [input.cardId, input.artifactId]);
}

async function readFeed(base: string, scope: string, cursor: string | null): Promise<{ cards: { id: string; title: string; publishedAt: string; bot: { id: string; displayName: string } }[]; next: string | null }> {
  const url = new URL(`${base}/v1/feed`);
  url.searchParams.set("scope", scope);
  url.searchParams.set("limit", "2");
  if (cursor) url.searchParams.set("cursor", cursor);
  const response = await fetch(url);
  assert.equal(response.status, 200, await response.clone().text());
  return await response.json() as { cards: { id: string; title: string; publishedAt: string; bot: { id: string; displayName: string } }[]; next: string | null };
}

async function allCards(base: string, scope: string): Promise<{ id: string; publishedAt: string; bot: { id: string } }[]> {
  const cards: { id: string; publishedAt: string; bot: { id: string } }[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 8; page += 1) {
    const body = await readFeed(base, scope, cursor);
    cards.push(...body.cards);
    if (!body.next) return cards;
    cursor = body.next;
  }
  throw new Error("feed did not end");
}

function times(cards: { publishedAt: string }[]): string[] {
  return cards.map((card) => card.publishedAt);
}

async function json(base: string, path: string, init: RequestInit): Promise<Response> {
  return fetch(`${base}${path}`, { ...init, headers: { "Content-Type": "application/json" } });
}

function raw(port: number, requestPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: requestPath, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function pollImportState(base: string, importId: string, terminal: readonly string[]): Promise<Record<string, unknown>> {
  for (let i = 0; i < 80; i += 1) {
    const res = await fetch(`${base}/v1/card-imports/${importId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200, await res.clone().text());
    const body = await res.json() as Record<string, unknown>;
    if (terminal.includes(String(body.state))) return body;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for import ${importId}`);
}
