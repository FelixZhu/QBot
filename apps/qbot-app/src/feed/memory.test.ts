import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  EMPTY_FEED_MEMORY,
  FEED_MEMORY_KEY,
  arrangeFeed,
  dismissCard,
  enqueueFeedWrite,
  parseFeedMemory,
  readFeedMemory,
  rememberInterest,
  rememberRead,
  undoDismiss,
  writeFeedMemory,
  type FeedStore,
} from "./memory.ts";

const ids = ["family-weekend", "friend-island", "studio-film", "studio-objects"];

function memoryStore(initial: string | null = null): FeedStore & { snapshot(): string | null } {
  let value = initial;
  return {
    async getItem(key) {
      assert.equal(key, FEED_MEMORY_KEY);
      return value;
    },
    async setItem(key, next) {
      assert.equal(key, FEED_MEMORY_KEY);
      value = next;
    },
    snapshot() {
      return value;
    },
  };
}

test("the same card id is kept once, and read cards follow unread cards", () => {
  const cards = [
    { id: "family-weekend" },
    { id: "friend-island" },
    { id: "family-weekend" },
    { id: "studio-film" },
    { id: "studio-objects" },
  ];
  const order = cards.map((card) => card.id);
  const memory = rememberRead(EMPTY_FEED_MEMORY, "studio-film");
  const visible = arrangeFeed(cards, memory).map((card) => card.id);
  assert.deepEqual(visible, ["family-weekend", "friend-island", "studio-objects", "studio-film"]);
  assert.deepEqual(cards.map((card) => card.id), order);
});

test("not interested hides a card until the latest dismiss is undone", () => {
  let memory = dismissCard(EMPTY_FEED_MEMORY, "friend-island");
  memory = dismissCard(memory, "studio-film");
  memory = rememberInterest(memory, "friend-island");
  const cards = ids.map((id) => ({ id }));
  assert.deepEqual(arrangeFeed(cards, memory).map((card) => card.id), ["family-weekend", "studio-objects"]);
  memory = undoDismiss(memory);
  assert.deepEqual(memory.dismissed, ["friend-island"]);
  assert.equal(memory.interest.includes("friend-island"), true);
  assert.deepEqual(arrangeFeed(cards, memory).map((card) => card.id), ["family-weekend", "studio-film", "studio-objects"]);
  memory = undoDismiss(memory);
  assert.deepEqual(arrangeFeed(cards, memory).map((card) => card.id), ids);
  assert.equal(undoDismiss(memory), memory);
  memory = dismissCard(dismissCard(dismissCard(EMPTY_FEED_MEMORY, "family-weekend"), "studio-film"), "family-weekend");
  assert.deepEqual(memory.dismissed, ["studio-film", "family-weekend"]);
});

test("interest and read are recorded once", () => {
  const interested = rememberInterest(EMPTY_FEED_MEMORY, "friend-island");
  assert.equal(rememberInterest(interested, "friend-island"), interested);
  const read = rememberRead(interested, "studio-objects");
  assert.equal(rememberRead(read, "studio-objects"), read);
  const hidden = dismissCard(read, "studio-film");
  assert.equal(dismissCard(hidden, "studio-film"), hidden);
});

test("saved feedback reloads, and unknown ids are dropped", async () => {
  const store = memoryStore();
  const memory = dismissCard(
    rememberRead(rememberInterest(EMPTY_FEED_MEMORY, "friend-island"), "family-weekend"),
    "not-a-real-card",
  );
  const withKnownDismiss = dismissCard(memory, "studio-objects");
  await writeFeedMemory(store, withKnownDismiss, ids);
  const raw = store.snapshot();
  assert.equal(raw?.includes("http://"), false);
  assert.equal(raw?.includes("https://"), false);
  assert.equal(raw?.includes("not-a-real-card"), false);
  assert.match(raw ?? "", /"dismissed":\["studio-objects"\]/);
  const loaded = await readFeedMemory(store, ids);
  assert.deepEqual(loaded, {
    read: ["family-weekend"],
    interest: ["friend-island"],
    dismissed: ["studio-objects"],
  });
  const visible = arrangeFeed(ids.map((id) => ({ id })), loaded).map((card) => card.id);
  assert.deepEqual(visible, ["friend-island", "studio-film", "family-weekend"]);
});

test("corrupt or unreadable storage opens as an empty feed memory", async () => {
  assert.deepEqual(parseFeedMemory("not-json"), EMPTY_FEED_MEMORY);
  assert.deepEqual(parseFeedMemory(null), EMPTY_FEED_MEMORY);
  assert.deepEqual(parseFeedMemory({ read: [1, "ok", "ok", ""], interest: "nope", extra: true }), {
    read: ["ok"],
    interest: [],
    dismissed: [],
  });
  const broken: FeedStore = {
    async getItem() {
      throw new Error("disk");
    },
    async setItem() {},
  };
  assert.deepEqual(await readFeedMemory(broken, ids), EMPTY_FEED_MEMORY);
  const refusing: FeedStore = {
    async getItem() {
      return null;
    },
    async setItem() {
      throw new Error("full");
    },
  };
  await assert.rejects(writeFeedMemory(refusing, EMPTY_FEED_MEMORY, ids));
});

test("slower writes cannot overtake a later one", async () => {
  const landed: string[] = [];
  let releaseFirst: () => void = () => {};
  const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let chain = enqueueFeedWrite(Promise.resolve(), () => first.then(() => { landed.push("first"); }));
  chain = enqueueFeedWrite(chain, async () => { landed.push("second"); });
  assert.deepEqual(landed, []);
  releaseFirst();
  await chain;
  assert.deepEqual(landed, ["first", "second"]);

  const afterFailure: string[] = [];
  chain = enqueueFeedWrite(Promise.resolve(), async () => { throw new Error("full"); });
  chain = enqueueFeedWrite(chain, async () => { afterFailure.push("kept"); });
  await chain;
  assert.deepEqual(afterFailure, ["kept"]);
});

test("shipped card ids stay unique and the pane keeps memory on device", () => {
  const cards = readFileSync(new URL("./cards.ts", import.meta.url), "utf8");
  for (const id of ids) {
    assert.equal(cards.match(new RegExp(`id: "${id}"`, "g"))?.length, 1);
  }
  const pane = readFileSync(new URL("./FeedPane.tsx", import.meta.url), "utf8");
  const memory = readFileSync(new URL("./memory.ts", import.meta.url), "utf8");
  const src = `${pane}\n${memory}`;
  assert.match(pane, /@react-native-async-storage\/async-storage/);
  assert.match(pane, /arrangeFeed/);
  assert.match(pane, /撤销/);
  assert.match(pane, /已读/);
  assert.equal(src.includes("http://"), false);
  assert.equal(src.includes("https://"), false);
  assert.equal(src.includes("fetch("), false);
  assert.equal(src.includes("XMLHttpRequest"), false);
  assert.equal(src.includes("WebSocket"), false);
});
