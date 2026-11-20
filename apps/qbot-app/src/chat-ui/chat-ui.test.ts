import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMOS } from "../demos.ts";
import { acceptClipboardWrite, nativeClipboardReady } from "./clipboard.ts";
import { distanceFromBottom, keyboardCover, showJumpToBottom } from "./layout.ts";
import { openableHref, parseMarkdown } from "./markdown.ts";

test("demo brief stays a paragraph, a list, and a closing paragraph", () => {
  const info = DEMOS.find((demo) => demo.id === "info");
  const reply = info?.messages.find((line) => line.role === "assistant")?.text ?? "";
  const blocks = parseMarkdown(reply);
  assert.equal(blocks[0]?.type, "paragraph");
  assert.equal(blocks[1]?.type, "list");
  assert.equal(blocks[1]?.type === "list" ? blocks[1].ordered : false, true);
  assert.equal(blocks[1]?.type === "list" ? blocks[1].items.length : 0, 3);
  assert.equal(blocks[2]?.type, "paragraph");
});

test("an open fence stays code and does not rewrite earlier paragraphs", () => {
  const partial = "先看结论。\n\n```ts\nconst value = 1";
  const grown = `${partial}\nconst next = 2`;
  const first = parseMarkdown(partial);
  const second = parseMarkdown(grown);
  assert.deepEqual(first[0], second[0]);
  assert.equal(first[1]?.type, "code");
  assert.equal(second[1]?.type, "code");
  assert.equal(first[1]?.type === "code" ? first[1].language : "", "ts");
  assert.match(second[1]?.type === "code" ? second[1].code : "", /const next/);
});

test("a closed fence and inline marks parse, and a broken mark stays text", () => {
  const blocks = parseMarkdown("这是 **重点** 和 `code`，还有 [说明](https://example.com/a)。\n\n```\nline\n```\n\n未闭合 **粗体");
  const paragraph = blocks[0];
  assert.equal(paragraph?.type, "paragraph");
  const kinds = paragraph?.type === "paragraph" ? paragraph.inlines.map((part) => part.type) : [];
  assert.deepEqual(kinds, ["text", "strong", "text", "code", "text", "link", "text"]);
  assert.equal(blocks[1]?.type, "code");
  assert.equal(blocks[1]?.type === "code" ? blocks[1].code : "", "line");
  const tail = blocks[2];
  assert.equal(tail?.type, "paragraph");
  assert.equal(tail?.type === "paragraph" ? tail.inlines[0]?.type : "", "text");
  assert.match(tail?.type === "paragraph" && tail.inlines[0]?.type === "text" ? tail.inlines[0].text : "", /\*\*/);
});

test("links only open as http(s) or mailto", () => {
  assert.equal(openableHref("https://example.com/a"), "https://example.com/a");
  assert.equal(openableHref("mailto:person@example.com"), "mailto:person@example.com");
  assert.equal(openableHref("javascript:alert(1)"), null);
  assert.equal(openableHref("/relative"), null);
  assert.equal(openableHref("not a url"), null);
});

test("a copy control needs a native writer, and only a true result counts as copied", async () => {
  assert.equal(nativeClipboardReady(null), false);
  assert.equal(nativeClipboardReady(undefined), false);
  assert.equal(nativeClipboardReady({}), false);
  assert.equal(nativeClipboardReady({ setStringAsync: undefined }), false);
  assert.equal(nativeClipboardReady({ setStringAsync: async () => true }), true);
  await assert.rejects(() => acceptClipboardWrite(false));
  await assert.doesNotReject(() => acceptClipboardWrite(true));
});

test("keyboard cover meets the keyboard top and stays put once the window already resized", () => {
  assert.equal(keyboardCover(800, 500), 300);
  assert.equal(keyboardCover(500, 500), 0);
  assert.equal(keyboardCover(800, 900), 0);
  assert.equal(distanceFromBottom(1000, 400, 500), 100);
  assert.equal(showJumpToBottom(48), false);
  assert.equal(showJumpToBottom(49), true);
  assert.equal(showJumpToBottom(0), false);
});
