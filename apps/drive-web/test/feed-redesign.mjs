/**
 * Feed redesign checks. Serves the module and a public synthetic fixture, then
 * drives headless Chrome. Run from the repo root:
 *   node apps/drive-web/test/feed-redesign.mjs
 *
 * The study lesson file (~36MB) is not in this repo. The playable clip is the
 * generated fixtures/synthetic-lesson.mp4 (320x180). A second origin replies
 * with X-Frame-Options: DENY and no CORS headers.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, execSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const REPO = path.resolve(ROOT, "../..");
let pr3Shell = "";
try {
  execSync("git fetch --depth 1 origin 80509c02b8a871b3d830e58ba9fb565deb8ca2ba", { cwd: REPO, stdio: "ignore" });
  execSync("git worktree remove --force /tmp/pr3-shell", { cwd: REPO, stdio: "ignore" });
} catch (e) { /* fetch or a missing worktree */ }
try {
  execSync("git worktree add --detach /tmp/pr3-shell 80509c02b8a871b3d830e58ba9fb565deb8ca2ba", { cwd: REPO, stdio: "pipe" });
  pr3Shell = "/tmp/pr3-shell/apps/drive-web/shell-media.js";
  if (!fs.existsSync(pr3Shell)) pr3Shell = "";
} catch (e) {
  console.log("pr3 worktree not available: " + (e.stderr ? e.stderr.toString() : e.message));
  pr3Shell = "";
}
const SHOTS = "/tmp/feed-shots";
const ARTIFACTS = "/opt/cursor/artifacts";
fs.mkdirSync(SHOTS, { recursive: true });

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".wav": "audio/wav",
  ".png": "image/png"
};

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const blockedHtml = Buffer.from(
  "<!doctype html><meta charset=utf-8><h1>SHOULD-NOT-SHOW</h1><p>blocked body text</p>"
);

let blockedHits = 0;
const blockedServer = await listen((req, res) => {
  const pathName = new URL(req.url, "http://127.0.0.1").pathname;
  if (pathName === "/__hits") {
    res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
    res.end(String(blockedHits));
    return;
  }
  if (pathName === "/__reset") {
    blockedHits = 0;
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("0");
    return;
  }
  blockedHits += 1;
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'none'",
    "Content-Length": String(blockedHtml.length),
    "Cache-Control": "no-store"
  });
  res.end(blockedHtml);
});
const blockedPort = blockedServer.address().port;
const blockedURL = `http://127.0.0.1:${blockedPort}/blocked`;

const site = await listen((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/vendor/shell-media.js") {
    if (!pr3Shell) { res.writeHead(404); res.end("no pr3 shell"); return; }
    const body = fs.readFileSync(pr3Shell);
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    res.end(body);
    return;
  }
  if (url.pathname === "/unsafe-feed.json") {
    const body = Buffer.from(JSON.stringify({
      generated_at: "2026-01-09T08:00:00+08:00",
      cards: [
        {
          id: "bad-script", bot: "Info Bot", type: "digest",
          time: "2026-01-05T08:24:00+08:00", title: "坏地址",
          media: { kind: "none" }, open_url: "javascript:alert(1)", private: false,
          data: { highlights: [{ title: "不会执行" }] }
        },
        {
          id: "bad-user", bot: "Info Bot", type: "digest",
          time: "2026-01-05T09:00:00+08:00", title: "带口令的地址",
          media: { kind: "none" }, open_url: "https://user:pass@example.com/a", private: false,
          data: { highlights: [{ title: "不会打开" }] }
        }
      ]
    }));
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(body);
    return;
  }
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";
  if (pathname.includes("..")) { res.writeHead(400); res.end(); return; }
  const file = path.join(ROOT, pathname);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  if (pathname === "/fixtures/feed.json") {
    const feed = JSON.parse(fs.readFileSync(file, "utf8"));
    const card = feed.cards.find((c) => c.id === "study-omitted");
    card.open_url = blockedURL;
    const body = Buffer.from(JSON.stringify(feed));
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(body);
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    const headers = {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "Accept-Ranges": "bytes"
    };
    res.writeHead(200, headers);
    res.end(data);
  });
});
const sitePort = site.address().port;
const origin = `http://127.0.0.1:${sitePort}`;

const chromeDir = "/tmp/chrome-feed-redesign";
fs.rmSync(chromeDir, { recursive: true, force: true });
const chrome = spawn("google-chrome", [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--autoplay-policy=no-user-gesture-required",
  "--remote-debugging-port=9334",
  `--user-data-dir=${chromeDir}`,
  "about:blank"
], { stdio: "ignore" });

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let version;
for (let i = 0; i < 40; i++) {
  try {
    version = await (await fetch("http://127.0.0.1:9334/json/version")).json();
    break;
  } catch (e) {
    await sleep(150);
  }
}
if (!version) throw new Error("Chrome did not open a debugging port");

const ws = new WebSocket(version.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
    else p.resolve(msg.result);
  }
});
function send(method, params = {}, sessionId) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    ws.send(JSON.stringify(payload));
  });
}
await new Promise((r) => ws.addEventListener("open", r));
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const cdp = (method, params = {}) => send(method, params, sessionId);

const failures = [];
function check(name, cond, detail) {
  if (cond) console.log("ok  " + name);
  else {
    const line = "FAIL " + name + (detail ? " — " + detail : "");
    console.error(line);
    failures.push(line);
  }
}

async function ev(expression) {
  const result = await cdp("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text + " " + (result.exceptionDetails.exception && result.exceptionDetails.exception.description || ""));
  }
  return result.result.value;
}

async function waitFor(expression, ms = 5000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < ms) {
    last = await ev(expression);
    if (last) return last;
    await sleep(40);
  }
  throw new Error("timed out: " + expression + " last=" + JSON.stringify(last));
}

async function shot(name) {
  const { data } = await cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(data, "base64"));
}

async function setViewport(width, height) {
  await cdp("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1, mobile: width < 600
  });
  await ev("window.dispatchEvent(new Event('resize'))");
  await sleep(80);
}

try {
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__iframeSrc = [];
    var desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src");
    Object.defineProperty(HTMLIFrameElement.prototype, "src", {
      configurable: true,
      enumerable: desc.enumerable,
      get: function () { return desc.get.call(this); },
      set: function (v) { window.__iframeSrc.push(String(v)); return desc.set.call(this, v); }
    });
  ` });
  await setViewport(390, 844);
  await cdp("Page.navigate", { url: origin + "/fixtures/harness.html" });
  await waitFor("document.querySelector('.feed-brand') && document.querySelector('.feed-brand').textContent.includes('Info Bot')");
  await ev(`(() => {
    window.__opened = [];
    window.open = function (url, target, features) {
      window.__opened.push({ url: String(url), target: target, features: features });
      return { closed: false };
    };
    document.documentElement.setAttribute("data-theme", "light");
    return true;
  })()`);

  const header = await ev(`(() => {
    const bar = document.querySelector(".feed-root > .feed-top");
    const r = bar.getBoundingClientRect();
    const card = document.querySelector('.q-fcard[data-i="0"]');
    const stage = card.querySelector(".q-stage");
    const cs = getComputedStyle(card);
    const ss = getComputedStyle(stage);
    const bs = getComputedStyle(bar);
    return {
      h: Math.round(r.height),
      bars: document.querySelectorAll(".feed-root > .feed-top").length,
      who: document.querySelectorAll(".q-who").length,
      kind: document.querySelectorAll(".q-kind").length,
      titles: card.querySelectorAll("h2").length,
      brand: bar.querySelector(".feed-brand").textContent,
      time: bar.querySelector(".feed-time").textContent,
      padL: cs.paddingLeft,
      padR: cs.paddingRight,
      justify: ss.justifyContent,
      bg: bs.backgroundColor,
      cardHasTime: card.textContent.includes("08:24"),
      cardHasBadge: card.textContent.includes("AI 日报"),
      scroller: document.querySelector(".q-feed").classList.contains("scroller"),
      listHeaders: document.querySelectorAll(".feed-list .qb-topbar, .feed-list header").length
    };
  })()`);
  check("390 light bar is 44px", header.h === 44, JSON.stringify(header));
  check("one top bar", header.bars === 1, String(header.bars));
  check("no card avatar row or type badge", header.who === 0 && header.kind === 0);
  check("digest title once", header.titles === 1);
  check("brand is 主动服务 · bot", header.brand === "主动服务 · Info Bot", header.brand);
  check("short time on the right", header.time === "1月5日 08:24", header.time);
  check("time and type are not repeated on the card", !header.cardHasTime && !header.cardHasBadge);
  check("body padding 20px and top aligned", header.padL === "20px" && header.padR === "20px" && header.justify === "flex-start", JSON.stringify(header));
  check("light bar uses surface token", header.bg === "rgb(250, 248, 243)", header.bg);
  check("scroller class kept", header.scroller);
  const shell390 = await ev(`(() => {
    const tab = document.querySelector(".fix-tabs").getBoundingClientRect();
    return {
      label: document.querySelector(".fix-app").getAttribute("data-fixture"),
      note: document.querySelector(".fix-kicker").textContent,
      tabH: Math.round(tab.height),
      view: window.innerWidth + "x" + window.innerHeight
    };
  })()`);
  check("390 view is the full fixture page", shell390.view === "390x844" && shell390.tabH === 56, JSON.stringify(shell390));
  check("fixture is labeled and is not the installed shell", /测试夹具/.test(shell390.label) && /测试夹具/.test(shell390.note));
  await shot("feed_390_light_header.png");

  await ev(`document.documentElement.setAttribute("data-theme","dark")`);
  await sleep(30);
  const darkBg = await ev(`getComputedStyle(document.querySelector(".feed-root > .feed-top")).backgroundColor`);
  const darkH = await ev(`Math.round(document.querySelector(".feed-root > .feed-top").getBoundingClientRect().height)`);
  check("390 dark bar is 44px", darkH === 44, String(darkH));
  check("dark bar uses dark surface", darkBg === "rgb(31, 29, 26)", darkBg);
  await shot("feed_390_dark_header.png");
  await ev(`document.documentElement.setAttribute("data-theme","light")`);

  await setViewport(840, 900);
  await ev(`document.documentElement.setAttribute("data-theme","light")`);
  await sleep(60);
  const wide = await ev(`(() => {
    const bar = document.querySelector(".feed-root > .feed-top");
    const list = document.querySelector(".feed-list");
    return {
      h: Math.round(bar.getBoundingClientRect().height),
      bars: document.querySelectorAll(".feed-root > .feed-top").length,
      list: getComputedStyle(list).display,
      listBar: document.querySelectorAll(".feed-list .qb-topbar, .feed-list header").length,
      padL: getComputedStyle(document.querySelector(".q-fcard")).paddingLeft,
      justify: getComputedStyle(document.querySelector(".q-stage")).justifyContent,
      brand: bar.querySelector(".feed-brand").textContent
    };
  })()`);
  check("840 light still one 44px bar", wide.h === 44 && wide.bars === 1 && wide.listBar === 0, JSON.stringify(wide));
  check("840 shows the directory", wide.list === "flex", wide.list);
  check("840 body still 20px and top aligned", wide.padL === "20px" && wide.justify === "flex-start");
  const shell840 = await ev(`(() => {
    const rail = document.querySelector(".fix-rail").getBoundingClientRect();
    return { rail: Math.round(rail.width), view: window.innerWidth + "x" + window.innerHeight, tabs: getComputedStyle(document.querySelector(".fix-tabs")).display };
  })()`);
  check("840 view is the full fixture with a 72px rail", shell840.view === "840x900" && shell840.rail === 72 && shell840.tabs === "none", JSON.stringify(shell840));
  await shot("feed_840_light_header.png");
  await ev(`document.querySelector('.feed-list .q-row[data-i="1"]').click()`);
  await waitFor(`document.querySelector(".feed-brand").textContent.includes("English Bot")`);
  const synced = await ev(`document.querySelector('.feed-list .q-row[data-i="1"]').classList.contains("active")`);
  check("directory click syncs the bar and the row", synced === true);
  await waitFor(`(() => {
    const track = document.querySelector(".q-feed");
    const card = document.querySelector('.q-fcard[data-i="1"]');
    return card && Math.abs(track.scrollTop - card.offsetTop) < 3;
  })()`);
  await ev(`document.documentElement.setAttribute("data-theme","dark")`);
  await sleep(30);
  const wideDark = await ev(`(() => {
    const bar = document.querySelector(".feed-root > .feed-top");
    return {
      h: Math.round(bar.getBoundingClientRect().height),
      bg: getComputedStyle(bar).backgroundColor,
      bars: document.querySelectorAll(".feed-root > .feed-top").length
    };
  })()`);
  check("840 dark still one 44px bar", wideDark.h === 44 && wideDark.bars === 1 && wideDark.bg === "rgb(31, 29, 26)", JSON.stringify(wideDark));
  await shot("feed_840_dark_header.png");

  await ev(`document.documentElement.setAttribute("data-theme","light")`);
  await setViewport(390, 844);
  await ev(`(() => {
    const seen = [];
    const orig = EventTarget.prototype.addEventListener;
    if (!window.__touchSpy) {
      EventTarget.prototype.addEventListener = function (type, fn, opt) {
        if (type === "touchstart" || type === "touchend" || type === "touchcancel") {
          seen.push(type + ":" + !!(opt && opt.passive));
        }
        return orig.apply(this, arguments);
      };
      window.__touchSpy = seen;
    }
    localStorage.clear();
    QbotFeed.mount(document.getElementById("tab-feed"), { feedUrl: "feed.json" });
    return true;
  })()`);
  await waitFor(`document.querySelector(".feed-brand") && document.querySelector(".feed-brand").textContent.includes("Info Bot")`);
  const passive = await ev(`window.__touchSpy.join(",")`);
  check("vertical touch listeners are passive", /touchstart:true/.test(passive) && /touchend:true/.test(passive) && /touchcancel:true/.test(passive), passive);

  async function go(i) {
    await ev(`document.querySelector('.feed-pager button[aria-label="第 ${i + 1} 张"]').click()`);
    await waitFor(`(() => {
      const track = document.querySelector(".q-feed");
      const card = document.querySelector('.q-fcard[data-i="${i}"]');
      const current = document.querySelector('.feed-pager button[aria-current="true"]');
      return card && current && current.getAttribute("aria-label") === "第 ${i + 1} 张" && Math.abs(track.scrollTop - card.offsetTop) < 3;
    })()`);
    await sleep(520);
  }

  await go(2);
  await waitFor(`(() => {
    const v = document.querySelector('.q-fcard[data-i="2"] video');
    return v && v.videoWidth === 320 && v.videoHeight === 180;
  })()`);
  const ratio = await ev(`(() => {
    const v = document.querySelector('.q-fcard[data-i="2"] video');
    const r = v.getBoundingClientRect();
    return { w: r.width, h: r.height, ratio: r.width / r.height, aspect: v.style.aspectRatio };
  })()`);
  check("video uses the file aspect ratio", ratio.ratio > 1.4 && ratio.ratio < 2.1, JSON.stringify(ratio));
  check("aspect ratio is not the old 9:16 frame", !/9\s*\/\s*16/.test(ratio.aspect), ratio.aspect);

  await ev(`document.querySelector('.q-fcard[data-i="2"] .q-video-play').click()`);
  await waitFor(`(() => { const v = document.querySelector('.q-fcard[data-i="2"] video'); return v && !v.paused; })()`);
  check("point to play starts the video", true);
  const playingLabel = await ev(`document.querySelector('.q-fcard[data-i="2"] .q-video-pp').getAttribute("aria-label")`);
  check("pause control is shown while playing", playingLabel === "暂停", playingLabel);
  await shot("feed_video_playing.png");
  await ev(`document.querySelector('.q-fcard[data-i="2"] .q-video-pp').click()`);
  await waitFor(`document.querySelector('.q-fcard[data-i="2"] video').paused === true`);
  check("pause control pauses the video", true);

  const fsBox = await ev(`(() => {
    const btn = document.querySelector('.q-fcard[data-i="2"] .q-video-fs');
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: btn.getAttribute("aria-label"), enabled: document.fullscreenEnabled };
  })()`);
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: fsBox.x, y: fsBox.y, button: "left", clickCount: 1 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: fsBox.x, y: fsBox.y, button: "left", clickCount: 1 });
  await sleep(250);
  const fsAfter = await ev(`({ el: document.fullscreenElement && document.fullscreenElement.className, toast: (document.querySelector(".feed-toast") || {}).textContent || "" })`);
  check("fullscreen control exists", fsBox.label === "全屏");
  check("fullscreen enters from the control", !!fsAfter.el, JSON.stringify({ fsBox, fsAfter }));
  if (fsAfter.el) {
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(200);
  }
  if (fsAfter.el) {
    await ev(`document.exitFullscreen && document.exitFullscreen()`);
    await sleep(100);
  }

  await ev(`document.querySelector('.q-fcard[data-i="2"] .q-video-play').click()`);
  await waitFor(`document.querySelector('.q-fcard[data-i="2"] video').paused === false`);
  await ev(`window.dispatchEvent(new CustomEvent("qbot:tab", { detail: { tab: "kb" } }))`);
  await sleep(30);
  check("leaving the tab pauses video", await ev(`document.querySelector('.q-fcard[data-i="2"] video').paused === true`));

  await ev(`document.querySelector('.q-fcard[data-i="2"] .q-video-play').click()`);
  await waitFor(`document.querySelector('.q-fcard[data-i="2"] video').paused === false`);
  await ev(`window.dispatchEvent(new CustomEvent("qbot:appstate", { detail: { state: "background" } }))`);
  await sleep(30);
  check("background appstate pauses video", await ev(`document.querySelector('.q-fcard[data-i="2"] video').paused === true`));

  await ev(`document.querySelector('.q-fcard[data-i="2"] .q-video-play').click()`);
  await waitFor(`document.querySelector('.q-fcard[data-i="2"] video').paused === false`);
  await ev(`window.dispatchEvent(new Event("pagehide"))`);
  await sleep(30);
  check("pagehide pauses video", await ev(`document.querySelector('.q-fcard[data-i="2"] video').paused === true`));

  await go(3);
  const omitted = await ev(`(() => {
    const card = document.querySelector('.q-fcard[data-i="3"]');
    return {
      text: card.innerText,
      videos: card.querySelectorAll("video").length,
      src: card.querySelector("video") && card.querySelector("video").getAttribute("src")
    };
  })()`);
  check("omitted lesson shows an unavailable message and no invented url",
    omitted.videos === 0 && /还没有放进这条卡片/.test(omitted.text) && !/oss|day-?0?3|aliyuncs/i.test(omitted.text),
    omitted.text.slice(0, 180));
  await shot("feed_video_unavailable.png");

  await go(4);
  await waitFor(`document.querySelector('.q-fcard[data-i="4"]').innerText.includes("视频暂时打不开")`);
  const missing = await ev(`document.querySelectorAll('.q-fcard[data-i="4"] video[src]').length`);
  check("a missing video file becomes an error instead of a blank player", missing === 0);

  const beforeOpen = await ev(`(() => {
    const track = document.querySelector(".q-feed");
    return { index: 2, top: track.scrollTop };
  })()`);
  await go(2);
  const saved = await ev(`(() => {
    const track = document.querySelector(".q-feed");
    const current = document.querySelector('.feed-pager button[aria-current="true"]').getAttribute("aria-label");
    return { top: track.scrollTop, current: current, brand: document.querySelector(".feed-brand").textContent };
  })()`);
  await ev(`document.querySelector('.q-fcard[data-i="2"] .q-primary').click()`);
  await waitFor(`document.querySelector(".feed-reader") && document.querySelector(".feed-reader").innerText.includes("示例页面")`);
  const reader = await ev(`(() => {
    const text = document.querySelector(".feed-reader").innerText;
    const frames = document.querySelectorAll(".feed-frame").length;
    return { text: text, frames: frames, opened: window.__opened.length, detailBars: document.querySelectorAll(".feed-detail > .feed-top").length };
  })()`);
  check("same-origin page is readable inside the app", /示例页面/.test(reader.text) && /合成阅读页/.test(reader.text), reader.text);
  check("readable page is not a blank iframe", reader.frames === 0);
  check("opening the reader does not leave the app", reader.opened === 0);
  const detailH = await ev(`Math.round(document.querySelector(".feed-detail > .feed-top").getBoundingClientRect().height)`);
  check("reader bar is 44px", detailH === 44, String(detailH));
  await shot("feed_webpage_reader.png");
  const handled = await ev(`window.qbotFeed.back()`);
  const restored = await ev(`(() => {
    const track = document.querySelector(".q-feed");
    const current = document.querySelector('.feed-pager button[aria-current="true"]').getAttribute("aria-label");
    return {
      top: track.scrollTop,
      current: current,
      brand: document.querySelector(".feed-brand").textContent,
      detail: !!document.querySelector(".feed-detail")
    };
  })()`);
  check("back() closes the reader first", handled === true && restored.detail === false);
  check("closing the reader restores the card and scroll",
    restored.current === saved.current && restored.brand === saved.brand && Math.abs(restored.top - saved.top) < 2,
    JSON.stringify({ saved, restored, beforeOpen }));

  await fetch(`http://127.0.0.1:${blockedPort}/__reset`);
  await go(3);
  const savedExternal = await ev(`(() => {
    const track = document.querySelector(".q-feed");
    return { top: track.scrollTop, current: document.querySelector('.feed-pager button[aria-current="true"]').getAttribute("aria-label") };
  })()`);
  const openedBefore = await ev(`window.__opened.length`);
  await ev(`delete window.qbotShell`);
  await ev(`document.querySelector('.q-fcard[data-i="3"] .q-primary').click()`);
  await waitFor(`document.querySelector(".feed-fallback") && !document.querySelector(".feed-fallback").hidden && document.querySelector(".feed-fallback").innerText.includes("不会嵌进")`);
  const blockedHits = Number(await (await fetch(`http://127.0.0.1:${blockedPort}/__hits`)).text());
  const blocked = await ev(`(() => {
    const body = document.body.innerText;
    return {
      text: document.querySelector(".feed-fallback").innerText,
      iframes: document.querySelectorAll("iframe").length,
      srcs: window.__iframeSrc.slice(),
      leaked: body.includes("SHOULD-NOT-SHOW"),
      opened: window.__opened.length
    };
  })()`);
  check("external page shows an explanation and is not rendered in the app", /不会嵌进/.test(blocked.text) && /不加载外部/.test(blocked.text), blocked.text);
  check("no external iframe was created or navigated", blocked.iframes === 0 && blocked.srcs.length === 0 && blocked.leaked === false && blockedHits === 0, JSON.stringify({ blocked, blockedHits }));
  check("opening an external page does not leave the app by itself", blocked.opened === openedBefore);
  await shot("feed_webpage_blocked.png");
  await ev(`document.querySelector(".feed-fallback .feed-browser").click()`);
  const opened = await ev(`window.__opened[window.__opened.length - 1]`);
  check("browser fallback uses noopener,noreferrer", opened && opened.url === blockedURL && opened.features === "noopener,noreferrer", JSON.stringify(opened));
  const externalBack = await ev(`window.qbotFeed.back()`);
  const externalRestored = await ev(`(() => {
    const track = document.querySelector(".q-feed");
    return {
      top: track.scrollTop,
      current: document.querySelector('.feed-pager button[aria-current="true"]').getAttribute("aria-label"),
      detail: !!document.querySelector(".feed-detail")
    };
  })()`);
  check("back from the external explanation restores the card", externalBack === true && externalRestored.detail === false && externalRestored.current === savedExternal.current && Math.abs(externalRestored.top - savedExternal.top) < 2, JSON.stringify({ savedExternal, externalRestored }));

  await ev(`(() => {
    window.__shell = [];
    window.__opened = [];
    window.qbotShell = {
      openArticle: function (url) { window.__shell.push(["article", String(url)]); return { ok: true, mode: "browser-handoff" }; },
      openExternal: function (url) { window.__shell.push(["external", String(url)]); return { ok: true }; },
      close: function () { window.__shell.push(["close"]); return true; },
      isOpen: function () { return true; }
    };
    return true;
  })()`);
  await fetch(`http://127.0.0.1:${blockedPort}/__reset`);
  await ev(`document.querySelector('.q-fcard[data-i="3"] .q-primary').click()`);
  const withShell = await ev(`({
    shell: window.__shell.slice(),
    opened: window.__opened.slice(),
    iframes: document.querySelectorAll("iframe").length,
    srcs: window.__iframeSrc.slice(),
    detail: !!document.querySelector(".feed-detail")
  })`);
  const shellHits = Number(await (await fetch(`http://127.0.0.1:${blockedPort}/__hits`)).text());
  check("qbotShell.openArticle shows the explanation without an iframe", JSON.stringify(withShell.shell) === JSON.stringify([["article", blockedURL]]) && withShell.opened.length === 0 && withShell.iframes === 0 && withShell.srcs.length === 0 && withShell.detail === false && shellHits === 0, JSON.stringify({ withShell, shellHits }));
  const shellBack = await ev(`window.qbotFeed.back()`);
  const shellClosed = await ev(`({
    last: window.__shell[window.__shell.length - 1],
    current: document.querySelector('.feed-pager button[aria-current="true"]').getAttribute("aria-label"),
    detail: !!document.querySelector(".feed-detail")
  })`);
  check("back() closes qbotShell and stays on the card", shellBack === true && JSON.stringify(shellClosed.last) === '["close"]' && shellClosed.current === "第 4 张" && shellClosed.detail === false, JSON.stringify({ shellBack, shellClosed }));
  await ev(`(() => { window.__shell = []; window.__opened = []; return true; })()`);
  await ev(`document.querySelector('.q-fcard[data-i="2"] .q-primary').click()`);
  await waitFor(`document.querySelector(".feed-reader") && document.querySelector(".feed-reader").innerText.includes("示例页面")`);
  await ev(`document.querySelector(".feed-detail .feed-browser").click()`);
  const externalApi = await ev(`({ shell: window.__shell.slice(), opened: window.__opened.slice() })`);
  check("explicit browser action uses qbotShell.openExternal when it exists", JSON.stringify(externalApi.shell) === JSON.stringify([["external", origin + "/fixtures/page.html"]]) && externalApi.opened.length === 0, JSON.stringify(externalApi));
  await ev(`window.qbotFeed.back()`);
  await ev(`delete window.qbotShell`);

  await ev(`(() => {
    window.__kb = [];
    window.qbotKb = { open: function (key) { window.__kb.push(["open", key, true]); return true; } };
    window.qbotTab = function (tab) { window.__kb.push(["tab", tab]); };
    return true;
  })()`);
  await ev(`document.querySelector('.file-row').click()`);
  let kb = await ev(`window.__kb`);
  check("file row calls qbotKb.open(key) and does not also switch tabs", JSON.stringify(kb) === JSON.stringify([["open", "samples/note.md", true]]), JSON.stringify(kb));
  await ev(`(() => {
    window.__kb = [];
    window.qbotKb.open = function (key) { window.__kb.push(["open", key, false]); return false; };
    return true;
  })()`);
  await ev(`document.querySelectorAll(".file-row")[1].click()`);
  kb = await ev(`window.__kb`);
  check("file row falls back to qbotTab('kb') when open returns false", JSON.stringify(kb) === JSON.stringify([["open", "samples/picture.png", false], ["tab", "kb"]]), JSON.stringify(kb));

  await go(1);
  await waitFor(`document.querySelector(".q-tm") && !document.querySelector(".q-tm").textContent.includes("--")`);
  const seekBox = await ev(`(() => {
    const track = document.querySelector('.q-fcard[data-i="1"] .q-track');
    const r = track.getBoundingClientRect();
    return { x: r.x + r.width * 0.5, y: r.y + r.height / 2, w: r.width };
  })()`);
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: seekBox.x, y: seekBox.y, button: "left", clickCount: 1 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: seekBox.x, y: seekBox.y, button: "left", clickCount: 1 });
  await sleep(700);
  const seek = await ev(`(() => {
    const track = document.querySelector('.q-fcard[data-i="1"] .q-track');
    return {
      fill: track.querySelector(".rail i").style.width,
      current: document.querySelector('.feed-pager button[aria-current="true"]').getAttribute("aria-label")
    };
  })()`);
  check("seeking the audio track does not flip the card", seek.current === "第 2 张" && parseFloat(seek.fill) > 20, JSON.stringify(seek));

  const flick = await ev(`(() => new Promise((resolve) => {
    function swipe(selector, dy, ms) {
      const el = document.querySelector(selector);
      const y0 = 220;
      const mk = (y) => new Touch({ identifier: 1, target: el, clientX: 40, clientY: y, pageX: 40, pageY: y });
      const start = mk(y0);
      el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [start], targetTouches: [start], changedTouches: [start] }));
      return new Promise((done) => setTimeout(() => {
        const end = mk(y0 + dy);
        el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [end] }));
        setTimeout(() => done(document.querySelector('.feed-pager button[aria-current="true"]').getAttribute("aria-label")), 80);
      }, ms));
    }
    const h = document.querySelector(".q-feed").clientHeight;
    (async () => {
      const small = await swipe('.q-fcard[data-i="1"] .q-tm', -24, 450);
      const fast = await swipe('.q-fcard[data-i="1"] .q-tm', -80, 0);
      document.querySelector('.feed-pager button[aria-label="第 2 张"]').click();
      await new Promise((r) => setTimeout(r, 700));
      const onTrack = await swipe('.q-fcard[data-i="1"] .q-track', -220, 0);
      document.querySelector('.feed-pager button[aria-label="第 1 张"]').click();
      await new Promise((r) => setTimeout(r, 700));
      const slowBig = await swipe('.q-fcard[data-i="0"] h2', -Math.round(h * 0.2), 600);
      resolve({ h: h, small: small, fast: fast, onTrack: onTrack, slowBig: slowBig });
    })();
  }))()`);
  check("a short slow swipe on the time text does not flip", flick.small === "第 2 张", JSON.stringify(flick));
  check("a touchend flick without native scrolling does not page", flick.fast === "第 2 张", JSON.stringify(flick));
  check("a swipe on the progress track does not flip", flick.onTrack === "第 2 张", JSON.stringify(flick));
  check("a slow touchend past 15% without native scrolling does not page", flick.slowBig === "第 1 张", JSON.stringify(flick));

  await go(2);
  await ev(`document.querySelector('.feed-root > .feed-top .qb-iconbtn').click()`);
  const menuOpen = await ev(`document.querySelector(".feed-root").classList.contains("is-menu") && document.querySelector(".feed-menu").innerText.includes("恢复已关闭的提醒")`);
  check("more opens a menu", menuOpen === true);
  const menuBack = await ev(`window.qbotFeed.back()`);
  const afterMenu = await ev(`({
    menu: document.querySelector(".feed-root").classList.contains("is-menu"),
    current: document.querySelector('.feed-pager button[aria-current="true"]').getAttribute("aria-label")
  })`);
  check("back() closes the menu before leaving the card", menuBack === true && afterMenu.menu === false && afterMenu.current === "第 3 张", JSON.stringify(afterMenu));
  const home = await ev(`window.qbotFeed.back()`);
  await sleep(40);
  const atHome = await ev(`document.querySelector('.feed-pager button[aria-current="true"]').getAttribute("aria-label")`);
  check("the next back() returns to the first card", home === true && atHome === "第 1 张", atHome);
  const leave = await ev(`window.qbotFeed.back()`);
  check("back() on the first card returns false for the shell", leave === false);

  await ev(`(() => {
    window.__opened = [];
    QbotFeed.mount(document.getElementById("tab-feed"), { feedUrl: "/unsafe-feed.json" });
    return true;
  })()`);
  await waitFor(`document.querySelector(".feed-brand") && document.querySelector(".feed-brand").textContent.includes("Info Bot")`);
  await ev(`document.querySelector(".q-primary").click()`);
  await waitFor(`document.body.innerText.includes("这个地址不能打开")`);
  const unsafe = await ev(`({
    opened: window.__opened.length,
    frames: document.querySelectorAll("iframe").length,
    text: document.querySelector(".feed-fallback").innerText
  })`);
  check("javascript: urls are refused", /不能打开/.test(unsafe.text) && unsafe.opened === 0 && unsafe.frames === 0, JSON.stringify(unsafe));
  await ev(`document.querySelector('.feed-pager button[aria-label="第 2 张"]').click()`);
  await sleep(600);
  await ev(`document.querySelector('.q-fcard[data-i="1"] .q-primary').click()`);
  await waitFor(`document.querySelector(".feed-detail") && document.body.innerText.includes("这个地址不能打开")`);
  const userinfo = await ev(`window.__opened.length`);
  check("urls with userinfo are refused", userinfo === 0);
  const feedSource = fs.readFileSync(path.join(ROOT, "feed.js"), "utf8");
  check("feed source never builds an iframe", !/createElement\(\s*["']iframe["']\s*\)/.test(feedSource) && !/\biframe\.src\s*=/.test(feedSource));

  if (pr3Shell) {
    await fetch(`http://127.0.0.1:${blockedPort}/__reset`);
    await setViewport(390, 844);
    await cdp("Page.navigate", { url: origin + "/fixtures/harness.html" });
    await waitFor(`document.querySelector(".feed-brand") && document.querySelector(".feed-brand").textContent.includes("Info Bot")`);
    await ev(`(() => new Promise((resolve, reject) => {
      window.__opened = [];
      window.open = function (url, target, features) {
        window.__opened.push({ url: String(url), target: target, features: features });
        return { closed: false };
      };
      var s = document.createElement("script");
      s.src = "/vendor/shell-media.js";
      s.onload = function () { resolve(true); };
      s.onerror = function () { reject(new Error("shell script")); };
      document.body.appendChild(s);
    }))()`);
    await ev(`window.QbotShellMedia.mount({ document: document, window: window, host: document.querySelector(".fix-app") })`);
    await ev(`document.querySelector('.feed-pager button[aria-label="第 4 张"]').click()`);
    await waitFor(`document.querySelector('.feed-pager button[aria-current="true"]') && document.querySelector('.feed-pager button[aria-current="true"]').getAttribute("aria-label") === "第 4 张"`);
    await sleep(600);
    const before = await ev(`window.__opened.slice()`);
    await ev(`document.querySelector('.q-fcard[data-i="3"] .q-primary').click()`);
    await waitFor(`document.querySelector("#qbsOverlay") && !document.querySelector("#qbsOverlay").hidden`);
    const jointHits = Number(await (await fetch(`http://127.0.0.1:${blockedPort}/__hits`)).text());
    const joint = await ev(`(() => {
      var frames = Array.prototype.map.call(document.querySelectorAll("iframe"), function (f) {
        return { attr: f.getAttribute("src"), prop: f.src || "" };
      });
      return {
        open: window.qbotShell.isOpen(),
        text: document.querySelector("#qbsOverlay").innerText,
        frames: frames,
        srcSets: window.__iframeSrc.slice(),
        opened: window.__opened.slice()
      };
    })()`);
    const frameLeak = (joint.frames || []).some((f) => String(f.attr || "").indexOf(String(blockedPort)) >= 0 || String(f.prop || "").indexOf(String(blockedPort)) >= 0);
    const setLeak = (joint.srcSets || []).some((s) => s.indexOf(String(blockedPort)) >= 0);
    check("PR3 shell openArticle does not navigate an external iframe", joint.open === true && /在浏览器中打开/.test(joint.text) && jointHits === 0 && !frameLeak && !setLeak && joint.opened.length === before.length, JSON.stringify({ joint, jointHits, before }));
    await ev(`document.querySelector("[data-act=external], [data-act=external-fail]").click()`);
    const jointOpen = await ev(`window.__opened[window.__opened.length - 1]`);
    check("PR3 shell browser button is noopener,noreferrer", jointOpen && jointOpen.url === blockedURL && jointOpen.features === "noopener,noreferrer", JSON.stringify(jointOpen));
    await shot("feed_joint_pr3_handoff.png");
  } else {
    console.log("limit: PR3 shell was not checked in a worktree");
  }

  if (!failures.length) {
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    for (const name of fs.readdirSync(SHOTS)) {
      if (name.endsWith(".png")) fs.copyFileSync(path.join(SHOTS, name), path.join(ARTIFACTS, name));
    }
    console.log("shots " + fs.readdirSync(SHOTS).join(", "));
  }
} catch (err) {
  console.error(err);
  failures.push(String(err && err.stack || err));
} finally {
  try { ws.close(); } catch (e) {}
  chrome.kill("SIGKILL");
  site.close();
  blockedServer.close();
  try { execSync("git worktree remove --force /tmp/pr3-shell", { cwd: REPO, stdio: "ignore" }); } catch (e) {}
}

if (failures.length) {
  console.error("\\n" + failures.length + " failure(s)");
  process.exit(1);
}
console.log("all checks passed");
