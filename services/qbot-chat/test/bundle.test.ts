import assert from "node:assert/strict";
import { test } from "node:test";
import { inferRole, validateBundle } from "../src/feed/bundle.ts";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HTML = Buffer.from("<!doctype html><main>hello</main>", "utf8");
const CSS = Buffer.from("body { color: #111; }", "utf8");

test("validateBundle infers roles, supports dual covers, and produces stable manifest sha256", () => {
  assert.equal(inferRole("index.html"), "page");
  assert.equal(inferRole("cover.png"), "cover");
  assert.equal(inferRole("cover-dark.png"), "cover");
  assert.equal(inferRole("cover-light.webp"), "cover");
  assert.equal(inferRole("style.css"), "asset");

  const a = validateBundle([
    { path: "style.css", bytes: CSS },
    { path: "index.html", bytes: HTML },
    { path: "cover-dark.png", bytes: PNG },
    { path: "cover-light.png", bytes: PNG },
  ]);
  const b = validateBundle([
    { path: "cover-light.png", bytes: PNG },
    { path: "cover-dark.png", bytes: PNG },
    { path: "index.html", bytes: HTML },
    { path: "style.css", bytes: CSS },
  ]);
  assert.equal(a.manifestSha256, b.manifestSha256);
  assert.match(a.manifestSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(a.files.map((f) => [f.path, f.role]), [
    ["cover-dark.png", "cover"],
    ["cover-light.png", "cover"],
    ["index.html", "page"],
    ["style.css", "asset"],
  ]);
});

test("validateBundle rejects missing cover/page, path traversal, scripts, fonts, and remote CSS URLs", () => {
  assert.throws(() => validateBundle([{ path: "index.html", bytes: HTML }]), /封面/);
  assert.throws(() => validateBundle([{ path: "cover.png", bytes: PNG }]), /index\.html/);
  assert.throws(() => validateBundle([
    { path: "cover.png", bytes: PNG },
    { path: "../index.html", bytes: HTML },
  ]), /路径/);
  assert.throws(() => validateBundle([
    { path: "cover.png", bytes: PNG },
    { path: "index.html", bytes: Buffer.from("<script>alert(1)</script>") },
  ]), /禁止/);
  assert.throws(() => validateBundle([
    { path: "cover.png", bytes: PNG },
    { path: "index.html", bytes: HTML },
    { path: "style.css", bytes: Buffer.from("@font-face { src: url(a.woff2); }") },
  ]), /禁止/);
  assert.throws(() => validateBundle([
    { path: "cover.png", bytes: PNG },
    { path: "index.html", bytes: HTML },
    { path: "style.css", bytes: Buffer.from("body { background: url(https://evil.invalid/a.png); }") },
  ]), /禁止/);
});
