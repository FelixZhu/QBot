import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { jcsSha256, sha256Hex } from "../src/card-import/jcs.ts";
import { tinyPng, writeZip, type ZipEntry } from "./zip-writer.ts";

export const OWNER_ID = "00000000-0000-4000-8000-000000000001";
export const IDEMPOTENCY_KEY = "client-label-not-the-unique-key";

const QUOTE = "测试结论 一句话";

export function defaultHtml(): string {
  return `<!doctype html><html><head><link rel="stylesheet" href="assets/page.css"></head><body><p id="c1">${QUOTE}</p></body></html>`;
}

export function packageFiles(html = defaultHtml()): Map<string, Buffer> {
  return new Map<string, Buffer>([
    ["cover-light.png", tinyPng([244, 241, 232])],
    ["cover-dark.png", tinyPng([28, 27, 24])],
    ["work/index.html", Buffer.from(html, "utf8")],
    ["work/assets/page.css", Buffer.from('body{font-family:"Microsoft YaHei",sans-serif}', "utf8")],
  ]);
}

export function draftManifest(): Record<string, unknown> {
  const path = fileURLToPath(new URL("../../../tools/card-package/fixture/manifest.draft.json", import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

export function buildZip(options: {
  html?: string;
  files?: Map<string, Buffer>;
  edit?: (manifest: Record<string, unknown>) => void;
  afterDigest?: (manifest: Record<string, unknown>) => void;
  corruptEntry?: { name: string; bytes: Buffer };
} = {}): Buffer {
  const files = options.files ?? packageFiles(options.html ?? defaultHtml());
  const manifest = draftManifest();
  manifest.files = [...files.keys()].sort().map((path) => fileEntry(path, files.get(path) ?? Buffer.alloc(0)));
  options.edit?.(manifest);
  manifest.contentDigest = { alg: "sha256-jcs", value: jcsSha256(contentInput(manifest)) };
  manifest.manifestDigest = { alg: "sha256-jcs", value: jcsSha256(without(manifest, "manifestDigest")) };
  options.afterDigest?.(manifest);
  const stored = new Map(files);
  if (options.corruptEntry) stored.set(options.corruptEntry.name, options.corruptEntry.bytes);
  const entries: ZipEntry[] = [
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest), "utf8") },
    ...[...stored.keys()].sort().map((name) => ({ name, data: stored.get(name) ?? Buffer.alloc(0) })),
  ];
  return writeZip(entries);
}

function fileEntry(path: string, bytes: Buffer): Record<string, unknown> {
  const role = path.startsWith("cover") ? "cover" : path === "work/index.html" ? "page" : "asset";
  const extension = path.slice(path.lastIndexOf("."));
  const contentType = extension === ".png"
    ? "image/png"
    : extension === ".html"
      ? "text/html; charset=utf-8"
      : "text/css; charset=utf-8";
  return { path, role, sha256: sha256Hex(bytes), bytes: bytes.length, contentType };
}

function contentInput(manifest: Record<string, unknown>): unknown {
  const card = manifest.card as { title: string };
  const claims = manifest.claims as Record<string, unknown>[];
  const files = manifest.files as Record<string, unknown>[];
  const sources = manifest.sources as Record<string, unknown>[];
  return {
    title: card.title,
    claims: claims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      sourceIds: claim.sourceIds,
      bodyAnchor: claim.bodyAnchor,
    })),
    files: files.map((file) => ({
      path: file.path,
      role: file.role,
      sha256: file.sha256,
      bytes: file.bytes,
      contentType: file.contentType,
    })),
    contentSafe: manifest.contentSafe,
    referenceCanvas: manifest.referenceCanvas,
    sources: sources.map((source) => ({ id: source.id, url: source.url })),
  };
}

function without(manifest: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...manifest };
  delete copy[key];
  return copy;
}
