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

function startServer() {
  const types = { ".js": "text/javascript", ".html": "text/html", ".json": "application/json", ".css": "text/css" };
  const server = createServer((req, res) => {
    const url = req.url.split("?")[0];
    if (url === "/contract-feed.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(FEED);
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
  console.log("shell contract passed");
} finally {
  try { chrome.kill(); } catch (e) {}
  server.close();
}
