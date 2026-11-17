/* Evidence only. Measures Feed identity after return-to-chat and re-entry.
 * Does not change product code. Every phase is asserted. No GAP status.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync, mkdirSync } from "node:fs";

const url = process.argv[2];
const frameDir = process.argv[3] || "/tmp/evidence-v4-frames";
mkdirSync(frameDir, { recursive: true });
if (!url) {
  console.error("usage: node measure-reentry.mjs <url> <frame-dir>");
  process.exit(2);
}

const passed = [];
const failed = [];
const untested = [
  "Android WebView was not run",
  "The installed APK was not run",
  "A physical system back gesture was not run"
];
const samples = [];

function check(name, ok, detail) {
  const row = { name, ok: !!ok, detail: detail === undefined ? null : detail };
  (ok ? passed : failed).push(row);
  console.log((ok ? "PASS " : "FAIL ") + name);
  console.log(JSON.stringify(detail));
}

const chrome = spawn("/usr/local/bin/google-chrome", [
  "--headless=new",
  "--remote-debugging-port=9341",
  "--user-data-dir=/tmp/chrome-evidence-v4",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-translate",
  "--disable-features=Translate,TranslateUI",
  "--autoplay-policy=no-user-gesture-required",
  "--window-size=900,1000",
  "about:blank"
], { stdio: "ignore" });

let seq = 0;
const pending = new Map();
let ws;

function call(method, params, ms = 15000) {
  const id = ++seq;
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { pending.delete(id); rej(new Error("timeout " + method)); }, ms);
    pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
async function ev(expr) {
  const r = await call("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result.value;
}
async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await fetch("http://127.0.0.1:9341/json/list").then((r) => r.json());
      const page = list.find((t) => t.type === "page");
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res);
          ws.addEventListener("error", rej);
        });
        ws.addEventListener("message", (msg) => {
          const m = JSON.parse(msg.data);
          if (m.id && pending.has(m.id)) {
            const p = pending.get(m.id);
            pending.delete(m.id);
            m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
          }
        });
        return;
      }
    } catch { /* starting */ }
    await sleep(150);
  }
  throw new Error("chrome did not open a page");
}
async function click(sel) {
  const box = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`);
  if (!box || box.w < 1 || box.h < 1) throw new Error("no box " + sel + " " + JSON.stringify(box));
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
}
async function browserBack() {
  const hist = await call("Page.getNavigationHistory");
  const prev = hist.entries[hist.currentIndex - 1];
  if (!prev) throw new Error("no history entry");
  await call("Page.navigateToHistoryEntry", { entryId: prev.id });
}
async function shot(name) {
  const png = await call("Page.captureScreenshot", { format: "png" });
  writeFileSync(frameDir + "/" + name + ".png", Buffer.from(png.data, "base64"));
}
const measureExpr = `(() => {
  const track = document.querySelector(".feed-stage .q-feed");
  const tr = track ? track.getBoundingClientRect() : null;
  const cards = track ? Array.from(track.querySelectorAll(".q-fcard")) : [];
  let occupying = null;
  const cardRects = cards.map((c, i) => {
    const r = c.getBoundingClientRect();
    const overlap = tr ? Math.max(0, Math.min(r.bottom, tr.bottom) - Math.max(r.top, tr.top)) : 0;
    const frac = tr && tr.height ? Math.round((overlap / tr.height) * 1000) / 1000 : 0;
    const row = {
      i: Number(c.dataset.i),
      frac,
      relTop: tr ? Math.round(r.top - tr.top) : null,
      width: Math.round(r.width),
      height: Math.round(r.height),
      offsetTop: c.offsetTop,
      title: (c.innerText || "").trim().split("\\n")[0].slice(0, 40)
    };
    if (!occupying || frac > occupying.frac) occupying = row;
    return row;
  });
  const pager = document.querySelector('.feed-pager button[aria-current="true"]');
  const active = document.querySelector(".feed-list .q-row.active");
  const panel = document.getElementById("panel-feed");
  const v = document.querySelector(".q-fcard video");
  return {
    tab: window.qbotCurrentTab ? qbotCurrentTab() : "",
    overlay: !!(window.qbotShell && qbotShell.isOpen()),
    vw: innerWidth,
    vh: innerHeight,
    panelHidden: panel ? panel.hidden : null,
    scrollTop: track ? Math.round(track.scrollTop) : null,
    trackH: track ? track.clientHeight : null,
    trackW: track ? track.clientWidth : null,
    occupying,
    parked: cardRects.find((c) => c.i === 1) || null,
    pager: pager ? pager.getAttribute("aria-label") : null,
    activeRow: active ? Number(active.dataset.i) : null,
    hist: history.state,
    href: location.href,
    videoT: v ? Math.round(v.currentTime * 100) / 100 : null,
    videoPaused: v ? v.paused : null,
    closeDetail: window.qbotFeed ? typeof qbotFeed.closeDetail : "missing"
  };
})()`;
async function measure(phase) {
  const row = await ev(measureExpr);
  row.phase = phase;
  return row;
}
function sameIdentity(a, b) {
  if (!a || !b || !a.occupying || !b.occupying || !a.parked || !b.parked) return { ok: false, reason: "missing geometry" };
  const scrollOk = Math.abs(a.scrollTop - b.scrollTop) <= 2;
  const indexOk = a.occupying.i === b.occupying.i;
  const rectOk = Math.abs(a.parked.relTop - b.parked.relTop) <= 2
    && Math.abs(a.parked.height - b.parked.height) <= 2
    && Math.abs(a.parked.width - b.parked.width) <= 2;
  const viewOk = a.vw === b.vw && a.vh === b.vh;
  return { ok: scrollOk && indexOk && rectOk && viewOk, scrollOk, indexOk, rectOk, viewOk };
}
async function ready() {
  for (let i = 0; i < 50; i++) {
    const ok = await ev(`!!(document.querySelectorAll(".q-fcard").length >= 3 && document.querySelector("#chat-root") && document.querySelector("#chat-root").children.length)`);
    if (ok) return;
    await sleep(200);
  }
  throw new Error("preview not ready");
}
async function boot(width, height) {
  await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await call("Page.navigate", { url: url + "?e=" + Date.now() + "-" + width });
  await ready();
  await ev(`['qd2_theme','qbot-feed-snoozed','qbot-feed-muted-types'].forEach(function (k) { localStorage.removeItem(k); }); sessionStorage.removeItem('qbs_tab');`);
  await call("Page.reload", { ignoreCache: true });
  await ready();
  await sleep(250);
}
async function openCard(i) {
  await click('button[data-qbs-tab="feed"]');
  await sleep(350);
  const row = `.q-row[data-i="${i}"]`;
  const wide = await ev(`(() => { const el = document.querySelector(${JSON.stringify(row)}); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; })()`);
  if (wide) await click(row);
  else await click(`.feed-pager button[aria-label="第 ${i + 1} 张"]`);
  await sleep(450);
}
async function openArticle() {
  await ev(`(() => { const b = Array.from(document.querySelectorAll(".q-primary")).find((n) => n.textContent.indexOf("打开日报") >= 0); if (!b) throw new Error("no article button"); b.click(); })()`);
  await sleep(300);
}
async function watchScroll(ms) {
  const start = await ev(`performance.now()`);
  const rows = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    rows.push(await measure("poll"));
    await sleep(40);
  }
  return { start, rows: rows.map((r) => ({ top: r.scrollTop, h: r.trackH, i: r.occupying && r.occupying.i, tab: r.tab, hidden: r.panelHidden })) };
}
async function reenter() {
  await click('button[data-qbs-tab="feed"]');
  await sleep(50);
  const visible = await measure("reenter-visible");
  await sleep(800);
  const settled = await measure("reenter-settled");
  return { visible, settled };
}
function assertBack(tag, before, phase, row) {
  const cmp = sameIdentity(before, row);
  check(tag + " " + phase + " keeps card, scrollTop, card rect, and viewport", cmp.ok, { cmp, before: brief(before), row: brief(row) });
}
function brief(r) {
  return {
    tab: r.tab, overlay: r.overlay, hidden: r.panelHidden, vw: r.vw, vh: r.vh,
    scrollTop: r.scrollTop, trackH: r.trackH, trackW: r.trackW,
    occupying: r.occupying, parked: r.parked, pager: r.pager, activeRow: r.activeRow, hist: r.hist
  };
}

try {
  await connect();
  await call("Page.enable");
  await call("Page.navigate", { url });
  await ready();
  const loaded = await ev(`Promise.all(["feed.js","feed.css","kb.js","kb.css","shell-media.js"].map(async (p) => {
    const buf = await fetch(p, { cache: "no-store" }).then((r) => r.arrayBuffer());
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return { p, n: bytes.length, b64: btoa(bin) };
  }))`);
  const { createHash } = await import("node:crypto");
  const hashes = {};
  for (const file of loaded) {
    hashes[file.p] = createHash("sha256").update(Buffer.from(file.b64, "base64")).digest("hex");
  }
  check("loaded feed.js sha256 is the frozen closeDetail delta", hashes["feed.js"] === "88aec121ce786d0275207eb421bb78c3972f89a42813e9674d021183ff5ba571", hashes);
  const feedHas = await ev(`fetch("feed.js", { cache: "no-store" }).then((r) => r.text()).then((t) => ({ exported: t.indexOf("closeDetail: closeDetail") >= 0, shellClose: t.slice(t.indexOf("function closeDetail()"), t.indexOf("function back()")).indexOf("shell.close") >= 0 }))`);
  check("loaded feed.js exports closeDetail and does not call shell.close", feedHas.exported === true && feedHas.shellClose === false, feedHas);

  for (const width of [390, 840]) {
    const height = width === 390 ? 844 : 900;
    const tag = String(width);
    await boot(width, height);
    await openCard(1);
    const videoBefore = await measure("video-before");
    await click(".q-video-play");
    await sleep(700);
    const playing = await measure("video-playing");
    check(tag + " sample video is visibly advancing", playing.videoT > 0.2 && playing.videoPaused === false, { t: playing.videoT, paused: playing.videoPaused });
    await shot(tag + "-video-playing");
    await openCard(2);
    await sleep(300);
    const paused = await measure("video-left");
    check(tag + " changing card pauses the sample video", paused.videoPaused === true && paused.occupying && paused.occupying.i === 2, brief(paused));
    await shot(tag + "-video-paused-card3");

    const paths = [
      ["overlay-button", async () => { await click('#qbsOverlay [data-act="back"]'); await sleep(250); }],
      ["shell-back", async () => { await ev("window.qbotBack()"); await sleep(250); }],
      ["browser-history", async () => { await browserBack(); await sleep(300); }],
      ["repeated-open-close", async () => {
        await click('#qbsOverlay [data-act="back"]');
        await sleep(200);
        await openArticle();
        await click('#qbsOverlay [data-act="back"]');
        await sleep(200);
      }]
    ];
    for (const [name, close] of paths) {
      const id = tag + "-" + name;
      await boot(width, height);
      await openCard(1);
      await sleep(200);
      const before = await measure("before-overlay");
      check(id + " viewport is the emulated size before the overlay", before.vw === width && before.vh === height && before.occupying && before.occupying.i === 1, brief(before));
      await openArticle();
      const opened = await measure("overlay-open");
      check(id + " overlay opens on the same card and scroll", opened.overlay === true && sameIdentity(before, opened).scrollOk && sameIdentity(before, opened).indexOk, { before: brief(before), opened: brief(opened) });
      await close();
      const closed = await measure("overlay-closed");
      assertBack(id, before, "overlay closed", closed);
      await shot(id + "-closed");
      const toChat = name === "browser-history" ? browserBack : () => ev("window.qbotBack()");
      const pollPromise = watchScroll(900);
      await sleep(40);
      await toChat();
      const polled = await pollPromise;
      const hidden = await measure("chat-hidden");
      samples.push({ id, polled, hidden: brief(hidden) });
      check(id + " chat-hidden scrollTop stays on the same card", hidden.tab === "chat" && hidden.scrollTop === before.scrollTop && hidden.occupying && hidden.occupying.i === before.occupying.i, { before: brief(before), hidden: brief(hidden), poll: polled.rows.filter((r, i, a) => i === 0 || r.top !== a[i - 1].top || r.h !== a[i - 1].h) });
      await shot(id + "-chat");
      const back = await reenter();
      assertBack(id, before, "re-enter visible", back.visible);
      assertBack(id, before, "re-enter settled", back.settled);
      check(id + " re-enter shows the feed tab", back.visible.tab === "feed" && back.visible.panelHidden === false && back.settled.panelHidden === false, { visible: brief(back.visible), settled: brief(back.settled) });
      await shot(id + "-reenter");
    }
  }
} catch (err) {
  check("measurement threw", false, String(err && err.stack || err));
}

const summary = { passed: passed.length, failed: failed.length, untested, failedNames: failed.map((f) => f.name) };
console.log("RESULTS " + JSON.stringify(summary));
try { ws && ws.close(); } catch { /* gone */ }
chrome.kill("SIGKILL");
process.exit(failed.length ? 1 : 0);
