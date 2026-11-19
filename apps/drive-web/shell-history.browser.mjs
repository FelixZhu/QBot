/* Browser regression for article back, history, and video.
 * Run: node shell-history.browser.mjs http://127.0.0.1:PORT/index.html
 * Every check is pass or fail. A failure exits non-zero. There is no GAP status.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const url = process.argv[2];
if (!url) {
  console.error("usage: node shell-history.browser.mjs <preview-url>");
  process.exit(2);
}

const passed = [];
const failed = [];
const untested = [
  "Android WebView and the installed APK were not run",
  "A physical system back gesture was not run; browser history and window.qbotBack were"
];

function check(name, ok, detail) {
  const row = { name, ok: !!ok, detail: detail === undefined ? null : detail };
  (ok ? passed : failed).push(row);
  console.log((ok ? "PASS " : "FAIL ") + name + (detail === undefined ? "" : " " + JSON.stringify(detail)));
}

const chrome = spawn("/usr/local/bin/google-chrome", [
  "--headless=new",
  "--remote-debugging-port=9333",
  "--user-data-dir=/tmp/chrome-history-qa",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-translate",
  "--disable-features=Translate,TranslateUI",
  "--autoplay-policy=no-user-gesture-required",
  "--window-size=390,844",
  "about:blank"
], { stdio: "ignore" });

function die(err) {
  console.error(err);
  chrome.kill("SIGKILL");
  process.exit(1);
}

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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
}

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await fetch("http://127.0.0.1:9333/json/list").then((r) => r.json());
      const page = list.find((t) => t.type === "page");
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res);
          ws.addEventListener("error", rej);
        });
        ws.addEventListener("message", (evn) => {
          const m = JSON.parse(evn.data);
          if (m.id && pending.has(m.id)) {
            const p = pending.get(m.id);
            pending.delete(m.id);
            m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
          }
        });
        return;
      }
    } catch { /* chrome still starting */ }
    await sleep(150);
  }
  throw new Error("chrome did not open a page");
}

async function click(sel) {
  const box = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({block:"nearest", inline:"nearest"}); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`);
  if (!box || box.w < 1 || box.h < 1) throw new Error("no box " + sel);
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
}

async function browserBack() {
  const hist = await call("Page.getNavigationHistory");
  const prev = hist.entries[hist.currentIndex - 1];
  if (!prev) throw new Error("no history entry to go back to");
  await call("Page.navigateToHistoryEntry", { entryId: prev.id });
}

function snapExpr() {
  return `(() => {
    const track = document.querySelector(".feed-stage .q-feed");
    const b = document.querySelector('.feed-pager button[aria-current="true"]');
    const row = document.querySelector(".feed-list .q-row.active");
    const v = document.querySelector(".q-fcard video");
    const ov = document.querySelector("#qbsOverlay");
    return {
      tab: window.qbotCurrentTab ? qbotCurrentTab() : "",
      label: b ? b.getAttribute("aria-label") : (row ? row.textContent.trim().slice(0, 40) : ""),
      top: track ? Math.round(track.scrollTop) : null,
      index: window.qbotFeed && qbotFeed.index,
      overlay: !!(window.qbotShell && qbotShell.isOpen()),
      hidden: ov ? ov.hidden : null,
      hist: history.state,
      closeDetail: window.qbotFeed ? typeof qbotFeed.closeDetail : "missing",
      t: v ? Math.round((v.currentTime || 0) * 100) / 100 : null,
      paused: v ? v.paused : null,
      iframe: Array.from(document.querySelectorAll("iframe")).map((f) => f.src).filter(Boolean)
    };
  })()`;
}

async function snap() { return ev(snapExpr()); }

async function ready() {
  for (let i = 0; i < 50; i++) {
    const ok = await ev(`!!(document.querySelector('#qbsNav [data-qbs-tab="kb"]') && !document.querySelector('#qbsAppearanceBtn') && document.querySelectorAll('.q-fcard').length >= 3 && document.querySelector('#chat-root') && document.querySelector('#chat-root').children.length)`);
    if (ok) return;
    await sleep(200);
  }
  throw new Error("preview not ready");
}

async function boot(width, height) {
  await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await call("Page.navigate", { url });
  await ready();
  await ev(`['qd2_theme','qd2_preview_marker','qbot-feed-snoozed','qbot-feed-muted-types'].forEach(function (k) { localStorage.removeItem(k); }); sessionStorage.removeItem('qbs_tab');`);
  await call("Page.reload", { ignoreCache: true });
  await ready();
  await sleep(300);
}

async function openFeedCard(i) {
  await click('button[data-qbs-tab="feed"]');
  await sleep(400);
  const row = `.q-row[data-i="${i}"]`;
  const box = await ev(`(() => { const el = document.querySelector(${JSON.stringify(row)}); if (!el) return null; const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; })()`);
  if (box && box.w > 1 && box.h > 1) await click(row);
  else await click(`.feed-pager button[aria-label="第 ${i + 1} 张"]`);
  await sleep(500);
}

async function openArticle() {
  await ev(`(() => { const buttons = Array.from(document.querySelectorAll(".q-primary")); const b = buttons.find((n) => n.textContent.indexOf("打开日报") >= 0); if (!b) throw new Error("no article button"); b.click(); })()`);
  await sleep(400);
}

try {
  await connect();
  await call("Page.enable");
  for (const width of [390, 840]) {
    const height = width === 390 ? 844 : 900;
    const tag = String(width);
    await boot(width, height);
    const fresh = await snap();
    check(tag + " fresh tab is chat and closeDetail is exported", fresh.tab === "chat" && fresh.closeDetail === "function", fresh);

    await openFeedCard(1);
    await sleep(200);
    const beforePlay = await snap();
    await click(".q-video-play");
    await sleep(700);
    const playing = await snap();
    check(tag + " sample video currentTime advances", playing.t > 0.2 && playing.paused === false, { before: beforePlay.t, playing });
    await openFeedCard(2);
    await sleep(300);
    const left = await snap();
    check(tag + " leaving the video card pauses it", left.paused === true && left.label.indexOf("第 3") >= 0, left);
    await openFeedCard(1);
    await sleep(250);
    const parked = await snap();
    check(tag + " parked on the video card before the article", parked.top > 0 && parked.overlay === false, parked);

    await openArticle();
    const opened = await snap();
    check(tag + " article overlay opens on the same card", opened.overlay === true && opened.top === parked.top && opened.iframe.length === 0, { parked, opened });
    check(tag + " opening the article pushes an overlay history entry", opened.hist && opened.hist.qbot === "overlay", opened.hist);
    check(tag + " opening the article pauses the card video", opened.paused === true, opened);

    await click('#qbsOverlay [data-act="back"]');
    await sleep(350);
    const closed = await snap();
    check(tag + " overlay close button closes the article and keeps card and scroll", closed.overlay === false && closed.tab === "feed" && closed.top === parked.top, { parked, closed });
    check(tag + " overlay close leaves history on the feed tab", closed.hist && closed.hist.qbot === "tab" && closed.hist.tab === "feed", closed.hist);
    await ev("window.qbotBack()");
    await sleep(350);
    const afterClose = await snap();
    check(tag + " the back after the close button returns to chat without a third press", afterClose.tab === "chat" && afterClose.overlay === false, afterClose);

    await boot(width, height);
    await openFeedCard(1);
    await sleep(200);
    const parkedShell = await snap();
    await openArticle();
    await sleep(200);
    await ev("window.qbotBack()");
    await sleep(350);
    const shellClosed = await snap();
    check(tag + " shell back closes the article and keeps card and scroll", shellClosed.overlay === false && shellClosed.top === parkedShell.top && shellClosed.tab === "feed", { parked: parkedShell, shellClosed });
    await ev("window.qbotBack()");
    await sleep(350);
    const shellChat = await snap();
    check(tag + " the second shell back returns to chat", shellChat.tab === "chat" && shellChat.overlay === false, shellChat);

    await boot(width, height);
    await openFeedCard(1);
    await sleep(200);
    const parkedHist = await snap();
    await openArticle();
    await sleep(200);
    try {
      await browserBack();
      await sleep(400);
      const histClosed = await snap();
      check(tag + " browser history back closes the overlay and keeps card and scroll", histClosed.overlay === false && histClosed.top === parkedHist.top && histClosed.tab === "feed", { parked: parkedHist, histClosed });
      check(tag + " browser history back drops the overlay entry", !histClosed.hist || histClosed.hist.qbot !== "overlay", histClosed.hist);
      await browserBack();
      await sleep(400);
      const histChat = await snap();
      check(tag + " second browser back returns to chat", histChat.tab === "chat" && histChat.overlay === false, histChat);
      check(tag + " second browser back keeps history on chat", histChat.hist && histChat.hist.tab === "chat", histChat.hist);
    } catch (err) {
      check(tag + " browser history back stays inside the app", false, String(err && err.message || err));
    }

    await boot(width, height);
    await openFeedCard(1);
    await sleep(200);
    const again = await snap();
    await openArticle();
    await click('#qbsOverlay [data-act="back"]');
    await sleep(250);
    await openArticle();
    await click('#qbsOverlay [data-act="back"]');
    await sleep(250);
    const repeated = await snap();
    check(tag + " repeated open and close keeps the same card and scroll", repeated.overlay === false && repeated.tab === "feed" && repeated.top === again.top, { again, repeated });
    await ev("window.qbotBack()");
    await sleep(350);
    const second = await snap();
    check(tag + " repeated close then one back returns to chat", second.tab === "chat" && second.overlay === false, second);
  }
} catch (err) {
  check("browser run threw", false, String(err && err.stack || err));
}

const summary = { passed: passed.length, failed: failed.length, untested, failedItems: failed };
console.log("RESULTS " + JSON.stringify(summary));
try { ws && ws.close(); } catch { /* already gone */ }
chrome.kill("SIGKILL");
process.exit(failed.length ? 1 : 0);
