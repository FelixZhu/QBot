import assert from "node:assert/strict";
import { test } from "node:test";
import { filterDemos, localReply } from "./demos.ts";
import { ASK_BACK, showWebTab, themeBoot, themeUpdate } from "./embed.ts";
import { isSplit, resolveScheme } from "./theme.ts";

test("system theme defaults to light unless the scheme is dark", () => {
  assert.equal(resolveScheme("light"), "light");
  assert.equal(resolveScheme(null), "light");
  assert.equal(resolveScheme(undefined), "light");
  assert.equal(resolveScheme("dark"), "dark");
});

test("wide layout splits at the same 600px fold as the web shell", () => {
  assert.equal(isSplit(599), false);
  assert.equal(isSplit(600), true);
});

test("demo replies stay local and labeled", () => {
  assert.match(localReply("info", "一句话"), /没有接通 Info Bot/);
  assert.match(localReply("english", "Send me the file"), /更礼貌/);
  assert.match(localReply("study", "差别"), /概念示例/);
  assert.equal(filterDemos("english").length, 1);
  assert.equal(filterDemos("").length, 3);
});

test("host theme boot paints light explicitly", () => {
  const light = themeBoot(false);
  assert.match(light, /__QBOT_HOST_DARK = false/);
  assert.match(light, /color-scheme/);
  assert.match(light, /prefers-color-scheme/);
  assert.match(themeUpdate(true), /__QBOT_HOST_DARK = true/);
  assert.match(themeUpdate(true), /QbotShellTheme\.apply/);
});

test("embedded web tab hides the page tab bar and does not keep a foreign tab switch", () => {
  const feed = showWebTab("feed");
  assert.match(feed, /#qbsNav\{display:none/);
  assert.match(feed, /qbotTab\("feed"\)/);
  assert.match(feed, /before !== after/);
  assert.match(ASK_BACK, /type: "back"/);
});
