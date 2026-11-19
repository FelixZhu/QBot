/**
 * Real Feed and shell back paths.
 * Uses apps/drive-web/feed.js and the closeShellOverlay text in template.html.
 * The stand-in in shell-back.test.mjs is not this proof.
 *
 *   node apps/drive-web/shell-contract.test.mjs
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const feedJs = readFileSync(path.join(here, "feed.js"), "utf8");
const template = readFileSync(path.join(here, "template.html"), "utf8");

function sliceFn(src, name, next) {
  const start = src.indexOf("function " + name);
  assert.ok(start >= 0, name + " missing");
  const end = src.indexOf("\n  function " + next, start);
  assert.ok(end > start, name + " did not end before " + next);
  return src.slice(start, end);
}

const closeDetail = sliceFn(feedJs, "closeDetail()", "back()");
assert.equal(closeDetail.includes("shell.close"), false, "real closeDetail calls the shell");
assert.match(closeDetail, /state\.detail = null/);
assert.match(feedJs, /closeDetail: closeDetail/);

const overlayStart = template.indexOf("function closeShellOverlay()");
assert.ok(overlayStart >= 0);
let depth = 0;
let started = false;
let overlayEnd = -1;
for (let i = overlayStart; i < template.length; i++) {
  if (template[i] === "{") { depth++; started = true; }
  else if (template[i] === "}") {
    depth--;
    if (started && depth === 0) { overlayEnd = i + 1; break; }
  }
}
const overlay = template.slice(overlayStart, overlayEnd);
assert.match(overlay, /feed\.closeDetail\(\)/);
assert.match(overlay, /shell\.close\(\)/);
assert.equal(overlay.includes(".back("), false);
const backBranch = template.slice(template.indexOf("if(window.qbotShell&&qbotShell.isOpen())"), template.indexOf("var handled=false;"));
assert.match(backBranch, /closeShellOverlay\(\)/);
assert.equal(backBranch.includes("qbotFeed.back"), false);

const touchEnd = sliceFn(feedJs, "onTouchEnd()", "onWheel(");
assert.equal(touchEnd.includes("goTo("), false, "touchend must not page");
assert.equal(feedJs.includes("function snapToNearest"), false);
const settle = sliceFn(feedJs, "settleFromScroll()", "armSettle()");
assert.equal(settle.includes("scrollTo"), false);
assert.equal(settle.includes("scrollTop"), false);

const FEED = JSON.stringify({
  cards: [{
    id: "ext",
    bot: "Info Bot",
    type: "digest",
    time: "2026-01-05T08:24:00+08:00",
    title: "外部示例",
    summary: "",
    media: { kind: "none" },
    open_url: "https://example.com/outside",
    private: false,
    data: { date: "2026-01-05", highlights: [] }
  }]
});

const SCROLL_FEED = JSON.stringify({
  cards: [
    {
      id: "one",
      bot: "Info Bot",
      type: "digest",
      time: "2026-01-05T08:24:00+08:00",
      title: "第一张",
      summary: "",
      media: { kind: "none" },
      open_url: "",
      private: false,
      data: { date: "2026-01-05", highlights: [{ title: "甲" }] }
    },
    {
      id: "two",
      bot: "English Bot",
      type: "english",
      time: "2026-01-06T07:57:00+08:00",
      title: "第二张",
      summary: "",
      media: { kind: "video", url: "/fixtures/synthetic-lesson.mp4", width: 320, height: 180 },
      open_url: "",
      private: false,
      data: { expression: "second card", meaning: "第二张", has_video: true }
    },
    {
      id: "three",
      bot: "Study Bot",
      type: "study",
      time: "2026-01-07T10:00:00+08:00",
      title: "第三张",
      summary: "",
      media: { kind: "none" },
      open_url: "/reader.html",
      private: false,
      data: { course: "示例", day: 1, total: 3, brief: "第三张" }
    }
  ]
});

function startServer() {
  const types = { ".js": "text/javascript", ".html": "text/html", ".json": "application/json", ".css": "text/css" };
  const server = createServer((req, res) => {
    const url = req.url.split("?")[0];
    if (url === "/contract-feed.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(FEED);
      return;
    }
    if (url === "/scroll-feed.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(SCROLL_FEED);
      return;
    }
    if (url === "/reader.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><meta charset=\"utf-8\"><p>阅读回位</p>");
      return;
    }
    if (url === "/scroll.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/layout.css">
<link rel="stylesheet" href="/components.css">
<link rel="stylesheet" href="/feed.css">
<style>html,body,#root{height:100%;margin:0}</style>
<div id="root"></div>
<script src="/feed.js"></script>
<script>QbotFeed.mount(document.getElementById("root"), {feedUrl: location.origin + "/scroll-feed.json"});</script>`);
      return;
    }
    if (url === "/contract.html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!doctype html><meta charset="utf-8"><div id="root" style="height:800px"></div><script src="/feed.js"></script>`);
      return;
    }
    const file = path.join(here, decodeURIComponent(url.replace(/^\//, "")));
    if (!file.startsWith(here)) { res.writeHead(403); res.end(); return; }
    try {
      const body = readFileSync(file);
      const ext = path.extname(file);
      res.writeHead(200, { "content-type": types[ext] || "application/octet-stream" });
      res.end(body);
    } catch (e) {
      res.writeHead(404);
      res.end(String(e));
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const chromeBin = process.env.CHROME || "/usr/bin/google-chrome";
const server = await startServer();
const port = server.address().port;
const chrome = spawn(chromeBin, [
  "--headless=new",
  "--remote-debugging-port=9377",
  "--user-data-dir=/tmp/chrome-shell-contract",
  "--no-first-run",
  "--disable-gpu",
  "--autoplay-policy=no-user-gesture-required",
  urlSafe()
], { stdio: "ignore" });

function urlSafe() { return `http://127.0.0.1:${port}/contract.html`; }

let ws;
function call(method, params, ms = 15000) {
  const id = call.next = (call.next || 0) + 1;
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error("timeout " + method)), ms);
    call.pending = call.pending || new Map();
    call.pending.set(id, { res, rej, timer });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await fetch("http://127.0.0.1:9377/json/list").then((r) => r.json());
      const page = list.find((t) => t.type === "page");
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res);
          ws.addEventListener("error", rej);
        });
        ws.addEventListener("message", (msg) => {
          const m = JSON.parse(msg.data);
          if (m.id && call.pending && call.pending.has(m.id)) {
            const p = call.pending.get(m.id);
            call.pending.delete(m.id);
            clearTimeout(p.timer);
            if (m.error) p.rej(new Error(JSON.stringify(m.error)));
            else p.res(m.result);
          }
        });
        return;
      }
    } catch (e) { /* chrome not ready */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("chrome did not open");
}
async function ev(expression) {
  const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
}

try {
  await connect();
  await call("Page.navigate", { url: `http://127.0.0.1:${port}/contract.html` });
  let ready = false;
  for (let i = 0; i < 40; i++) {
    ready = await ev(`!!document.querySelector(".q-primary")`);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  // Mount after load so the spy exists before the click.
  await ev(`QbotFeed.mount(document.getElementById("root"), {feedUrl:"/contract-feed.json"})`);
  for (let i = 0; i < 40 && !await ev(`!!document.querySelector(".q-primary")`); i++) {
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.equal(await ev(`!!document.querySelector(".q-primary")`), true, "feed card did not render");

  const withShell = await ev(`(() => {
    window.__shell = [];
    window.qbotShell = {
      openArticle: function (url) { window.__shell.push(["article", String(url)]); return { ok: true }; },
      openExternal: function (url) { window.__shell.push(["external", String(url)]); return { ok: true }; },
      close: function () { window.__shell.push(["close"]); return true; },
      isOpen: function () { return true; }
    };
    document.querySelector(".q-primary").click();
    var back = window.qbotFeed.back();
    return { back: back, shell: window.__shell.slice(), detail: !!document.querySelector(".feed-detail") };
  })()`);
  assert.equal(withShell.back, true);
  assert.equal(withShell.detail, false);
  assert.deepEqual(withShell.shell, [["article", "https://example.com/outside"]]);

  const shellClose = await ev(`(() => {
    window.__shell = [];
    window.qbotShell = {
      openArticle: function (url) { window.__shell.push(["article", String(url)]); return { ok: true }; },
      close: function () { window.__shell.push(["close"]); return true; },
      isOpen: function () { return true; }
    };
    document.querySelector(".q-primary").click();
    ${overlay}
    var skipFeedHome = false;
    var result = closeShellOverlay();
    return { result: result, shell: window.__shell.slice(), detail: !!document.querySelector(".feed-detail") };
  })()`);
  assert.equal(shellClose.result, true);
  assert.equal(shellClose.detail, false);
  assert.deepEqual(shellClose.shell, [["article", "https://example.com/outside"], ["close"]]);

  const noShell = await ev(`(() => {
    delete window.qbotShell;
    document.querySelector(".q-primary").click();
    var opened = !!document.querySelector(".feed-detail");
    var back = window.qbotFeed.back();
    return { opened: opened, back: back, detail: !!document.querySelector(".feed-detail") };
  })()`);
  assert.equal(noShell.opened, true, "without a shell the page opens in the feed");
  assert.equal(noShell.back, true);
  assert.equal(noShell.detail, false);

  await call("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true
  });
  await call("Page.navigate", { url: `http://127.0.0.1:${port}/scroll.html` });
  let cardsReady = false;
  for (let i = 0; i < 40; i++) {
    cardsReady = await ev(`(() => {
      const track = document.querySelector(".q-feed");
      const cards = document.querySelectorAll(".q-fcard");
      return !!(track && track.clientHeight > 200 && cards.length === 3 && Math.abs(cards[0].offsetHeight - track.clientHeight) < 2);
    })()`);
    if (cardsReady) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.equal(cardsReady, true, "scroll fixture did not lay out one card per viewport");
  await ev(`(() => {
    const orig = Element.prototype.scrollTo;
    window.__feedScrollTo = [];
    Element.prototype.scrollTo = function (a, b) {
      if (this.classList && this.classList.contains("q-feed")) {
        const top = a && typeof a === "object" ? a.top : b;
        const behavior = a && typeof a === "object" ? (a.behavior || "auto") : "auto";
        window.__feedScrollTo.push({ top: top, behavior: behavior, from: this.scrollTop });
      }
      return orig.apply(this, arguments);
    };
    return true;
  })()`);

  async function place(i) {
    await ev(`(() => {
      const track = document.querySelector(".q-feed");
      const card = document.querySelector('.q-fcard[data-i="${i}"]');
      track.scrollTop = card.offsetTop;
      track.dispatchEvent(new Event("scrollend"));
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 160));
  }
  function touchPoint(elVar, y) {
    return `new Touch({ identifier: 1, target: ${elVar}, clientX: 40, clientY: ${y}, pageX: 40, pageY: ${y} })`;
  }

  const longDrag = await ev(`(() => new Promise((resolve) => {
    const track = document.querySelector(".q-feed");
    const before = window.__feedScrollTo.length;
    const h = track.clientHeight;
    track.scrollTop = 0;
    track.dispatchEvent(new Event("scrollend"));
    const start = ${touchPoint("track", 500)};
    track.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [start], targetTouches: [start], changedTouches: [start] }));
    track.scrollTop = Math.round(h * 0.95);
    const end = ${touchPoint("track", 40)};
    track.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [end] }));
    track.dispatchEvent(new Event("scrollend"));
    setTimeout(() => {
      const buttons = Array.prototype.slice.call(document.querySelectorAll(".feed-pager button"));
      const cur = document.querySelector('.feed-pager button[aria-current="true"]');
      resolve({
        h: h,
        top: track.scrollTop,
        index: buttons.indexOf(cur),
        added: window.__feedScrollTo.slice(before)
      });
    }, 250);
  }))()`);
  assert.deepEqual(longDrag.added, [], "long drag must not call scrollTo: " + JSON.stringify(longDrag));
  assert.ok(longDrag.top < longDrag.h * 1.5, "long drag skipped two cards: " + JSON.stringify(longDrag));
  assert.equal(longDrag.index, 1, "long drag pager: " + JSON.stringify(longDrag));
  assert.equal(longDrag.index, Math.round(longDrag.top / longDrag.h), "pager and position diverged: " + JSON.stringify(longDrag));

  const shortDrag = await ev(`(() => new Promise((resolve) => {
    const track = document.querySelector(".q-feed");
    const before = window.__feedScrollTo.length;
    const h = track.clientHeight;
    track.scrollTop = 0;
    track.dispatchEvent(new Event("scrollend"));
    const start = ${touchPoint("track", 400)};
    track.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [start], targetTouches: [start], changedTouches: [start] }));
    track.scrollTop = Math.round(h * 0.08);
    const end = ${touchPoint("track", 340)};
    track.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [end] }));
    track.dispatchEvent(new Event("scrollend"));
    setTimeout(() => {
      const buttons = Array.prototype.slice.call(document.querySelectorAll(".feed-pager button"));
      const cur = document.querySelector('.feed-pager button[aria-current="true"]');
      resolve({
        h: h,
        top: track.scrollTop,
        index: buttons.indexOf(cur),
        added: window.__feedScrollTo.slice(before)
      });
    }, 250);
  }))()`);
  assert.deepEqual(shortDrag.added, [], "short drag compensated with scrollTo: " + JSON.stringify(shortDrag));
  assert.equal(shortDrag.index, Math.round(shortDrag.top / shortDrag.h), "short drag pager: " + JSON.stringify(shortDrag));
  assert.ok(shortDrag.top < shortDrag.h * 0.5, "short drag left the first card: " + JSON.stringify(shortDrag));

  await place(0);
  const wheel = await ev(`(() => new Promise((resolve) => {
    const track = document.querySelector(".q-feed");
    const before = window.__feedScrollTo.length;
    track.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }));
    const started = Date.now();
    (function wait() {
      const buttons = Array.prototype.slice.call(document.querySelectorAll(".feed-pager button"));
      const cur = document.querySelector('.feed-pager button[aria-current="true"]');
      const card = document.querySelector('.q-fcard[data-i="1"]');
      const index = buttons.indexOf(cur);
      if (index === 1 && card && Math.abs(track.scrollTop - card.offsetTop) < 3) {
        resolve({ index: index, added: window.__feedScrollTo.slice(before) });
        return;
      }
      if (Date.now() - started > 2000) {
        resolve({ index: index, top: track.scrollTop, added: window.__feedScrollTo.slice(before), timeout: true });
        return;
      }
      setTimeout(wait, 40);
    })();
  }))()`);
  assert.equal(wheel.timeout, undefined, "wheel did not land: " + JSON.stringify(wheel));
  assert.equal(wheel.added.length, 1, "wheel scrollTo count: " + JSON.stringify(wheel));
  assert.equal(wheel.added[0].behavior, "smooth");

  await place(2);
  const saved = await ev(`(() => {
    const track = document.querySelector(".q-feed");
    return {
      top: track.scrollTop,
      label: document.querySelector('.feed-pager button[aria-current="true"]').getAttribute("aria-label")
    };
  })()`);
  await ev(`document.querySelector('.q-fcard[data-i="2"] .q-primary').click()`);
  let reader = false;
  for (let i = 0; i < 30; i++) {
    reader = await ev(`!!(document.querySelector(".feed-reader") && document.querySelector(".feed-reader").innerText.includes("阅读回位"))`);
    if (reader) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(reader, true, "study page did not open");
  const restored = await ev(`(() => {
    const back = window.qbotFeed.back();
    const track = document.querySelector(".q-feed");
    return {
      back: back,
      top: track.scrollTop,
      label: document.querySelector('.feed-pager button[aria-current="true"]').getAttribute("aria-label"),
      detail: !!document.querySelector(".feed-detail")
    };
  })()`);
  assert.equal(restored.back, true);
  assert.equal(restored.detail, false);
  assert.equal(restored.label, saved.label);
  assert.ok(Math.abs(restored.top - saved.top) < 2, JSON.stringify({ saved, restored }));

  await place(1);
  await ev(`document.querySelector('.q-fcard[data-i="1"] .q-video-play').click()`);
  let playing = false;
  for (let i = 0; i < 30; i++) {
    playing = await ev(`(() => { const v = document.querySelector('.q-fcard[data-i="1"] video'); return !!(v && !v.paused); })()`);
    if (playing) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(playing, true, "video did not start");
  const pausedByCard = await ev(`(() => new Promise((resolve) => {
    const track = document.querySelector(".q-feed");
    const h = track.clientHeight;
    const start = ${touchPoint("track", 500)};
    track.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [start], targetTouches: [start], changedTouches: [start] }));
    track.scrollTop = h * 2;
    const end = ${touchPoint("track", 40)};
    track.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [end] }));
    track.dispatchEvent(new Event("scrollend"));
    setTimeout(() => {
      const buttons = Array.prototype.slice.call(document.querySelectorAll(".feed-pager button"));
      const cur = document.querySelector('.feed-pager button[aria-current="true"]');
      const v = document.querySelector('.q-fcard[data-i="1"] video');
      resolve({ index: buttons.indexOf(cur), paused: !v || v.paused });
    }, 200);
  }))()`);
  assert.equal(pausedByCard.index, 2, JSON.stringify(pausedByCard));
  assert.equal(pausedByCard.paused, true, JSON.stringify(pausedByCard));

  await place(1);
  await ev(`document.querySelector('.q-fcard[data-i="1"] .q-video-play').click()`);
  let playingAgain = false;
  for (let i = 0; i < 30; i++) {
    playingAgain = await ev(`(() => { const v = document.querySelector('.q-fcard[data-i="1"] video'); return !!(v && !v.paused); })()`);
    if (playingAgain) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(playingAgain, true, "video did not restart");
  await ev(`window.dispatchEvent(new CustomEvent("qbot:tab", { detail: { tab: "kb" } }))`);
  assert.equal(await ev(`document.querySelector('.q-fcard[data-i="1"] video').paused`), true, "leaving the tab did not pause");

  console.log("shell contract passed");
} finally {
  try { chrome.kill(); } catch (e) {}
  server.close();
}
