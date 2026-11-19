import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { pullUpdate } from "./updates.ts";

const app = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"));
const eas = JSON.parse(readFileSync(new URL("../eas.json", import.meta.url), "utf8"));
const appSrc = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

test("preview updates use the app version and the free preview channel", () => {
  assert.equal(eas.build.preview.channel, "preview");
  assert.equal(app.expo.runtimeVersion.policy, "appVersion");
  assert.equal(app.expo.updates.enabled, true);
  assert.equal(app.expo.updates.fallbackToCacheTimeout, 0);
  assert.equal(app.expo.updates.checkAutomatically, "ON_LOAD");
  assert.equal(app.expo.updates.url, "https://u.expo.dev/ef23ae82-73c0-4db5-b2d7-b2424f969697");
  assert.equal(app.expo.extra.eas.projectId, "ef23ae82-73c0-4db5-b2d7-b2424f969697");
  assert.match(appSrc, /pullUpdate/);
  assert.equal(appSrc.includes("reloadAsync"), false);
});

test("a failed or disabled check leaves the embedded bundle running", async () => {
  assert.equal(await pullUpdate({
    enabled: false,
    async check() { throw new Error("offline"); },
    async fetch() { throw new Error("offline"); },
  }), "skipped");
  assert.equal(await pullUpdate({
    enabled: true,
    async check() { throw new Error("offline"); },
    async fetch() { throw new Error("offline"); },
  }), "failed");
  assert.equal(await pullUpdate({
    enabled: true,
    async check() { return { isAvailable: false }; },
    async fetch() { throw new Error("should not fetch"); },
  }), "none");
  let fetched = false;
  assert.equal(await pullUpdate({
    enabled: true,
    async check() { return { isAvailable: true }; },
    async fetch() { fetched = true; },
  }), "fetched");
  assert.equal(fetched, true);
});
