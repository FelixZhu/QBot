import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the qbot patch unmounts coding tools and declares the OpenRouter model", () => {
  const bin = path.join(path.dirname(require.resolve("@deepseek-ai/dsh/package.json")), "lib", "bin.js");
  const patch = path.join(root, "dsh", "qbot.cordis.patch.yml");
  const result = spawnSync(process.execPath, [bin, "--profile", "sdk-minimal", "--patch", patch, "--dump-config"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const text = result.stdout;
  for (const id of ["persistent-bash", "persistent-pwsh", "terminal-bash", "tool-fs", "tool-working-directory", "sandbox-policy"]) {
    const block = text.split(`- id: ${id}`)[1]?.split("- id:")[0] ?? "";
    assert.match(block, /disabled: true/, id);
  }
  assert.match(text, /id: llm-pi-ai/);
  assert.match(text, /deepseek\/deepseek-v4\.1-flash-1017/);
  assert.equal(text.includes("sk-or-"), false);
});
