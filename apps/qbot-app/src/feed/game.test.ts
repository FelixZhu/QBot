import assert from "node:assert/strict";
import { test } from "node:test";
import { checkBoard, initialBoard, placeOnBoard, placedCount, returnChip } from "./game.ts";

test("the context toy starts with the fixed prefix and an empty trace", () => {
  const board = initialBoard();
  assert.deepEqual(board.slots, [null, null]);
  assert.equal(placedCount(board), 3);
  assert.equal(checkBoard(board), "empty");
});

test("the right two blocks pass and a distractor does not", () => {
  let board = placeOnBoard(initialBoard(), "think", 0);
  board = placeOnBoard(board, "result", 1);
  assert.equal(checkBoard(board), "right");
  assert.equal(placedCount(board), 5);
  board = placeOnBoard(board, "noise", 1);
  assert.equal(checkBoard(board), "wrong");
  assert.equal(board.pool.includes("result"), true);
  board = returnChip(board, 1);
  assert.equal(board.slots[1], null);
  assert.equal(checkBoard(board), "empty");
});
