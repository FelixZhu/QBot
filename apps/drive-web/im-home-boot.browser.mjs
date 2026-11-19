/* Cold start, refresh, and an explicit file link.
 * Run: node apps/drive-web/im-home-boot.browser.mjs
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const page = readFileSync(path.join(here, "template.html"), "utf8")
  .replace("__MANIFEST__", '{"files":[],"generated":1}')
  .replaceAll("__BASE__", "http://127.0.0.1")
  .replaceAll("__VERSION__", "boottest");
const FILE = "#/videos/NextToken_010_demo";

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page);
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;

const chrome = spawn(process.env.CHROME || "/usr/bin/google-chrome-stable", [
  "--headless=new", "--remote-debugging-port=9418",
  "--user-data-dir=/tmp/chrome-im-boot", "--no-first-run",
  "--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox", "about:blank",
], { stdio: "ignore" });
const pending = new Map();
let seq = 0;
let ws;
function call(method, params, ms = 15000) {
  const id = ++seq;
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error("timeout " + method)), ms);
    pending.set(id, { res, rej, timer });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const list = await fetch("http://127.0.0.1:9418/json/list").then((r) => r.json());
    const target = list.find((t) => t.type === "page");
    if (!target) throw new Error("no page");
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
    ws.addEventListener("message", (msg) => {
      const m = JSON.parse(msg.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.error) p.rej(new Error(JSON.stringify(m.error)));
        else p.res(m.result);
      }
    });
  } catch { await new Promise((r) => setTimeout(r, 200)); }
}
async function ev(expression) {
  const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
}
async function waitFor(expr, label) {
  for (let i = 0; i < 40; i++) {
    if (await ev(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timeout " + label);
}
function tab() {
  return ev(`document.querySelector('.qbs-item[aria-current="page"] span').textContent + "|" + location.hash`);
}

try {
  await call("Page.enable");
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `
    try {
      localStorage.setItem("qd2_active", JSON.stringify("videos/NextToken_010_demo"));
      localStorage.setItem("qd2_tabs", JSON.stringify(["videos/NextToken_010_demo"]));
      sessionStorage.setItem("qbs_tab", "kb");
    } catch (e) {}
  ` });
  await call("Page.navigate", { url: `${origin}/?v=1${FILE}` });
  await waitFor(`document.querySelector('.qbs-item[aria-current="page"] span')`, "boot");
  assert.equal(await tab(), "对话|", "refresh query restored the file");
  assert.equal(await ev(`localStorage.getItem("qd2_active")`), JSON.stringify("videos/NextToken_010_demo"), "stored file was erased");
  await ev(`document.querySelector('[data-qbs-tab="kb"]').click()`);
  await waitFor(`document.querySelector('.qbs-item[aria-current="page"] span').textContent === "知识库"`, "switch kb");
  await ev(`location.reload()`);
  await waitFor(`document.querySelector('.qbs-item[aria-current="page"] span').textContent === "对话" && location.hash === ""`, "reload");
  await call("Page.navigate", { url: `${origin}/${FILE}` });
  await waitFor(`document.querySelector('.qbs-item[aria-current="page"] span').textContent === "知识库" && location.hash === ${JSON.stringify(FILE)}`, "deep link");
  console.log("home boot proof passed");
} finally {
  chrome.kill("SIGKILL");
  server.close();
}
