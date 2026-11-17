/**
 * Offline behavior tests for apps/drive-web/kb.js.
 *
 * Uses the desensitized fixture in ./fixtures/kb-index.json and a local
 * Chrome. Does not read object storage, does not need credentials, and does
 * not follow file links off this machine.
 *
 *   node --test apps/drive-web/test/kb.test.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, before, after, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const driveWeb = path.resolve(here, "..");
const fixturePath = path.join(here, "fixtures", "kb-index.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const artifactDir = "/opt/cursor/artifacts";
const SPECIAL_KEY = "docs/示 例/100%完成#稿?.txt";
const SPECIAL_HREF =
  "https://files.example.test/pub/docs/%E7%A4%BA%20%E4%BE%8B/100%25%E5%AE%8C%E6%88%90%23%E7%A8%BF%3F.txt";

const HARNESS = `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/kb.css">
<style>
  html, body { height: 100%; margin: 0; background: #F3EFE7; }
  #tab-kb { height: 100%; }
</style>
</head>
<body>
<div id="tab-kb"></div>
</body>
</html>`;

function silentWav() {
  const samples = 8000;
  const dataSize = samples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(8000, 24);
  buf.writeUInt32LE(16000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

const wav = silentWav();
const state = { mode: "ok" };
let origin = "";
let server;
let chrome;
let chromeProfile;
let ws;
let seq = 0;
const pending = new Map();
const waiters = [];

function textOf(data) {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return String(data);
}

function send(method, params, sessionId, timeout = 20000) {
  const id = ++seq;
  const payload = { id, method, params: params || {} };
  if (sessionId) payload.sessionId = sessionId;
  ws.send(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("timeout " + method));
    }, timeout);
    pending.set(id, {
      resolve(value) {
        clearTimeout(timer);
        resolve(value);
      },
      reject(err) {
        clearTimeout(timer);
        reject(err);
      },
    });
  });
}

function waitEvent(method, sessionId, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const i = waiters.findIndex((w) => w.method === method && w.sessionId === sessionId && w.timer === timer);
      if (i >= 0) waiters.splice(i, 1);
      reject(new Error("timeout waiting " + method));
    }, timeout);
    waiters.push({
      method,
      sessionId,
      timer,
      resolve(params) {
        clearTimeout(timer);
        resolve(params);
      },
    });
  });
}

function onMessage(raw) {
  const msg = JSON.parse(textOf(raw));
  if (msg.id && pending.has(msg.id)) {
    const waiter = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) waiter.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    else waiter.resolve(msg.result);
    return;
  }
  if (!msg.method) return;
  const idx = waiters.findIndex((w) => w.method === msg.method && (!w.sessionId || w.sessionId === msg.sessionId));
  if (idx >= 0) {
    const waiter = waiters.splice(idx, 1)[0];
    waiter.resolve(msg.params || {});
  }
}

async function evalJson(sessionId, expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) {
    const ex = result.exceptionDetails.exception || {};
    throw new Error(ex.description || result.exceptionDetails.text || "evaluate failed");
  }
  return result.result ? result.result.value : undefined;
}

function evalAsync(sessionId, body) {
  return evalJson(sessionId, "(async () => {\n" + body + "\n})()");
}

async function loadKb(sessionId, data) {
  if (data) await evalJson(sessionId, "window.KB_INDEX = " + JSON.stringify(data) + ";");
  const source = await readFile(path.join(driveWeb, "kb.js"), "utf8");
  await evalJson(sessionId, source);
}

async function withPage(width, height, fn) {
  const created = await send("Target.createTarget", { url: "about:blank" });
  const attached = await send("Target.attachToTarget", { targetId: created.targetId, flatten: true });
  const sessionId = attached.sessionId;
  try {
    await send("Page.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 600,
      screenWidth: width,
      screenHeight: height,
    }, sessionId);
    const loaded = waitEvent("Page.loadEventFired", sessionId);
    await send("Page.navigate", { url: origin + "/harness.html" }, sessionId);
    await loaded;
    await fn(sessionId);
  } finally {
    await send("Target.closeTarget", { targetId: created.targetId }).catch(() => {});
  }
}

async function shot(sessionId, width, height, name) {
  await evalAsync(sessionId, "await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));");
  const image = await send("Page.captureScreenshot", {
    format: "png",
    clip: { x: 0, y: 0, width, height, scale: 1 },
  }, sessionId);
  const buf = Buffer.from(image.data, "base64");
  assert.equal(buf.toString("ascii", 1, 4), "PNG");
  assert.equal(buf.readUInt32BE(16), width);
  assert.ok(buf.readUInt32BE(20) === height);
  await mkdir(artifactDir, { recursive: true });
  const file = path.join(artifactDir, name);
  await writeFile(file, buf);
  return file;
}

describe("知识库行为", { concurrency: false, timeout: 120000 }, () => {
  before(async () => {
    const raw = await readFile(fixturePath, "utf8");
    for (const bad of ["AKIA", "LTAI", "BEGIN PRIVATE", "Expires=", "oss-cn-", "qian-grokbot", "Signature="]) {
      assert.equal(raw.includes(bad), false, "fixture contains " + bad);
    }
    assert.equal(
      SPECIAL_KEY.split("/").map(encodeURIComponent).join("/"),
      "docs/%E7%A4%BA%20%E4%BE%8B/100%25%E5%AE%8C%E6%88%90%23%E7%A8%BF%3F.txt"
    );

    server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, "http://127.0.0.1");
        if (url.pathname === "/harness.html") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          res.end(HARNESS);
          return;
        }
        if (url.pathname === "/kb.js" || url.pathname === "/kb.css" || url.pathname === "/tokens.css") {
          const type = url.pathname.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8";
          const body = await readFile(path.join(driveWeb, url.pathname.slice(1)));
          res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
          res.end(body);
          return;
        }
        if (url.pathname === "/index.json") {
          if (state.mode === "drop") {
            req.socket.destroy();
            return;
          }
          const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
          if (state.mode === "404") {
            res.writeHead(404, headers);
            res.end("missing");
            return;
          }
          if (state.mode === "bad") {
            res.writeHead(200, headers);
            res.end("not-json");
            return;
          }
          if (state.mode === "shape") {
            res.writeHead(200, headers);
            res.end('{"count":1}');
            return;
          }
          if (state.mode === "empty") {
            res.writeHead(200, headers);
            res.end(JSON.stringify({ files: [], base: "https://files.example.test/pub", count: 0 }));
            return;
          }
          res.writeHead(200, headers);
          res.end(JSON.stringify(fixture));
          return;
        }
        if (url.pathname.startsWith("/files/")) {
          res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": wav.length, "Cache-Control": "no-store" });
          res.end(wav);
          return;
        }
        res.writeHead(url.pathname === "/favicon.ico" ? 204 : 404);
        res.end();
      } catch {
        res.writeHead(500);
        res.end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = "http://127.0.0.1:" + server.address().port;

    chromeProfile = await mkdtemp(path.join(tmpdir(), "kb-chrome-"));
    chrome = spawn("/usr/bin/google-chrome", [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--autoplay-policy=no-user-gesture-required",
      "--remote-debugging-port=0",
      "--remote-allow-origins=*",
      "--user-data-dir=" + chromeProfile,
      "about:blank",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    const wsUrl = await new Promise((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => reject(new Error("chrome devtools timeout\n" + buf.slice(-800))), 20000);
      const take = (chunk) => {
        buf += chunk.toString();
        const matched = buf.match(/DevTools listening on (ws:\/\/\S+)/);
        if (matched) {
          clearTimeout(timer);
          resolve(matched[1]);
        }
      };
      chrome.stderr.on("data", take);
      chrome.stdout.on("data", take);
      chrome.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error("chrome exited " + code + "\n" + buf.slice(-800)));
      });
    });
    ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error("devtools websocket failed")), { once: true });
    });
    ws.addEventListener("message", (ev) => onMessage(ev.data));
  });

  after(async () => {
    if (ws) try { ws.close(); } catch { /* already closed */ }
    if (chrome && !chrome.killed) chrome.kill("SIGKILL");
    if (server) await new Promise((resolve) => server.close(resolve));
    if (chromeProfile) {
      for (let i = 0; i < 5; i += 1) {
        try {
          await rm(chromeProfile, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }
  });

  test("索引失败有错误和重试，不当成空目录", async () => {
    for (const mode of ["drop", "404", "bad", "shape"]) {
      state.mode = mode;
      await withPage(390, 844, async (sessionId) => {
        const report = await evalAsync(sessionId, `
          window.__sawEmpty = false;
          const root = document.getElementById("tab-kb");
          const obs = new MutationObserver(() => {
            const t = root.textContent || "";
            if (t.includes("这个文件夹是空的") || t.includes("全部文件")) window.__sawEmpty = true;
          });
          obs.observe(root, { subtree: true, childList: true, characterData: true });
          let tabs = 0;
          window.qbotTab = () => { tabs += 1; };
        `);
        assert.equal(report, undefined);
        await loadKb(sessionId);
        const view = await evalAsync(sessionId, `
          const deadline = Date.now() + 4000;
          while (!document.querySelector("#kb-retry")) {
            if (Date.now() > deadline) throw new Error("no retry for ${mode}");
            await new Promise((r) => setTimeout(r, 20));
          }
          const root = document.getElementById("tab-kb");
          const btn = document.querySelector("#kb-retry");
          const opened = window.qbotKb.open("docs/本周小结.md");
          return {
            sawEmpty: window.__sawEmpty,
            text: root.textContent,
            rows: root.querySelectorAll(".kb-row, .kb-ti, .kb-sr").length,
            retry: btn.textContent,
            disabled: btn.disabled,
            alert: root.querySelector("[role=alert]") != null,
            opened,
            back: window.qbotKb.back(),
          };
        `);
        assert.equal(view.sawEmpty, false, mode);
        assert.equal(view.rows, 0, mode);
        assert.equal(view.retry, "重试", mode);
        assert.equal(view.disabled, false, mode);
        assert.equal(view.alert, true, mode);
        assert.equal(view.opened, false, mode);
        assert.equal(view.back, false, mode);
        assert.match(view.text, /打不开索引，检查网络后重试/);
        assert.equal(view.text.includes("这个文件夹是空的"), false, mode);
        assert.equal(view.text.includes("全部文件"), false, mode);
        assert.equal(view.text.includes("示例-私密"), false, mode);
      });
    }
  });

  test("空 files 数组是空知识库，不是加载失败", async () => {
    state.mode = "empty";
    await withPage(840, 900, async (sessionId) => {
      await loadKb(sessionId);
      const view = await evalAsync(sessionId, `
        const deadline = Date.now() + 4000;
        while (!document.getElementById("tab-kb").textContent.includes("这个文件夹是空的")) {
          if (document.querySelector("#kb-retry")) throw new Error("empty index showed retry");
          if (Date.now() > deadline) throw new Error("empty index did not render");
          await new Promise((r) => setTimeout(r, 20));
        }
        const root = document.getElementById("tab-kb");
        return {
          retry: !!root.querySelector("#kb-retry"),
          all: root.textContent.includes("全部文件"),
          scroller: root.querySelectorAll(".scroller").length,
        };
      `);
      assert.equal(view.retry, false);
      assert.equal(view.all, true);
      assert.equal(view.scroller, 2);
    });
  });

  test("索引失败后重试成功，监听器不重复", async () => {
    state.mode = "404";
    await withPage(390, 844, async (sessionId) => {
      await evalAsync(sessionId, `
        window.__kbCounts = { tab: 0, vis: 0, resize: 0, io: 0 };
        window.__sawEmpty = false;
        const root = document.getElementById("tab-kb");
        const obs = new MutationObserver(() => {
          const t = root.textContent || "";
          if (t.includes("这个文件夹是空的") || t.includes("全部文件")) window.__sawEmpty = true;
        });
        obs.observe(root, { subtree: true, childList: true, characterData: true });
        window.__kbObs = obs;
        const docAdd = Document.prototype.addEventListener;
        Document.prototype.addEventListener = function (type, fn, opt) {
          if (type === "visibilitychange") window.__kbCounts.vis += 1;
          return docAdd.call(this, type, fn, opt);
        };
        const winAdd = Window.prototype.addEventListener;
        Window.prototype.addEventListener = function (type, fn, opt) {
          if (type === "qbot:tab") window.__kbCounts.tab += 1;
          if (type === "resize") window.__kbCounts.resize += 1;
          return winAdd.call(this, type, fn, opt);
        };
        const OrigIO = window.IntersectionObserver;
        window.IntersectionObserver = function (cb, opt) {
          window.__kbCounts.io += 1;
          return new OrigIO(cb, opt);
        };
        window.IntersectionObserver.prototype = OrigIO.prototype;
      `);
      await loadKb(sessionId);
      await evalAsync(sessionId, `
        const deadline = Date.now() + 4000;
        while (!document.querySelector("#kb-retry")) {
          if (Date.now() > deadline) throw new Error("missing retry");
          await new Promise((r) => setTimeout(r, 20));
        }
        if (window.__sawEmpty) throw new Error("empty folder on first failure");
        const before = Object.assign({}, window.__kbCounts);
        if (before.tab || before.vis || before.resize || before.io) throw new Error("listeners on failure " + JSON.stringify(before));
        document.querySelector("#kb-retry").click();
        let back = false;
        const again = Date.now() + 4000;
        while (Date.now() < again) {
          const btn = document.querySelector("#kb-retry");
          if (btn && !btn.disabled && btn.textContent === "重试") { back = true; break; }
          await new Promise((r) => setTimeout(r, 20));
        }
        if (!back) throw new Error("second failure did not restore retry");
        if (window.__sawEmpty) throw new Error("empty folder on second failure");
        window.__kbObs.disconnect();
      `);
      state.mode = "ok";
      const recovered = await evalAsync(sessionId, `
        document.querySelector("#kb-retry").click();
        const deadline = Date.now() + 4000;
        while (!document.querySelector('[data-key="docs/本周小结.md"]')) {
          if (Date.now() > deadline) throw new Error("retry did not recover");
          await new Promise((r) => setTimeout(r, 20));
        }
        const root = document.getElementById("tab-kb");
        if (root.querySelector("#kb-retry")) throw new Error("retry button stayed");
        if (root.textContent.includes("打不开索引")) throw new Error("error stayed");
        if (root.textContent.includes("示例-私密")) throw new Error("private file visible");
        const scrolls = root.querySelectorAll(".kb-scroll");
        if (scrolls.length !== 2 || !Array.prototype.every.call(scrolls, (el) => el.classList.contains("scroller"))) {
          throw new Error("scroller missing after retry");
        }
        const tabs = [];
        window.qbotTab = (name) => { tabs.push(name); };
        const opened = window.qbotKb.open("docs/本周小结.md");
        const title = document.querySelector("h2") && document.querySelector("h2").textContent;
        const countsAfterOpen = Object.assign({}, window.__kbCounts);
        window.KB.mount(root, ${JSON.stringify(fixture)});
        return {
          opened,
          title,
          tabs,
          countsAfterOpen,
          countsAfterRemount: Object.assign({}, window.__kbCounts),
        };
      `);
      assert.equal(recovered.opened, true);
      assert.equal(recovered.title, "本周小结.md");
      assert.deepEqual(recovered.tabs, ["kb"]);
      assert.deepEqual(recovered.countsAfterOpen, { tab: 1, vis: 1, resize: 1, io: 1 });
      assert.deepEqual(recovered.countsAfterRemount, { tab: 1, vis: 1, resize: 1, io: 1 });
    });
  });

  test("搜索点开详情，返回后再次返回清空搜索", async () => {
    await withPage(390, 844, async (sessionId) => {
      await loadKb(sessionId, fixture);
      const view = await evalAsync(sessionId, `
        const input = document.querySelector("#kb-q");
        input.value = "小结";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const row = document.querySelector('.kb-sr[data-key="docs/本周小结.md"]');
        if (!row) throw new Error("search miss");
        if (document.getElementById("tab-kb").textContent.includes("周报-示例")) throw new Error("unrelated hit");
        if (document.getElementById("tab-kb").textContent.includes("示例-私密")) throw new Error("private hit");
        row.click();
        if (!document.querySelector(".kb.is-detail, .kb") || !document.querySelector("h2")) throw new Error("no detail");
        if (document.querySelector("h2").textContent !== "本周小结.md") throw new Error("wrong detail");
        if (getComputedStyle(document.querySelector(".kb-pane")).display !== "none") throw new Error("folded detail still shows pane");
        const label = document.querySelector("[data-kb-back]").textContent;
        if (!label.includes("返回搜索结果")) throw new Error(label);
        const first = window.qbotKb.back();
        if (first !== true) throw new Error("first back");
        if (document.querySelector("h2")) throw new Error("detail stayed");
        if (document.querySelector("#kb-q").value !== "小结") throw new Error("search cleared on detail back");
        if (!document.querySelector('.kb-sr[data-key="docs/本周小结.md"]')) throw new Error("results gone");
        const second = window.qbotKb.back();
        if (second !== true) throw new Error("second back");
        if (document.querySelector("#kb-q").value !== "") throw new Error("search not cleared");
        if (document.querySelector(".kb-sr")) throw new Error("still searching");
        const home = document.getElementById("tab-kb").textContent;
        if (!home.includes("最近更新") || !home.includes("文件夹")) throw new Error("not home");
        const third = window.qbotKb.back();
        return { third, homeHasReport: home.includes("周报-示例") };
      `);
      assert.equal(view.third, false);
      assert.equal(view.homeHasReport, true);
    });
  });

  test("qbotKb.open 成功、未知和私密", async () => {
    await withPage(840, 900, async (sessionId) => {
      await loadKb(sessionId, fixture);
      const view = await evalAsync(sessionId, `
        const tabs = [];
        window.qbotTab = (name) => { tabs.push(name); };
        const ok = window.qbotKb.open("docs/季度观察-示例.pdf");
        const title = document.querySelector("h2") && document.querySelector("h2").textContent;
        const unknown = window.qbotKb.open("docs/不存在-示例.txt");
        const titleAfterUnknown = document.querySelector("h2") && document.querySelector("h2").textContent;
        const priv = window.qbotKb.open("private/示例-私密.txt");
        const titleAfterPrivate = document.querySelector("h2") && document.querySelector("h2").textContent;
        const leaked = document.getElementById("tab-kb").textContent.includes("示例-私密");
        const withoutTab = window.qbotTab;
        window.qbotTab = undefined;
        window.qbotKb.back();
        const stillOpens = window.qbotKb.open("reports/周报-示例.md");
        const reportTitle = document.querySelector("h2") && document.querySelector("h2").textContent;
        window.qbotTab = withoutTab;
        return { ok, title, unknown, titleAfterUnknown, priv, titleAfterPrivate, leaked, tabs, stillOpens, reportTitle };
      `);
      assert.equal(view.ok, true);
      assert.equal(view.title, "季度观察-示例.pdf");
      assert.equal(view.unknown, false);
      assert.equal(view.titleAfterUnknown, "季度观察-示例.pdf");
      assert.equal(view.priv, false);
      assert.equal(view.titleAfterPrivate, "季度观察-示例.pdf");
      assert.equal(view.leaked, false);
      assert.deepEqual(view.tabs, ["kb", "kb", "kb"]);
      assert.equal(view.stillOpens, true);
      assert.equal(view.reportTitle, "周报-示例.md");
    });
  });

  test("目录导航、390/840 布局和 scroller", async () => {
    await withPage(390, 844, async (sessionId) => {
      await loadKb(sessionId, fixture);
      const folded = await evalAsync(sessionId, `
        const root = document.querySelector(".kb");
        const paneScroll = document.querySelector("#kb-pane-scroll");
        const mainScroll = document.querySelector("#kb-main-scroll");
        const layout = {
          topbar: getComputedStyle(document.querySelector(".kb-topbar")).display,
          pane: getComputedStyle(paneScroll).display,
          direction: getComputedStyle(root).flexDirection,
          paneScroller: paneScroll.classList.contains("scroller"),
          mainScroller: mainScroll.classList.contains("scroller"),
          mainFolders: mainScroll.querySelectorAll('[data-folder="docs"]').length,
        };
        mainScroll.querySelector('[data-folder="docs"]').click();
        const inside = mainScroll.textContent;
        const up = window.qbotKb.back();
        const home = mainScroll.textContent;
        const done = window.qbotKb.back();
        return {
          layout,
          up,
          done,
          sawNote: inside.includes("本周小结.md"),
          sawOther: inside.includes("周报-示例.md"),
          homeHasFolders: home.includes("文件夹"),
        };
      `);
      assert.deepEqual(folded.layout, {
        topbar: "none",
        pane: "none",
        direction: "column",
        paneScroller: true,
        mainScroller: true,
        mainFolders: 1,
      });
      assert.equal(folded.sawNote, true);
      assert.equal(folded.sawOther, false);
      assert.equal(folded.up, true);
      assert.equal(folded.done, false);
      assert.equal(folded.homeHasFolders, true);
    });

    await withPage(840, 900, async (sessionId) => {
      await loadKb(sessionId, fixture);
      const wide = await evalAsync(sessionId, `
        const root = document.querySelector(".kb");
        const paneScroll = document.querySelector("#kb-pane-scroll");
        const mainScroll = document.querySelector("#kb-main-scroll");
        const layout = {
          topbar: getComputedStyle(document.querySelector(".kb-topbar")).display,
          pane: getComputedStyle(paneScroll).display,
          direction: getComputedStyle(root).flexDirection,
          paneScroller: paneScroll.classList.contains("scroller"),
          mainScroller: mainScroll.classList.contains("scroller"),
          treeDocs: paneScroll.querySelectorAll('.kb-ti[data-folder="docs"]').length,
          mainFolders: mainScroll.querySelectorAll('[data-folder="docs"]').length,
        };
        paneScroll.querySelector('.kb-ti[data-folder="docs"]').click();
        const nested = paneScroll.querySelector('[data-folder="docs/示 例"]');
        if (!nested) throw new Error("nested folder missing");
        nested.click();
        const inside = mainScroll.textContent;
        const toDocs = window.qbotKb.back();
        const docsText = mainScroll.textContent;
        const toRoot = window.qbotKb.back();
        const atRoot = window.qbotKb.back();
        return {
          layout,
          toDocs,
          toRoot,
          atRoot,
          sawSpecial: inside.includes("100%完成#稿?.txt"),
          sawReportInSpecial: inside.includes("周报-示例.md"),
          docsStillHasNote: docsText.includes("本周小结.md"),
          docsHidesReport: !docsText.includes("周报-示例.md"),
        };
      `);
      assert.equal(wide.layout.topbar, "flex");
      assert.equal(wide.layout.pane, "block");
      assert.equal(wide.layout.direction, "row");
      assert.equal(wide.layout.paneScroller, true);
      assert.equal(wide.layout.mainScroller, true);
      assert.equal(wide.layout.treeDocs, 1);
      assert.equal(wide.layout.mainFolders, 0);
      assert.equal(wide.sawSpecial, true);
      assert.equal(wide.sawReportInSpecial, false);
      assert.equal(wide.toDocs, true);
      assert.equal(wide.docsStillHasNote, true);
      assert.equal(wide.docsHidesReport, true);
      assert.equal(wide.toRoot, true);
      assert.equal(wide.atRoot, false);
    });
  });

  test("切走 Tab 暂停音频和视频，切回知识库不暂停", async () => {
    const media = structuredClone(fixture);
    media.base = origin + "/files";
    await withPage(840, 900, async (sessionId) => {
      await loadKb(sessionId, media);
      const view = await evalAsync(sessionId, `
        window.qbotTab = () => {};
        if (window.qbotKb.open("audio/示例-片段.wav") !== true) throw new Error("open audio");
        const audio = document.querySelector("audio.kb-media");
        if (!audio) throw new Error("no audio");
        if (!audio.getAttribute("src").startsWith(${JSON.stringify(origin + "/files/")})) throw new Error(audio.getAttribute("src"));
        let played = false;
        try {
          await audio.play();
          played = !audio.paused;
        } catch (e) {
          played = false;
        }
        let pauses = 0;
        const orig = audio.pause.bind(audio);
        audio.pause = () => { pauses += 1; return orig(); };
        window.dispatchEvent(new CustomEvent("qbot:tab", { detail: { tab: "feed" } }));
        const afterFeed = { pauses, paused: audio.paused };
        window.dispatchEvent(new CustomEvent("qbot:tab", { detail: { tab: "kb" } }));
        const afterKb = pauses;
        window.dispatchEvent(new CustomEvent("qbot:tab", { detail: {} }));
        const afterEmpty = pauses;
        if (window.qbotKb.open("videos/介绍-示例.mp4") !== true) throw new Error("open video");
        const video = document.querySelector("video.kb-media");
        if (!video) throw new Error("no video");
        let videoPauses = 0;
        const videoOrig = video.pause.bind(video);
        video.pause = () => { videoPauses += 1; return videoOrig(); };
        window.dispatchEvent(new CustomEvent("qbot:tab", { detail: { tab: "chat" } }));
        const afterChat = videoPauses;
        window.dispatchEvent(new CustomEvent("qbot:tab", { detail: { tab: "kb" } }));
        return { played, afterFeed, afterKb, afterEmpty, afterChat, videoPauses, videoPaused: video.paused };
      `);
      assert.equal(view.played, true);
      assert.equal(view.afterFeed.pauses, 1);
      assert.equal(view.afterFeed.paused, true);
      assert.equal(view.afterKb, 1);
      assert.equal(view.afterEmpty, 1);
      assert.equal(view.afterChat, 1);
      assert.equal(view.videoPauses, 1);
      assert.equal(view.videoPaused, true);
    });
  });

  test("特殊字符链接可解码，恶意索引不能注入脚本", async () => {
    await withPage(840, 900, async (sessionId) => {
      await loadKb(sessionId, fixture);
      const link = await evalAsync(sessionId, `
        window.qbotTab = () => {};
        const key = ${JSON.stringify(SPECIAL_KEY)};
        if (window.qbotKb.open(key) !== true) throw new Error("open special");
        const a = document.querySelector("a.kb-open");
        if (!a) throw new Error("missing link");
        const href = a.getAttribute("href");
        const prefix = "https://files.example.test/pub/";
        const decoded = href.slice(prefix.length).split("/").map(decodeURIComponent).join("/");
        return {
          href,
          decoded,
          hash: href.includes("#"),
          query: href.includes("?"),
          name: document.querySelector("h2").textContent,
        };
      `);
      assert.equal(link.href, SPECIAL_HREF);
      assert.equal(link.decoded, SPECIAL_KEY);
      assert.equal(link.hash, false);
      assert.equal(link.query, false);
      assert.equal(link.name, "100%完成#稿?.txt");

      const injected = await evalAsync(sessionId, `
        const file = ${JSON.stringify({
          key: 'docs/a"b<c>.txt',
          name: 'say"></a><img src=x onerror=alert(1)>',
          summary: "<script>alert(1)</script>",
          tags: ["<svg/onload=alert(1)>"],
          kind: "file",
          doc_type: "文档",
          size: 12,
          mtime: 1794816000,
          dir: "docs",
          private: false,
        })};
        window.KB.mount(document.getElementById("tab-kb"), {
          base: "https://files.example.test/pub",
          files: [file],
        });
        window.qbotKb.open(file.key);
        const root = document.getElementById("tab-kb");
        const html = root.innerHTML;
        const a = root.querySelector("a.kb-open");
        return {
          imgs: root.querySelectorAll("img").length,
          scripts: root.querySelectorAll("script").length,
          handlers: root.querySelectorAll("[onerror],[onload]").length,
          rawImg: html.includes("<img"),
          rawScript: html.toLowerCase().includes("<script"),
          href: a && a.getAttribute("href"),
          text: root.textContent,
        };
      `);
      assert.equal(injected.imgs, 0);
      assert.equal(injected.scripts, 0);
      assert.equal(injected.handlers, 0);
      assert.equal(injected.rawImg, false);
      assert.equal(injected.rawScript, false);
      assert.equal(injected.href, "https://files.example.test/pub/docs/a%22b%3Cc%3E.txt");
      assert.equal(injected.text.includes("<img src=x onerror=alert(1)>"), true);
      assert.equal(injected.text.includes("<script>alert(1)</script>"), true);

      const blocked = await evalAsync(sessionId, `
        const bases = ${JSON.stringify([
          "javascript:alert(1)",
          "JaVaScRiPt:alert(1)",
          " javascript:alert(1)",
          "java\nscript:alert(1)",
          "java\tscript:alert(1)",
          "data:text/html,<script>alert(1)</script>",
          "vbscript:msgbox(1)",
          "file:///tmp/x",
          "blob:https://files.example.test/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        ])};
        const file = {
          key: "docs/示例.txt",
          name: "示例.txt",
          summary: "示例",
          tags: [],
          kind: "audio",
          doc_type: "音频",
          size: 4,
          mtime: 1794816000,
          dir: "docs",
          private: false,
        };
        const bad = [];
        for (const base of bases) {
          window.KB.mount(document.getElementById("tab-kb"), { base, files: [file] });
          window.qbotKb.open(file.key);
          const root = document.getElementById("tab-kb");
          const a = root.querySelector("a.kb-open");
          const media = root.querySelector("audio,video");
          const html = root.innerHTML.toLowerCase();
          if (a || media || html.includes("javascript:") || html.includes("vbscript:") || html.includes("data:text")) {
            bad.push(base);
          }
        }
        const tricky = "https://user:placeholder@files.example.test/pub?q=1#javascript:alert(1)";
        window.KB.mount(document.getElementById("tab-kb"), {
          base: tricky,
          files: [{
            key: ${JSON.stringify(SPECIAL_KEY)},
            name: "100%完成#稿?.txt",
            summary: "示例",
            tags: [],
            kind: "file",
            doc_type: "文档",
            size: 4,
            mtime: 1794816000,
            dir: "docs/示 例",
            private: false,
          }],
        });
        window.qbotKb.open(${JSON.stringify(SPECIAL_KEY)});
        const cleaned = document.querySelector("a.kb-open");
        return {
          bad,
          href: cleaned && cleaned.getAttribute("href"),
          html: document.getElementById("tab-kb").innerHTML,
        };
      `);
      assert.deepEqual(blocked.bad, []);
      assert.equal(blocked.href, SPECIAL_HREF);
      assert.equal(blocked.html.includes("javascript:"), false);
      assert.equal(blocked.html.includes("user:placeholder"), false);
      assert.equal(blocked.html.includes("placeholder@"), false);
      assert.equal(blocked.html.includes("?q=1"), false);
    });
  });

  test("390 和 840 脱敏截图", async () => {
    await withPage(390, 844, async (sessionId) => {
      await loadKb(sessionId, fixture);
      const text = await evalJson(sessionId, "document.getElementById('tab-kb').textContent");
      assert.equal(text.includes("示例-私密"), false);
      assert.equal(text.includes("本周小结.md"), true);
      const file = await shot(sessionId, 390, 844, "kb-390-home.png");
      assert.ok(file.endsWith("kb-390-home.png"));
    });
    await withPage(840, 900, async (sessionId) => {
      await loadKb(sessionId, fixture);
      const text = await evalJson(sessionId, "document.getElementById('tab-kb').textContent");
      assert.equal(text.includes("示例-私密"), false);
      assert.equal(text.includes("季度观察-示例.pdf"), true);
      await shot(sessionId, 840, 900, "kb-840-home.png");
    });
    state.mode = "404";
    await withPage(390, 844, async (sessionId) => {
      await loadKb(sessionId);
      await evalAsync(sessionId, `
        const deadline = Date.now() + 4000;
        while (!document.querySelector("#kb-retry")) {
          if (Date.now() > deadline) throw new Error("no retry for screenshot");
          await new Promise((r) => setTimeout(r, 20));
        }
      `);
      await shot(sessionId, 390, 844, "kb-390-index-error.png");
    });
  });
});
