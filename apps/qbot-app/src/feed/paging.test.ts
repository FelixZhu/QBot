import assert from "node:assert/strict";
import { test } from "node:test";
import { nextFeedPage } from "./paging.ts";

test("a small drag stays on the current lesson", () => {
  assert.equal(nextFeedPage(0, 20, 800, 6), 0);
  assert.equal(nextFeedPage(2, 1600 + 40, 800, 6), 2);
  assert.equal(nextFeedPage(2, 1600 - 40, 800, 6), 2);
});

test("one gesture moves at most one lesson, even if the fling travels further", () => {
  assert.equal(nextFeedPage(0, 800 * 0.2, 800, 6), 1);
  assert.equal(nextFeedPage(0, 800 * 4.8, 800, 6), 1);
  assert.equal(nextFeedPage(3, 800 * 3 - 800 * 0.3, 800, 6), 2);
  assert.equal(nextFeedPage(3, 0, 800, 6), 2);
});

test("paging stops at the ends", () => {
  assert.equal(nextFeedPage(0, -400, 800, 6), 0);
  assert.equal(nextFeedPage(5, 800 * 9, 800, 6), 5);
  assert.equal(nextFeedPage(0, 10, 0, 6), 0);
  assert.equal(nextFeedPage(1, 10, 800, 0), 0);
});
