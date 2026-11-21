import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../../chat-web/src/App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../chat-web/src/chat.css", import.meta.url), "utf8");
const template = readFileSync(new URL("../template.html", import.meta.url), "utf8");

test("the conversation home shows three labeled demos and no private sample chats", () => {
  for (const sample of ["健康助手", "英语陪练", "学习助手", "灵感助手", "资讯助手", "AI Infra", "出差 · 上海", "周五 14:00", "CONVERSATIONS", "initialMessages", "NextToken"]) {
    assert.equal(app.includes(sample), false, sample);
  }
  for (const name of ["Info Bot", "English Bot", "Study Bot", "演示会话，没有接通"]) {
    assert.match(app, new RegExp(name));
  }
  assert.match(app, /虚构示例/);
  assert.match(app, /搜索对话/);
  assert.match(app, /qbs-in-chat/);
  assert.match(app, /screen !== "list"/);
});

test("reload and the app refresh query open the conversation list", () => {
  assert.match(template, /__qbDeepLink/);
  assert.match(template, /nav\.type==="reload"/);
  assert.match(template, /v=\\d\+/);
  assert.equal(template.includes('sessionStorage.getItem("qbs_tab")'), false);
  assert.match(template, /S\.active="~home"/);
});

test("list, bubble, and composer sizes follow the approved spec", () => {
  assert.match(css, /#FAF9F6/);
  assert.match(css, /#1C1B19/);
  assert.match(css, /#8A8781/);
  assert.match(css, /#EAE7E1/);
  assert.match(css, /#FF6A2B/);
  assert.match(css, /min-height:80px/);
  assert.match(css, /\.qc-conv \.av\{width:48px;height:48px/);
  assert.match(css, /font-size:16px/);
  assert.match(css, /font-size:14px/);
  assert.match(css, /\.qc-conv \.tm\{flex:none;font-size:12px/);
  assert.match(css, /max-width:78%/);
  assert.match(css, /\.qc-bubble\{max-width:78%;padding:12px/);
  assert.match(css, /min-height:calc\(56px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /height:calc\(56px \+ env\(safe-area-inset-top\)\)/);
  assert.match(css, /\.qc-search\{[^}]*height:40px/);
  assert.equal(css.includes("woff"), false);
  assert.equal(css.includes("Microsoft YaHei"), false);
});

test("an open chat hides the shared bar only while the chat tab is showing", () => {
  assert.match(css, /\.qbs:has\(#panel-chat:not\(\[hidden\]\)\)\.qbs-in-chat \.qbs-nav\{display:none\}/);
  assert.match(css, /\.qbs-item\{font-size:12px\}/);
  assert.match(template, /data-qbs-tab="chat"/);
  assert.match(template, /data-qbs-tab="feed"/);
  assert.match(template, /data-qbs-tab="kb"/);
  assert.match(template, /主动服务/);
  assert.match(template, /知识库/);
  assert.match(template, /window\.qbotChat&&window\.qbotChat\.back\(\)/);
});
