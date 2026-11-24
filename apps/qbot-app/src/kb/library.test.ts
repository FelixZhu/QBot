import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  filterLibraryItems,
  formatDir,
  formatFileSize,
  formatMtime,
  isTextFile,
  LIBRARY_HOME_URL,
  listCategories,
  parseLibraryIndex,
  safeFileUrl,
} from "./library.ts";

test("parseLibraryIndex removes private and demo entries and sorts newest first", () => {
  const fixture = JSON.parse(readFileSync(new URL("../../../drive-web/test/fixtures/kb-index.json", import.meta.url), "utf8")) as {
    base: string;
    files: Record<string, unknown>[];
  };
  const parsed = parseLibraryIndex({
    base: fixture.base,
    files: [
      ...fixture.files,
      { key: "docs/older.md", name: "older.md", kind: "file", doc_type: "文档", size: 120, mtime: 1700000000, dir: "docs", summary: "旧笔记", tags: ["笔记"], private: false },
      { key: "videos/bilibili/newer.mp4", name: "newer.mp4", kind: "video", doc_type: "视频", size: 12000, mtime: 1750000000, dir: "videos/bilibili", summary: "新视频", tags: ["B站"], private: false },
    ],
  });
  assert.deepEqual(parsed.files.map((item) => item.key), [
    "videos/bilibili/newer.mp4",
    "docs/older.md",
  ]);
  assert.deepEqual(listCategories(parsed.files), ["全部", "视频", "文档"]);
  assert.equal(filterLibraryItems(parsed.files, "笔记", "全部").length, 1);
  assert.equal(filterLibraryItems(parsed.files, "", "视频").length, 1);
});

test("safeFileUrl encodes object keys and rejects traversal or non-http bases", () => {
  assert.equal(
    safeFileUrl("https://files.example.test/pub/", "docs/中文 100%#a?.md"),
    "https://files.example.test/pub/docs/%E4%B8%AD%E6%96%87%20100%25%23a%3F.md",
  );
  assert.equal(safeFileUrl("https://files.example.test/pub", "../secret.txt"), "");
  assert.equal(safeFileUrl("javascript:alert(1)", "a.md"), "");
  assert.equal(safeFileUrl("https://user:pass@files.example.test/pub", "a.md"), "");
});

test("formatters strip hash dirs and format sizes, dates, and text types", () => {
  assert.equal(formatDir("xhs/6aa7c06b000000002602181f"), "xhs · 小红书");
  assert.equal(formatDir("videos/bilibili"), "videos · 视频 / bilibili · B站视频");
  assert.equal(formatFileSize(500), "500 B");
  assert.equal(formatFileSize(2048), "2.0 KB");
  assert.equal(formatFileSize(46581974), "44 MB");
  const now = Date.UTC(2026, 10, 23, 12, 0, 0);
  assert.equal(formatMtime(Math.floor(now / 1000), now), "今天");
  assert.equal(formatMtime(Math.floor((now - 86_400_000) / 1000), now), "昨天");
  assert.equal(isTextFile({ key: "docs/a.md", name: "a.md" }), true);
  assert.equal(isTextFile({ key: "videos/a.mp4", name: "a.mp4", type: "video/mp4" }), false);
});

test("knowledge base tab is native LibraryPane without a resident WebView", () => {
  const pane = readFileSync(new URL("../LibraryPane.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
  assert.equal(pane.includes("react-native-webview"), false);
  assert.match(pane, new RegExp(`const HOME_URL = ['"]${LIBRARY_HOME_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`));
  assert.match(pane, /最近更新/);
  assert.equal(pane.includes("Qbot"), false);
  assert.match(app, /<LibraryPane\b/);
  assert.equal(app.includes("WebPane"), false);
});
