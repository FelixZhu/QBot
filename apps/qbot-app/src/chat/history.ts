import type { ExportedMessageRepository, ExportedMessageRepositoryItem, ThreadHistoryAdapter } from "@assistant-ui/react-native";

/** Same shape assistant-ui's local storage adapter accepts. */
export type ChatStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const KEY_PREFIX = "qbot-demo-history:";

/**
 * Per-demo history for `useLocalRuntime`'s `adapters.history`.
 * The runtime still owns the messages; this only stores the repository it
 * already exports, on this device. An empty load leaves the scripted demo in
 * place. The first send writes that script, then the new turns.
 */
export function createDemoHistory(storage: ChatStorage, demoId: string): ThreadHistoryAdapter {
  const key = `${KEY_PREFIX}${demoId}`;
  let tail: Promise<void> = Promise.resolve();
  const run = <T>(op: () => Promise<T>): Promise<T> => {
    const result = tail.then(op, op);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  const read = async (): Promise<ExportedMessageRepository> => {
    const raw = await storage.getItem(key);
    if (!raw) return { messages: [] };
    try {
      return reviveRepository(JSON.parse(raw));
    } catch {
      return { messages: [] };
    }
  };
  const write = (repo: ExportedMessageRepository) => storage.setItem(key, JSON.stringify(repo));
  const upsert = async (item: ExportedMessageRepositoryItem, moveHead: boolean) => {
    const repo = await read();
    const idx = repo.messages.findIndex((entry) => entry.message.id === item.message.id);
    if (idx >= 0) repo.messages[idx] = item;
    else repo.messages.push(item);
    if (moveHead) repo.headId = item.message.id;
    await write(repo);
  };
  return {
    scopeId: demoId,
    load: () => run(read),
    append: (item) => run(() => upsert(item, true)),
    update: (item) => run(() => upsert(item, false)),
  };
}

export function createMemoryStorage(): ChatStorage {
  const items = new Map<string, string>();
  return {
    async getItem(key) {
      return items.has(key) ? items.get(key)! : null;
    },
    async setItem(key, value) {
      items.set(key, value);
    },
    async removeItem(key) {
      items.delete(key);
    },
  };
}

function reviveRepository(value: unknown): ExportedMessageRepository {
  if (!value || typeof value !== "object") return { messages: [] };
  const record = value as { headId?: unknown; messages?: unknown };
  if (!Array.isArray(record.messages)) return { messages: [] };
  const messages = record.messages.flatMap((item) => {
    const revived = reviveItem(item);
    return revived ? [revived] : [];
  });
  const ids = new Set(messages.map((item) => item.message.id));
  const head = record.headId;
  if (head === null || (typeof head === "string" && ids.has(head))) return { headId: head, messages };
  return { messages };
}

function reviveItem(value: unknown): ExportedMessageRepositoryItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as { parentId?: unknown; message?: unknown; runConfig?: unknown };
  if (!item.message || typeof item.message !== "object") return null;
  const message = item.message as { id?: unknown; createdAt?: unknown };
  if (typeof message.id !== "string") return null;
  const parent = item.parentId;
  if (parent !== null && parent !== undefined && typeof parent !== "string") return null;
  const createdAt = reviveDate(message.createdAt);
  return {
    parentId: typeof parent === "string" ? parent : null,
    message: {
      ...(item.message as ExportedMessageRepositoryItem["message"]),
      ...(createdAt ? { createdAt } : {}),
    },
    ...(item.runConfig && typeof item.runConfig === "object" ? { runConfig: item.runConfig as ExportedMessageRepositoryItem["runConfig"] } : {}),
  };
}

function reviveDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
