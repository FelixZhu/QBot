import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { filterDemos, localReply } from "./demos.ts";
import { ASK_BACK, hostEmbedCss, showWebTab, themeBoot, themeUpdate } from "./embed.ts";
import { demoSurface } from "./feed/demo/data.ts";
import { gutterColor, isSplit, listPaneWidth, phoneFrame, resolveScheme } from "./theme.ts";

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

test("wide panes share one 38% width, clamped to 320–400", () => {
  assert.equal(listPaneWidth(600), 320);
  assert.equal(listPaneWidth(900), 342);
  assert.equal(listPaneWidth(1000), 380);
  assert.equal(listPaneWidth(1052), 400);
  assert.equal(listPaneWidth(2000), 400);
  const fitted = phoneFrame(1000, 844);
  assert.equal(fitted.width, 390);
  assert.equal(fitted.height, 844);
  const contained = phoneFrame(300, 1000);
  assert.equal(contained.width, 300);
  assert.ok(Math.abs(contained.height - (300 * 844) / 390) < 0.001);
  assert.equal(phoneFrame(0, 800).width, 0);
  assert.equal(gutterColor("#F5A623"), "#492f03");
  assert.equal(demoSurface("demo-english"), "#FF6A2B");
  assert.equal(gutterColor(demoSurface("demo-english")), "#4d1700");
  assert.equal(gutterColor(demoSurface("demo-info")), "#332b1a");
  assert.notEqual(gutterColor(demoSurface("demo-english")), gutterColor("#0B0B0F"));
  assert.equal(gutterColor("#FFFFFF"), "#262626");
  assert.equal(gutterColor("#0B0B0F"), "#20202c");
  assert.notEqual(gutterColor("#0B0B0F"), gutterColor("#FFFFFF"));
  assert.equal(gutterColor("nope"), "#262626");
  const css = hostEmbedCss();
  assert.match(css, /clamp\(320px,38%,400px\)/);
  assert.match(css, /min-width:600px/);
  assert.match(css, /\.kb-pane\{/);
  assert.match(showWebTab("kb"), /clamp\(320px,38%,400px\)/);
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const chat = readFileSync(new URL("./ChatPane.tsx", import.meta.url), "utf8");
  const feedPane = readFileSync(new URL("./feed/FeedPane.tsx", import.meta.url), "utf8");
  assert.match(app, /listPaneWidth\(width\)/);
  assert.equal(app.includes("0.42"), false);
  assert.match(feedPane, /listPaneWidth\(width\)/);
  assert.equal(feedPane.includes("0.42"), false);
  const live = readFileSync(new URL("./chat/LiveChat.tsx", import.meta.url), "utf8");
  assert.match(live, /maxWidth: READ_MAX/);
  assert.match(chat, /colors\.selected/);
  assert.match(chat, /QbotAvatar/);
  assert.match(live, />Qbot</);
  assert.equal(chat.includes("Info Bot"), false);
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
