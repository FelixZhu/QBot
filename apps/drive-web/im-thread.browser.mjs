/* Local thread proof for the conversation list.
 * Sends one message through the existing in-page mock. No external bot, no public write.
 * Run: node apps/drive-web/im-thread.browser.mjs
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const dist = path.join(repo, "apps/chat-web/dist");
const FIXTURE = "演示夹具额外一句";
const BOTS = ["Info Bot", "English Bot", "Study Bot"];

const harness = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/chat.css">
<style>html,body{margin:0;height:100%;background:#FAF9F6}
.qbs{height:100dvh;display:grid;grid-template-rows:minmax(0,1fr) auto;grid-template-areas:"main" "nav"}
.qbs-nav{grid-area:nav;display:flex;height:56px;border-top:1px solid #EAE7E1}
.qbs-item{flex:1;font-size:12px}
#panel-chat,#chat-root{height:100%;min-height:0}
</style></head><body>
<div class="qbs" id="qbs">
<nav class="qbs-nav"><button class="qbs-item" data-qbs-tab="chat">对话</button><button class="qbs-item" data-qbs-tab="feed">主动服务</button><button class="qbs-item" data-qbs-tab="kb">知识库</button></nav>
<section id="panel-chat"><div id="chat-root"></div></section>
</div>
<script type="module" src="/chat.js"></script>
</body></html>`;

const files = {
  "/": harness,
  "/tokens.css": readFileSync(path.join(here, "tokens.css")),
  "/chat.css": readFileSync(path.join(dist, "chat.css")),
  "/chat.js": readFileSync(path.join(dist, "chat.js")),
};
const types = { "/": "text/html; charset=utf-8", "/tokens.css": "text/css", "/chat.css": "text/css", "/chat.js": "text/javascript" };
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const body = files[url.pathname];
  if (!body) { res.writeHead(404); res.end("missing"); return; }
  res.writeHead(200, { "content-type": types[url.pathname], "cache-control": "no-store" });
  res.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}/?mockDelay=20`;

const chrome = spawn(process.env.CHROME || "/usr/bin/google-chrome-stable", [
  "--headless=new",
  "--remote-debugging-port=9414",
  "--user-data-dir=/tmp/chrome-im-thread",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--no-sandbox",
  "about:blank",
], { stdio: "ignore" });

const pending = new Map();
let seq = 0;
let ws;
const hosts = new Set();
function call(method, params, ms = 20000) {
  const id = ++seq;
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error("timeout " + method)), ms);
    pending.set(id, { res, rej, timer });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await fetch("http://127.0.0.1:9414/json/list").then((r) => r.json());
      const page = list.find((t) => t.type === "page");
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
        ws.addEventListener("message", (msg) => {
          const m = JSON.parse(msg.data);
          if (m.method === "Network.requestWillBeSent") {
            try { hosts.add(new URL(m.params.request.url).host); } catch { /* ignore */ }
          }
          if (m.id && pending.has(m.id)) {
            const p = pending.get(m.id);
            pending.delete(m.id);
            clearTimeout(p.timer);
            if (m.error) p.rej(new Error(JSON.stringify(m.error)));
            else p.res(m.result);
          }
        });
        return;
      }
    } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("chrome did not open");
}
async function ev(expression) {
  const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 700));
  return r.result.value;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitFor(expr, label) {
  for (let i = 0; i < 80; i++) {
    if (await ev(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`)) return;
    await sleep(150);
  }
  throw new Error("timeout " + label + " " + await ev(`document.body ? document.body.innerText.slice(0,300) : "no body"`));
}
async function shot(name) {
  const r = await call("Page.captureScreenshot", { format: "png" });
  const file = path.join("/opt/cursor/artifacts", name);
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync("/opt/cursor/artifacts", { recursive: true });
  writeFileSync(file, Buffer.from(r.data, "base64"));
}

try {
  await connect();
  await call("Network.enable");
  await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call("Page.navigate", { url: origin });
  await waitFor(`document.body && document.body.innerText.includes("Info Bot") && document.body.innerText.includes("Study Bot")`, "demo list");
  for (const name of BOTS) {
    await ev(`(() => { const row = [...document.querySelectorAll(".qc-conv")].find((el) => el.innerText.includes(${JSON.stringify(name)})); row.click(); return true; })()`);
    await waitFor(`document.body.innerText.includes("没有接通") && document.body.innerText.includes("演示")`, name);
    await ev(`document.querySelector(".qc-suggest button").click()`);
    await waitFor(`document.body.innerText.includes("演示回复")`, name + " reply");
    assert.equal(await ev(`getComputedStyle(document.querySelector(".qbs-nav")).display`), "none", name);
    await ev(`document.querySelector(".qc-back").click()`);
    await waitFor(`document.body.innerText.includes("English Bot")`, name + " back");
  }
  await ev(`(() => { const row = [...document.querySelectorAll(".qc-conv")].find((el) => el.innerText.includes("Info Bot")); row.click(); return true; })()`);
  await waitFor(`document.querySelector(".qc-field")`, "composer");
  const typed = await ev(`(() => {
    const input = document.querySelector(".qc-field");
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    set.call(input, ${JSON.stringify(FIXTURE)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return input.value;
  })()`);
  assert.equal(typed, FIXTURE);
  await ev(`document.querySelector(".qc-send").click()`);
  await waitFor(`document.body.innerText.includes(${JSON.stringify(FIXTURE)}) && document.body.innerText.includes("演示回复")`, "typed demo send");
  await shot("im-demo-thread.png");
  await ev(`document.querySelector(".qc-back").click()`);
  await waitFor(`document.querySelectorAll(".qc-conv").length === 3`, "three demos");
  const row = await ev(`document.body.innerText`);
  assert.equal(row.includes("未读"), false);
  assert.match(row, /演示/);
  await shot("im-demo-list.png");
  await ev(`(() => { const input = document.querySelector(".qc-search input"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(input, "English"); input.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await sleep(80);
  assert.equal(await ev(`document.querySelectorAll(".qc-conv").length`), 1);
  await ev(`(() => { const input = document.querySelector(".qc-search input"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(input, "没有这句夹具"); input.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await sleep(80);
  assert.equal(await ev(`document.body.innerText.includes("没有匹配的会话")`), true);
  await shot("im-demo-search.png");
  await call("Page.reload", { ignoreCache: true });
  await waitFor(`document.body && document.body.innerText.includes("Info Bot")`, "reload keeps scripted demos");
  assert.equal(await ev(`document.body.innerText.includes(${JSON.stringify(FIXTURE)})`), false, "typed demo survived reload");
  const stored = await ev(`Object.values(localStorage).join("\\n")`);
  assert.equal(stored.includes(FIXTURE), false, "the fixture was written into localStorage");
  const outside = [...hosts].filter((h) => h !== `127.0.0.1:${port}`);
  assert.deepEqual(outside, [], "request left the local page: " + outside.join(","));
  console.log("demo thread proof passed");
} finally {
  chrome.kill("SIGKILL");
  server.close();
}
