import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { FeedCard } from "./feedClient.ts";
import {
  applyFollow,
  clampPage,
  contentBand,
  coverSurface,
  deviceSafeRect,
  EMPTY_ACTION,
  EMPTY_BODY,
  EMPTY_TITLE,
  fractionClearsOverlays,
  scopeAfterSwipe,
  showsAttribution,
  statusIcons,
  surfaceColor,
} from "./immersive.ts";

const info = card("00000000-0000-4000-8000-0000000000c1", "三个入口：今日、对话、知识库");
const english = card("00000000-0000-4000-8000-0000000000c2", "get this over the line");

test("the two published covers keep their surfaces and a third card does not borrow one", () => {
  assert.equal(coverSurface(info.id), "paper");
  assert.equal(coverSurface(english.id), "orange");
  assert.equal(coverSurface("00000000-0000-4000-8000-000000000099"), "system");
  assert.equal(surfaceColor("orange", "dark"), "#FF6A2B");
  assert.equal(surfaceColor("paper", "light"), "#F3EFE7");
  assert.equal(surfaceColor("paper", "dark"), "#171614");
  assert.equal(statusIcons("orange", "dark"), "dark");
  assert.equal(statusIcons("paper", "light"), "dark");
  assert.equal(statusIcons("paper", "dark"), "light");
  assert.equal(statusIcons("system", "dark"), "light");
});

test("the text band follows the real status inset and leaves the native row clear", () => {
  const short = contentBand({ topInset: 24 });
  const tall = contentBand({ topInset: 52 });
  assert.equal(short.paddingTop, 24 + 6 + 36 + 16);
  assert.equal(tall.paddingTop, 52 + 6 + 36 + 16);
  assert.equal(short.paddingBottom, 8 + 44 + 16);
  assert.equal(showsAttribution("empty"), false);
  assert.equal(showsAttribution("card"), true);
});

test("a real status inset moves the safe rect and the published titles stay clear", () => {
  const narrow = deviceSafeRect({ width: 390, height: 760, topInset: 24, bottomInset: 20 });
  const wide = deviceSafeRect({ width: 840, height: 700, topInset: 32, bottomInset: 16 });
  assert.ok(narrow.top > 24);
  assert.ok(wide.top > 32);
  assert.notEqual(narrow.top, wide.top);
  assert.equal(fractionClearsOverlays(0.27, { height: 760, topInset: 24 }), true);
  assert.equal(fractionClearsOverlays(0.04, { height: 760, topInset: 24 }), false);
  assert.equal(fractionClearsOverlays(0.97, { height: 760, topInset: 24 }), false);
});

test("a horizontal swipe changes source once and a vertical move does not", () => {
  assert.equal(scopeAfterSwipe("following", -80, 10), "recommended");
  assert.equal(scopeAfterSwipe("recommended", 80, 4), "following");
  assert.equal(scopeAfterSwipe("following", 80, 4), "following");
  assert.equal(scopeAfterSwipe("recommended", -80, 4), "recommended");
  assert.equal(scopeAfterSwipe("following", -20, 4), "following");
  assert.equal(scopeAfterSwipe("following", -80, 90), "following");
});

test("unfollowing hides the card on 关注 and leaves it on 推荐", () => {
  const followed = applyFollow([info, english], info.bot.id, false, "following");
  assert.deepEqual(followed.map((item) => item.id), []);
  const recommended = applyFollow([info, english], info.bot.id, false, "recommended");
  assert.equal(recommended.length, 2);
  assert.equal(recommended.every((item) => item.bot.followed === false), true);
  assert.equal(clampPage(3, 1), 0);
  assert.equal(clampPage(1, 0), 0);
});

test("the today screen does not replace the published works with the sample board", () => {
  const source = [
    readFileSync(new URL("./CardFeed.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("./CoverFace.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("./immersive.ts", import.meta.url), "utf8"),
  ].join("\n");
  for (const phrase of ["今天，先看这三件事", "今日三件事", "样例", "音频尚未接通", "波形为版式示意", "AI DAILY SIGNAL"]) {
    assert.equal(source.includes(phrase), false, phrase);
  }
  assert.equal(source.includes("三个入口：今日、对话、知识库"), true);
  assert.equal(source.includes("Let's get that over the line today, so marketing can schedule spend tonight."), true);
  assert.equal(source.includes("没有音频，也没有跟读打分。"), true);
  assert.equal(source.includes(EMPTY_TITLE), true);
  assert.equal(source.includes(EMPTY_BODY), true);
  assert.equal(source.includes(EMPTY_ACTION), true);
  assert.equal(source.includes("resizeMode=\"cover\""), true);
  assert.equal(source.includes("resizeMode=\"contain\""), false);
});

function card(id: string, title: string): FeedCard {
  return {
    id,
    title,
    publishedAt: "2026-11-21T09:21:18.000Z",
    visibility: "public",
    provenance: "manual",
    artifactId: id,
    artifactVersion: 1,
    manifestSha256: "",
    coverPath: "cover.png",
    bot: { id: "00000000-0000-4000-8000-0000000000a1", slug: "qbot", displayName: "Qbot", followed: true },
  };
}
