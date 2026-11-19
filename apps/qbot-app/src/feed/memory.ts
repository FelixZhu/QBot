/** On-device card ids for the fictional feed. No names, media, or network. */

export const FEED_MEMORY_KEY = "qbot.feed.memory.v1";

export type FeedMemory = {
  read: string[];
  interest: string[];
  dismissed: string[];
};

export type FeedStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export const EMPTY_FEED_MEMORY: FeedMemory = { read: [], interest: [], dismissed: [] };

export function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) continue;
    ids.push(item);
  }
  return uniqueIds(ids);
}

export function parseFeedMemory(raw: unknown): FeedMemory {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return EMPTY_FEED_MEMORY;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_FEED_MEMORY;
  const record = value as Record<string, unknown>;
  return {
    read: idList(record.read),
    interest: idList(record.interest),
    dismissed: idList(record.dismissed),
  };
}

export function retainKnown(memory: FeedMemory, knownIds: readonly string[]): FeedMemory {
  const known = new Set(knownIds);
  const keep = (ids: readonly string[]) => uniqueIds(ids).filter((id) => known.has(id));
  return {
    read: keep(memory.read),
    interest: keep(memory.interest),
    dismissed: keep(memory.dismissed),
  };
}

export function rememberRead(memory: FeedMemory, id: string): FeedMemory {
  if (id.length === 0 || memory.read.includes(id)) return memory;
  return { ...memory, read: [...memory.read, id] };
}

export function rememberInterest(memory: FeedMemory, id: string): FeedMemory {
  if (id.length === 0 || memory.interest.includes(id)) return memory;
  return { ...memory, interest: [...memory.interest, id] };
}

export function dismissCard(memory: FeedMemory, id: string): FeedMemory {
  if (id.length === 0) return memory;
  const without = memory.dismissed.filter((item) => item !== id);
  if (without.length === memory.dismissed.length - 1 && memory.dismissed.at(-1) === id) return memory;
  return { ...memory, dismissed: [...without, id] };
}

export function undoDismiss(memory: FeedMemory): FeedMemory {
  if (memory.dismissed.length === 0) return memory;
  return { ...memory, dismissed: memory.dismissed.slice(0, -1) };
}

export function arrangeFeed<T extends { id: string }>(cards: readonly T[], memory: FeedMemory): T[] {
  const dismissed = new Set(memory.dismissed);
  const read = new Set(memory.read);
  const seen = new Set<string>();
  const unread: T[] = [];
  const alreadyRead: T[] = [];
  for (const card of cards) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    if (dismissed.has(card.id)) continue;
    if (read.has(card.id)) alreadyRead.push(card);
    else unread.push(card);
  }
  return [...unread, ...alreadyRead];
}

export function serializeFeedMemory(memory: FeedMemory, knownIds: readonly string[]): string {
  return JSON.stringify(retainKnown(memory, knownIds));
}

export async function readFeedMemory(store: FeedStore, knownIds: readonly string[]): Promise<FeedMemory> {
  try {
    const raw = await store.getItem(FEED_MEMORY_KEY);
    return retainKnown(parseFeedMemory(raw), knownIds);
  } catch {
    return EMPTY_FEED_MEMORY;
  }
}

export async function writeFeedMemory(store: FeedStore, memory: FeedMemory, knownIds: readonly string[]): Promise<void> {
  await store.setItem(FEED_MEMORY_KEY, serializeFeedMemory(memory, knownIds));
}

/** Keep local writes in the order they were requested, and keep going if one fails. */
export function enqueueFeedWrite(previous: Promise<void>, write: () => Promise<void>): Promise<void> {
  return previous.catch(() => undefined).then(write).catch(() => undefined);
}
