import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CAROUSEL_PAGE_TWO_POINT,
  LESSONS,
  LESSON_IDS,
  LOOP_NODE_4,
  dayLabel,
} from "./lessons.ts";
import {
  EMPTY_REACTIONS,
  LESSON_REACT_KEY,
  parseReactions,
  readReactions,
  toggleReaction,
  writeReactions,
  type FeedStore,
} from "./memory.ts";

const web = readFileSync(new URL("../../../drive-web/template.html", import.meta.url), "utf8");
const lessonsSrc = readFileSync(new URL("./lessons.ts", import.meta.url), "utf8");
const feedDir = new URL("./", import.meta.url);
const feedSrc = readdirSync(feedDir)
  .filter((name) => name.endsWith(".tsx") && name !== "FeedPane.tsx")
  .sort()
  .map((name) => readFileSync(new URL(name, feedDir), "utf8"))
  .join("\n");
const appSrc = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");

const locked = [
  LOOP_NODE_4,
  CAROUSEL_PAGE_TWO_POINT.title,
  CAROUSEL_PAGE_TWO_POINT.body,
  "3 个要点 · 8 分钟 · 3:20",
  "精读《深入理解 AI Agent》· 第 1 章",
  "待核原文",
  "小节号待核",
  "30 秒",
];

test("the six lessons keep the corrected web copy", () => {
  assert.equal(LESSONS.length, 6);
  assert.deepEqual(LESSONS.map((lesson) => lesson.day), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(LESSON_IDS, ["day-01", "day-02", "day-03", "day-04", "day-05", "day-06"]);
  assert.equal(dayLabel(1), "DAY 01 / 30");
  assert.equal(dayLabel(6), "DAY 06 / 30");
  assert.equal(LESSONS[1]?.floatSub, "3 个要点 · 8 分钟 · 3:20");
  assert.equal(LESSONS[4]?.chip, "精读《深入理解 AI Agent》· 第 1 章");
  assert.equal(LESSONS[2]?.kind, "carousel");
  assert.equal(CAROUSEL_PAGE_TWO_POINT.title.length > 0, true);
  for (const phrase of locked) {
    assert.equal(web.includes(phrase), true, phrase);
    assert.equal(lessonsSrc.includes(phrase) || feedSrc.includes(phrase), true, phrase);
  }
  assert.equal(lessonsSrc.includes("结果追加进上下文"), false);
  assert.equal(web.includes("结果追加进上下文"), false);
  assert.match(web, /!state\.quiz && btn\.getAttribute\("data-tab"\) === state\.tab/);
  assert.match(web, /#pf-root \.pf-sbody\{[^}]*scrollbar-width:none/);
  assert.match(web, /data-day="2"\] \.pf-main\{bottom:88px/);
});

test("the today tab mounts the card feed, not the lesson feed", () => {
  assert.match(appSrc, /CardFeed/);
  assert.equal(appSrc.includes("LessonFeed"), false);
  assert.equal(appSrc.includes("FeedPane"), false);
  assert.match(appSrc, /colors\.accent/);
  assert.match(appSrc, /RAIL_WIDTH/);
  assert.equal(appSrc.includes("#F5A623"), false);
  assert.match(appSrc, /TAB_HEIGHT = 56/);
  assert.match(appSrc, /fontSize: 12/);
  assert.match(appSrc, /lineHeight: 16/);
  assert.match(appSrc, /marginTop: 4/);
  const tabSrc = readFileSync(new URL("../TabBarIcon.tsx", import.meta.url), "utf8");
  assert.match(tabSrc, /width: 24, height: 24/);
  assert.match(appSrc, /今日/);
  assert.equal(appSrc.includes("发现"), false);
  assert.equal(appSrc.includes("主动服务"), false);
  assert.match(feedSrc, /pagingEnabled/);
  assert.match(feedSrc, /nextFeedPage/);
  assert.match(feedSrc, /rememberRead/);
  assert.match(feedSrc, /Study Bot/);
  assert.match(feedSrc, /关注/);
  assert.match(feedSrc, /返回信息流/);
  assert.match(feedSrc, /模拟/);
  assert.match(feedSrc, /演示/);
  assert.match(feedSrc, /显示答案/);
  assert.match(feedSrc, /30 秒小测/);
  assert.match(feedSrc, /showsVerticalScrollIndicator=\{false\}/);
  assert.match(feedSrc, /marginTop: 8/);
  assert.equal(feedSrc.includes("点赞"), false);
  assert.equal(feedSrc.includes("看讲义"), false);
  const carouselStart = feedSrc.indexOf("function CarouselPage");
  const carouselEnd = feedSrc.indexOf("function CarouselSlide");
  assert.equal(carouselStart >= 0 && carouselEnd > carouselStart, true);
  const carousel = feedSrc.slice(carouselStart, carouselEnd);
  assert.equal(carousel.includes("ScrollView"), false);
  assert.match(carousel, /overflow: "hidden"/);
  assert.equal(feedSrc.includes("expo-video"), false);
  assert.equal(feedSrc.includes(".woff"), false);
  assert.equal(feedSrc.includes(".ttf"), false);
  assert.equal(feedSrc.includes("http://"), false);
  assert.equal(feedSrc.includes("https://"), false);
});

test("like, star, and check stay on this device and drop unknown lessons", async () => {
  let saved: string | null = null;
  const store: FeedStore = {
    async getItem(key) {
      assert.equal(key, LESSON_REACT_KEY);
      return saved;
    },
    async setItem(key, value) {
      assert.equal(key, LESSON_REACT_KEY);
      saved = value;
    },
  };
  let reactions = toggleReaction(EMPTY_REACTIONS, "like", "day-01");
  reactions = toggleReaction(reactions, "star", "day-03");
  reactions = toggleReaction(reactions, "check", "day-02");
  reactions = toggleReaction(reactions, "like", "not-a-lesson");
  assert.equal(toggleReaction(reactions, "like", "day-01").like.includes("day-01"), false);
  await writeReactions(store, reactions, LESSON_IDS);
  assert.equal(saved?.includes("http://"), false);
  assert.equal(saved?.includes("not-a-lesson"), false);
  const loaded = await readReactions(store, LESSON_IDS);
  assert.deepEqual(loaded, { like: ["day-01"], star: ["day-03"], check: ["day-02"] });
  assert.deepEqual(parseReactions("nope"), EMPTY_REACTIONS);
});
