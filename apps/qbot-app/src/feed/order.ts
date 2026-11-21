import type { DemoId } from "./demo/data.ts";
import { LESSON_IDS } from "./lessons.ts";

/** Today's sample slots, in the approved order. These are not live posts. */
export const TODAY_IDS = ["demo-info", "demo-english", "demo-study"] as const;

export type TodayId = (typeof TODAY_IDS)[number];

export type FeedSlot =
  | { key: string; kind: "demo"; demo: DemoId }
  | { key: string; kind: "lesson"; lessonId: string }
  | { key: "done-today"; kind: "done" };

function split(ids: readonly string[], seen: ReadonlySet<string>) {
  return {
    fresh: ids.filter((id) => !seen.has(id)),
    sunk: ids.filter((id) => seen.has(id)),
  };
}

/** New sample slots stay in front. Old lessons are review. Seen cards sink. */
export function orderTodayFeed(read: readonly string[]): FeedSlot[] {
  const seen = new Set(read);
  const today = split(TODAY_IDS, seen);
  const review = split(LESSON_IDS, seen);
  const slots: FeedSlot[] = [];
  if (today.fresh.length === 0) slots.push({ key: "done-today", kind: "done" });
  for (const id of today.fresh) slots.push({ key: id, kind: "demo", demo: id as DemoId });
  for (const id of review.fresh) slots.push({ key: id, kind: "lesson", lessonId: id });
  for (const id of today.sunk) slots.push({ key: id, kind: "demo", demo: id as DemoId });
  for (const id of review.sunk) slots.push({ key: id, kind: "lesson", lessonId: id });
  return slots;
}

export function todayHasUnread(read: readonly string[]): boolean {
  const seen = new Set(read);
  return TODAY_IDS.some((id) => !seen.has(id));
}
