import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ORIGIN = "https://example.invalid";
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("the published origin is a literal process.env read", () => {
  const source = readFileSync(new URL("./serverEndpoint.ts", import.meta.url), "utf8");
  assert.match(source, /const publishedOrigin = process\.env\.EXPO_PUBLIC_QBOT_ORIGIN/);
  assert.equal(source.includes(ORIGIN), false);
});

test("a production android export inlines the origin and no secrets", { timeout: 180_000 }, () => {
  const out = mkdtempSync(path.join(tmpdir(), "qbot-export-"));
  try {
    const result = spawnSync(
      "npx",
      ["expo", "export", "--platform", "android", "--output-dir", out],
      {
        cwd: appRoot,
        env: { ...process.env, EXPO_PUBLIC_QBOT_ORIGIN: ORIGIN, EXPO_NO_TELEMETRY: "1" },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const bundle = readTree(out);
    assert.equal(bundle.includes(ORIGIN), true);
    assert.equal(/sk-or-|sk-ant-|sk-live-|BEGIN [A-Z ]*PRIVATE KEY/.test(bundle), false);
    assert.equal(bundle.includes("OPENROUTER_API_KEY"), false);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

function readTree(root: string): string {
  const chunks: Buffer[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else chunks.push(readFileSync(file));
    }
  };
  walk(root);
  return Buffer.concat(chunks).toString("utf8");
}
