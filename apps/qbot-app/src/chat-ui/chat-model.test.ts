import assert from "node:assert/strict";
import { test } from "node:test";
import { chatChrome } from "../theme.ts";
import {
  ASSISTANT_DISCLAIMER,
  COPY_MARK_MS,
  FILES_LOCAL,
  addDrafts,
  composerChrome,
  decideSend,
  emptyOutbox,
  holdToTalk,
  parsePickerMessage,
  previousUserText,
  reduceOutbox,
  removeDraft,
  sanitizePicked,
  sourceCaption,
  type DraftAttachment,
  type Outbox,
} from "./chatModel.ts";

test("approved chat colors stay on the light and dark frames", () => {
  const light = chatChrome("light");
  const dark = chatChrome("dark");
  assert.equal(light.canvas, "#FAF8F3");
  assert.equal(light.userBubble, "#ECE7DD");
  assert.equal(light.muted, "#736D62");
  assert.equal(light.send, "#FF6A2B");
  assert.equal(light.inkText, "#C24410");
  assert.equal(light.onSend, "#FFFFFF");
  assert.equal(dark.canvas, "#1F1D1A");
  assert.equal(dark.userBubble, "#2E2B27");
  assert.equal(dark.sheet, "#262420");
  assert.equal(dark.muted, "#9A9386");
  assert.equal(dark.send, "#FF6A2B");
  assert.equal(dark.inkText, "#FF8A55");
  assert.equal(ASSISTANT_DISCLAIMER.includes("演示"), false);
  assert.equal(COPY_MARK_MS, 2000);
});

test("a picked file stays out of the text that would be sent", () => {
  const picked = sanitizePicked([
    { name: " 示例资料.pdf ", size: 248 * 1024, mime: "application/pdf", preview: "data:text/html,nope" },
    { name: "", size: -1, mime: "", preview: "data:image/jpeg;base64,aaaa" },
  ]);
  assert.equal(picked[0]?.name, "示例资料.pdf");
  assert.equal(picked[0]?.preview, null);
  assert.equal(picked[1]?.name, "未命名");
  assert.equal(picked[1]?.preview?.startsWith("data:image/jpeg;base64,"), true);
  const wire = JSON.stringify({ type: "picked", files: [{ name: "note.txt", size: 12, mime: "text/plain", preview: null }] });
  assert.equal(parsePickerMessage(wire)?.[0]?.name, "note.txt");
  assert.equal(parsePickerMessage("[]"), null);
  assert.equal(decideSend("帮我总结", 1).kind, "held");
  assert.equal(decideSend("   ", 2).kind, "held");
  const decision = decideSend("帮我总结", 0);
  assert.equal(decision.kind, "text");
  if (decision.kind === "text") {
    assert.equal(decision.text, "帮我总结");
    assert.equal(decision.text.includes("pdf"), false);
  }
  assert.equal(decideSend("  ", 0).kind, "empty");
  assert.equal(FILES_LOCAL.includes("没有上传"), true);
  assert.equal(FILES_LOCAL.includes("已分析"), false);
  assert.equal(FILES_LOCAL.includes("正在阅读"), false);
  assert.equal(composerChrome({ focused: true, text: "总结", attachments: 1, running: false, queued: 0 }).action, "held");
});

test("draft chips can be added and removed without sending", () => {
  const files: DraftAttachment[] = [1, 2, 3, 4, 5].map((index) => ({
    id: `f${index}`,
    name: `f${index}.pdf`,
    size: index,
    mime: "application/pdf",
    preview: null,
  }));
  const first = addDrafts([], files.slice(0, 2));
  assert.deepEqual(first.next.map((item) => item.id), ["f1", "f2"]);
  const second = addDrafts(first.next, files.slice(2));
  assert.deepEqual(second.next.map((item) => item.id), ["f1", "f2", "f3", "f4"]);
  assert.equal(second.dropped, 1);
  assert.deepEqual(removeDraft(second.next, "f2").map((item) => item.id), ["f1", "f3", "f4"]);
});

test("the composer opens, sends, and stops from the real draft state", () => {
  assert.deepEqual(composerChrome({ focused: false, text: "", attachments: 0, running: false, queued: 0 }), {
    expanded: false,
    placeholder: "回复，或按住说话",
    action: "voice",
  });
  assert.equal(composerChrome({ focused: false, text: "", attachments: 0, running: true, queued: 0 }).action, "stop");
  assert.equal(composerChrome({ focused: false, text: "", attachments: 0, running: true, queued: 0 }).placeholder, "发送中…");
  assert.equal(composerChrome({ focused: false, text: "", attachments: 0, running: true, queued: 1 }).action, "voice");
  assert.equal(composerChrome({ focused: true, text: "再举一个", attachments: 0, running: false, queued: 0 }).action, "send");
  assert.equal(composerChrome({ focused: false, text: "", attachments: 1, running: false, queued: 0 }).expanded, true);
  const held = holdToTalk();
  assert.equal(held.accepted, false);
  assert.equal("text" in held, false);
});

test("sources stay hidden unless a message actually carries one", () => {
  assert.equal(sourceCaption([]), null);
  assert.equal(sourceCaption([{ type: "text" }, { type: "source" }]), null);
  assert.equal(sourceCaption([{ type: "source", title: "公开说明" }]), "1 个来源");
});

test("retry uses the previous user text and a waiting message is sent once", () => {
  const messages = [
    { id: "u1", role: "user", content: [{ type: "text", text: "第一问" }] },
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "第一答" }] },
    { id: "u2", role: "user", content: [{ type: "text", text: "第二问" }] },
  ];
  assert.equal(previousUserText(messages, "a1"), "第一问");
  assert.equal(previousUserText(messages, "u1"), null);

  let state: Outbox = emptyOutbox();
  const queued = reduceOutbox(state, { type: "submit", id: "q1", text: "再加一条", running: true });
  state = queued.state;
  assert.deepEqual(queued.effects, []);
  assert.equal(state.items.length, 1);

  const stopped = reduceOutbox(state, { type: "stop" });
  state = stopped.state;
  assert.deepEqual(stopped.effects, [{ type: "cancel" }]);
  const afterStop = reduceOutbox(state, { type: "settled" });
  state = afterStop.state;
  assert.deepEqual(afterStop.effects, []);
  assert.equal(state.items[0]?.text, "再加一条");

  const now = reduceOutbox(state, { type: "send-now", id: "q1", running: false });
  assert.deepEqual(now.effects, [{ type: "send", text: "再加一条" }]);
  assert.equal(now.state.items.length, 0);
  const again = reduceOutbox(now.state, { type: "settled" });
  assert.deepEqual(again.effects, []);
});

test("send now cancels the current reply and the settle sends that text once", () => {
  let state = emptyOutbox();
  state = reduceOutbox(state, { type: "submit", id: "q1", text: "先排队", running: true }).state;
  state = reduceOutbox(state, { type: "submit", id: "q2", text: "还在后面", running: true }).state;
  const interrupt = reduceOutbox(state, { type: "send-now", id: "q1", running: true });
  assert.deepEqual(interrupt.effects, [{ type: "cancel" }]);
  assert.equal(interrupt.state.items.length, 2);
  const settled = reduceOutbox(interrupt.state, { type: "settled" });
  assert.deepEqual(settled.effects, [{ type: "send", text: "先排队" }]);
  assert.deepEqual(settled.state.items.map((item) => item.text), ["还在后面"]);
  const duplicated = reduceOutbox(settled.state, { type: "settled" });
  assert.deepEqual(duplicated.effects, [{ type: "send", text: "还在后面" }]);
  const done = reduceOutbox(duplicated.state, { type: "settled" });
  assert.deepEqual(done.effects, []);
});
