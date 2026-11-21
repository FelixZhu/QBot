import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { filterKbFiles } from "./indexFilter.ts";

test("demo library rows are removed and a real row stays", () => {
  const fixture = JSON.parse(readFileSync(new URL("../../../drive-web/test/fixtures/kb-index.json", import.meta.url), "utf8")) as { files: { name?: string; key?: string; tags?: string[] }[] };
  assert.ok(fixture.files.length > 0);
  assert.equal(filterKbFiles(fixture.files).length, 0);
  const kept = filterKbFiles([
    ...fixture.files,
    { name: "notes.md", key: "notes/notes.md", tags: ["笔记"] },
  ]);
  assert.deepEqual(kept.map((item) => item.key), ["notes/notes.md"]);
});

test("the published library index still has real entries and no demo marker", async () => {
  const response = await fetch("https://felixzhu.github.io/QBot/index.json");
  assert.equal(response.status, 200);
  const body = await response.json() as { files?: { name?: string; key?: string; tags?: string[]; private?: boolean }[] };
  const files = body.files ?? [];
  assert.ok(files.length > 0);
  assert.equal(filterKbFiles(files).length, files.length);
  assert.equal(files.some((item) => item.private === true), false);
});
