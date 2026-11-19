import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseFeed } from "./model.ts";

const sample = {
  id: "family-weekend",
  type: "gallery",
  audience: "fictional-public",
  fictional: true,
  source: { name: "家人 · 照片", kind: "family-demo" },
  actions: ["open"],
  kicker: "合成示意",
  title: "寄来一小片周末",
  note: "色块不是照片。",
  caption: "虚构图集",
  frames: ["meadow", "island"],
};

test("a fictional public card parses and drops no private path", () => {
  const [card] = parseFeed([sample]);
  assert.equal(card?.audience, "fictional-public");
  assert.equal(card?.fictional, true);
  assert.equal("path" in (card ?? {}), false);
});

test("a private audience is rejected", () => {
  assert.throws(() => parseFeed([{ ...sample, audience: "private" }]));
});

test("the shipped feed source stays fictional", () => {
  const src = readFileSync(new URL("./cards.ts", import.meta.url), "utf8");
  assert.match(src, /fictional-public/);
  assert.equal(src.includes("audience: \"private\""), false);
  assert.equal(src.includes("http://"), false);
  assert.equal(src.includes("https://"), false);
});
