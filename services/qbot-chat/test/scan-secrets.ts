import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const allowedIps = new Set(["127.0.0.1", "10.0.2.2", "0.0.0.0"]);
const secret = /-----BEGIN [A-Z ]*PRIVATE KEY-----\s+[A-Za-z0-9+/=]{16}|sk-or-[A-Za-z0-9]|sk-ant-[A-Za-z0-9]|sk-live-[A-Za-z0-9]|AKIA[0-9A-Z]{16}|LTAI[A-Za-z0-9]{12,}|xox[baprs]-|ghp_[A-Za-z0-9]{20,}/;
const ip = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;

test("tracked source has no keys and no unexpected addresses", () => {
  const files = execFileSync("git", ["ls-files", "-z", "-c", "-o", "--exclude-standard"], { cwd: root }).toString("utf8").split("\0").filter(Boolean);
  const problems: string[] = [];
  for (const file of files) {
    if (file.startsWith("skills/") || file.endsWith(".png")) continue;
    const text = readFileSync(path.join(root, file), "utf8");
    if (secret.test(text)) problems.push(`${file} matched a secret pattern`);
    if (!file.startsWith("services/qbot-chat/") && !file.startsWith("apps/qbot-app/src/") && file !== ".github/workflows/chat-server.yml") continue;
    for (const match of text.match(ip) ?? []) {
      if (!allowedIps.has(match)) problems.push(`${file} has address ${match}`);
    }
  }
  assert.deepEqual(problems, []);
});
