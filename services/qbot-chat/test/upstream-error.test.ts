import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DSH_NODE_OPTIONS } from "../src/runtime/dsh.ts";
import { upstreamLogLine, userTextForUpstream } from "../src/runtime/upstream-error.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("an ETIMEDOUT transport failure is logged without secrets and asks for another send", () => {
  const secret = ["sk", "or", "testsecretvalue"].join("-");
  const detail = `Connection error.: AggregateError (ETIMEDOUT) code TRANSPORT ${secret}`;
  const line = upstreamLogLine(detail, secret);
  assert.match(line, /code=ETIMEDOUT/);
  assert.match(line, /TRANSPORT/);
  assert.equal(line.includes(secret), false);
  assert.equal(line.includes(["sk", "or"].join("-")), false);
  assert.equal(userTextForUpstream(detail, false), "网络暂时连不上模型，请再发一次");
  assert.equal(userTextForUpstream(detail, true), "回复中断了，请再发一次");
  assert.equal(userTextForUpstream("provider refused the prompt", false), "模型上游中断");
});

test("the DSH child prefers IPv4 and retries a transport error inside the same turn", () => {
  const patch = readFileSync(path.join(root, "dsh", "qbot.cordis.patch.yml"), "utf8");
  assert.match(patch, /maxRetries: 2/);
  assert.equal(patch.includes("maxRetries: 0"), false);
  assert.match(DSH_NODE_OPTIONS, /--dns-result-order=ipv4first/);
  assert.match(DSH_NODE_OPTIONS, /--no-network-family-autoselection/);
  const result = spawnSync(process.execPath, ["-e", "const dns=require('node:dns'); const net=require('node:net'); process.stdout.write(dns.getDefaultResultOrder()+','+String(net.getDefaultAutoSelectFamily()))"], {
    env: { ...process.env, NODE_OPTIONS: DSH_NODE_OPTIONS },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "ipv4first,false");
});
