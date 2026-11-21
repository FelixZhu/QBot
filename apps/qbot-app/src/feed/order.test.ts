import assert from "node:assert/strict";
import { test } from "node:test";
import { orderTodayFeed, todayHasUnread } from "./order.ts";

test("today's samples lead and old lessons stay behind them", () => {
  const slots = orderTodayFeed([]);
  assert.deepEqual(slots.slice(0, 3).map((slot) => slot.key), ["demo-info", "demo-english", "demo-study"]);
  assert.equal(slots[3]?.key, "day-01");
  assert.equal(slots.some((slot) => slot.kind === "done"), false);
  assert.equal(todayHasUnread([]), true);
});

test("seen cards sink and a finished day opens on the closing card", () => {
  const read = ["demo-info", "demo-english", "demo-study", "day-01"];
  const slots = orderTodayFeed(read);
  assert.equal(slots[0]?.kind, "done");
  assert.equal(slots[1]?.key, "day-02");
  assert.deepEqual(slots.slice(-4).map((slot) => slot.key), ["demo-info", "demo-english", "demo-study", "day-01"]);
  assert.equal(todayHasUnread(read), false);
});
