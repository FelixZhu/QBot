import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const api = require("./shell-media.js");
const template = readFileSync(new URL("./template.html", import.meta.url), "utf8");
const feedJs = readFileSync(new URL("./feed.js", import.meta.url), "utf8");
const appJson = JSON.parse(readFileSync(new URL("../qbot-app/app.json", import.meta.url), "utf8"));
const BASE = "https://felixzhu.github.io/QBot/";

test("390 and 840 overlay geometry, and back keeps the feed card", () => {
  for (const width of [390, 840]) {
    const box = api.chromeForWidth(width);
    assert.equal(box.header, 44);
    assert.equal(box.width, width);
    if (width === 390) {
      assert.equal(box.folded, true);
      assert.equal(box.rail, 0);
      assert.equal(box.overlayLeft, 0);
      assert.equal(box.overlayWidth, 390);
    } else {
      assert.equal(box.folded, false);
      assert.equal(box.rail, 72);
      assert.equal(box.overlayLeft, 72);
      assert.equal(box.overlayWidth, 768);
    }
    const feed = { index: 2, scrollTop: width, tab: "feed" };
    let state = api.openLayer({ feed, stack: [] }, {
      type: "article",
      url: "https://example.com/story",
      chrome: box
    });
    assert.equal(state.feed.index, 2);
    assert.equal(state.feed.scrollTop, width);
    assert.equal(state.feed.tab, "feed");
    assert.equal(state.stack.length, 1);
    state = api.backLayer(state);
    assert.equal(state.handled, true);
    assert.equal(state.stack.length, 0);
    assert.equal(state.feed.index, 2);
    assert.equal(state.feed.scrollTop, width);
    assert.equal(api.backLayer(state).handled, false);
  }
  assert.equal(api.chromeForWidth(599).folded, true);
  assert.equal(api.chromeForWidth(600).folded, false);
});

test("template overlay matches the 390 / 840 shell widths", () => {
  assert.match(template, /shell-media\.js\?v=__VERSION__/);
  assert.match(template, /qbotShell&&qbotShell\.isOpen\(\)/);
  assert.match(template, /QbotShellMedia\.mount\(\{host:document\.getElementById\("qbs"\)\}\)/);
  assert.match(template, /\.qbs-overlay\{position:absolute;inset:0/);
  assert.match(template, /@media \(min-width:600px\)\{\s*\.qbs-overlay\{left:72px\}/);
  assert.match(template, /\.qbs-ov-bar\{[^}]*height:var\(--touch\)/);
  assert.equal(appJson.expo.version, "1.0.6");
  assert.equal(appJson.expo.android.versionCode, 8);
  assert.equal(api.CAPABILITIES.requiresNewApk, true);
  assert.equal(api.CAPABILITIES.apk.versionCode, 7);
});

test("integrated feed.js keeps the PR4 browser fallback and exports closeDetail", () => {
  assert.match(feedJs, /window\.open\(safe, "_blank", "noopener,noreferrer"\)/);
  assert.match(feedJs, /closeDetail: closeDetail/);
  const body = feedJs.slice(feedJs.indexOf("function closeDetail()"), feedJs.indexOf("function back()"));
  assert.equal(body.includes("shell.close"), false);
});

test("external articles are browser-first and a blank frame is not success", () => {
  assert.equal(api.ARTICLE_SANDBOX, "");
  const src = readFileSync(new URL("./shell-media.js", import.meta.url), "utf8");
  assert.match(src, /NOT proof that Android removed the Java bridge/);
  assert.equal(src.includes("allow-scripts allow-same-origin"), false);
  const page = api.articlePolicy("https://example.com/story", BASE);
  assert.equal(page.embed, false);
  assert.equal(page.mode, "browser-handoff");
  assert.equal(page.reason, "external-webview");
  assert.equal(api.windowOpenIntent("noopener,noreferrer"), "browser");
  assert.equal(api.windowOpenIntent("noopener"), "handoff");
  assert.equal(api.settleArticle({ threw: true }), "browser-handoff");
  assert.equal(api.settleArticle({ timedOut: true }), "browser-handoff");
  assert.equal(api.settleArticle({ errorEvent: true }), "browser-handoff");
  assert.equal(api.settleArticle({ href: "about:blank" }), "browser-handoff");
  assert.equal(api.settleArticle({ href: "https://example.com/" }), "browser-handoff");
  assert.equal(api.settleArticle({ href: "https://example.com/", text: "可读正文" }), "readable");
  assert.match(api.HANDOFF_COPY[1], /空白/);
});

test("safe URL protocols", () => {
  const ok = api.classifyUrl("https://ai-daily-ej4.pages.dev/archive/2026-11-17", BASE);
  assert.equal(ok.ok, true);
  assert.equal(ok.kind, "article");
  assert.equal(ok.protocol, "https:");

  const http = api.classifyUrl("http://example.com/a", BASE);
  assert.equal(http.ok, true);
  assert.equal(http.protocol, "http:");

  for (const raw of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,hi",
    "file:///etc/passwd",
    "content://media/1",
    "intent://scan/#Intent;scheme=https;end",
    "blob:https://felixzhu.github.io/uuid",
    "about:blank",
    "chrome://flags",
    "vbscript:msgbox(1)"
  ]) {
    const got = api.classifyUrl(raw, BASE);
    assert.equal(got.ok, false, raw);
    assert.equal(got.reason, "protocol", raw);
    assert.equal(got.url, undefined, raw);
  }
  assert.equal(api.classifyUrl("", BASE).reason, "empty");
  assert.equal(api.classifyUrl("http://", BASE).reason, "invalid");

  const stripped = api.classifyUrl("https://user:secret@example.com/a?x=1", BASE);
  assert.equal(stripped.ok, true);
  assert.equal(stripped.url, "https://example.com/a?x=1");
  assert.equal(stripped.url.includes("secret"), false);

  const rel = api.classifyUrl("//example.com/post", BASE);
  assert.equal(rel.ok, true);
  assert.equal(rel.url, "https://example.com/post");
});

test("video URLs stay inline files; streams are not pretended to play", () => {
  assert.equal(api.classifyUrl("https://cdn.example.com/a.mp4", BASE).kind, "video");
  assert.equal(api.classifyUrl("https://cdn.example.com/a.MP4?v=2", BASE).kind, "video");
  assert.equal(api.classifyUrl("https://cdn.example.com/a.webm#t=1", BASE).kind, "video");
  assert.equal(api.classifyUrl("https://cdn.example.com/a.m4v", BASE).kind, "video");
  assert.equal(api.classifyUrl("https://cdn.example.com/watch?file=a.mp4", BASE).kind, "article");
  assert.equal(api.classifyUrl("https://cdn.example.com/live.m3u8", BASE).kind, "unsupported-media");
  assert.equal(api.classifyUrl("https://cdn.example.com/live.mpd", BASE).kind, "unsupported-media");
  assert.equal(api.classifyUrl("https://cdn.example.com/clip.mkv", BASE).kind, "unsupported-media");
  assert.equal(api.isShellPage("https://felixzhu.github.io/QBot/"), true);
  assert.equal(api.isShellPage("https://felixzhu.github.io/QBot/index.html"), true);
  assert.equal(api.isShellPage("https://felixzhu.github.io/QBot/#/docs/a"), true);
  assert.equal(api.isShellPage("https://felixzhu.github.io/qian-drive/"), false);
  assert.equal(api.isShellPage("https://example.com/"), false);
});

test("embedding verdict: explicit failure only when the frame itself says so", () => {
  assert.equal(api.frameVerdict({ href: "about:blank" }), "denied");
  assert.equal(api.frameVerdict({ href: "" }), "denied");
  assert.equal(api.frameVerdict({ href: null }), "denied");
  assert.equal(api.frameVerdict({ href: "chrome-error://chromewebdata/" }), "denied");
  assert.equal(api.frameVerdict({ threw: true }), "opaque");
  assert.equal(api.frameVerdict({ href: "https://example.com/" }), "shown");
  assert.equal(api.frameVerdict({ errorEvent: true, threw: true }), "failed");
  assert.equal(api.frameVerdict({ timedOut: true, href: "https://example.com/" }), "failed");
  assert.equal(api.frameVerdict({}), "denied");
});

test("video pauses when leaving the card, the tab, or the page", () => {
  assert.deepEqual(api.pauseTargets({ type: "tab", tab: "chat" }).sort(), ["feed", "kb"]);
  assert.deepEqual(api.pauseTargets({ type: "tab", tab: "feed" }), ["kb"]);
  assert.deepEqual(api.pauseTargets({ type: "tab", tab: "kb" }), ["feed"]);
  assert.deepEqual(api.pauseTargets({ type: "visibility", hidden: true }), ["all"]);
  assert.deepEqual(api.pauseTargets({ type: "visibility", hidden: false }), []);
  assert.deepEqual(api.pauseTargets({ type: "overlay" }), ["feed"]);
  assert.deepEqual(api.pauseTargets({ type: "card", ratio: 0.2 }), ["element"]);
  assert.deepEqual(api.pauseTargets({ type: "card", ratio: 0.5 }), []);
  assert.deepEqual(api.pauseTargets({ type: "card", ratio: 1 }), []);
});

test("unsized feed video is rescued; a real 9:16 slot is not", () => {
  assert.equal(api.needsPlayerRescue({ width: 300, height: 150 }), true);
  assert.equal(api.needsPlayerRescue({ width: 0, height: 0 }), true);
  assert.equal(api.needsPlayerRescue({ width: 200, height: 356 }), false);
  assert.equal(api.needsPlayerRescue({ width: 390, height: 220 }), false);
  assert.match(api.mediaErrorCopy(3), /HEVC/);
  assert.match(api.FAIL_COPY.denied[1], /没有改写/);
  assert.match(api.FAIL_COPY["unsupported-media"][1], /不会在这里转码|不会转码/);
});
