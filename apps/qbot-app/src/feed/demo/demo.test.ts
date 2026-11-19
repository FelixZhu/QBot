import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { DEMO_IDS, ENGLISH, INFO, STUDY, heroIssue } from "./data.ts";

test("the info hero is a short figure already written in the card", () => {
  const source = `${INFO.title}\n${INFO.hook}\n${INFO.signals.map((item) => item.body).join("\n")}`;
  assert.equal(heroIssue(INFO.hero, source), null);
  assert.equal(heroIssue("$83", source), "not in the card text");
  assert.equal(heroIssue("810亿", source), "bad characters");
  assert.equal(heroIssue("12345", source), "too long");
  assert.equal(heroIssue(undefined, source), null);
});

test("demo accounts are samples without follower counts or live links", () => {
  assert.deepEqual(DEMO_IDS, ["demo-info", "demo-english", "demo-study"]);
  const dir = new URL("./", import.meta.url);
  const src = readdirSync(dir)
    .filter((name) => (name.endsWith(".ts") || name.endsWith(".tsx")) && !name.endsWith(".test.ts"))
    .map((name) => readFileSync(new URL(name, dir), "utf8"))
    .join("\n");
  assert.match(src, /样例/);
  assert.match(src, /模拟/);
  assert.match(src, /演示/);
  assert.equal(src.includes("粉丝"), false);
  assert.equal(src.includes("http://"), false);
  assert.equal(src.includes("https://"), false);
  assert.equal(src.includes("孩子"), false);
  assert.equal(src.includes("体检"), false);
  assert.match(ENGLISH.why, /开会常用/);
  assert.match(STUDY.formula, /2N/);
  assert.equal(INFO.thumbs.filter((thumb) => thumb.hero).length, 1);
});
