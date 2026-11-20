import type { ServerMessage } from "./serverClient.ts";

export const THREAD_CACHE_KEY = "qbot.thread.v1";
export const THREAD_CACHE_LIMIT = 50;
export const SYNCING_LABEL = "同步中";
export const STALE_LABEL = "未同步";
export const OPENING_LABEL = "正在打开";

export type ThreadCache = {
  conversationId: string;
  messages: ServerMessage[];
};

const STATUSES = new Set(["complete", "pending", "failed", "cancelled"]);

/** Keep the newest messages and drop anything that is not a chat message. */
export function trimMessages(messages: readonly ServerMessage[], limit = THREAD_CACHE_LIMIT): ServerMessage[] {
  const clean = messages.filter((message) => (
    typeof message.id === "string"
    && (message.role === "user" || message.role === "assistant")
    && typeof message.content === "string"
    && STATUSES.has(message.status)
    && typeof message.createdAt === "string"
  )).map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    status: message.status,
    createdAt: message.createdAt,
  }));
  return clean.slice(-limit);
}

export function messagesEqual(left: readonly ServerMessage[], right: readonly ServerMessage[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((message, index) => {
    const other = right[index];
    return !!other
      && message.id === other.id
      && message.role === other.role
      && message.content === other.content
      && message.status === other.status;
  });
}

export function parseThreadCache(raw: string | null): ThreadCache | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as { conversationId?: unknown; messages?: unknown; token?: unknown; authorization?: unknown };
  if (typeof record.conversationId !== "string" || !record.conversationId) return null;
  if (!Array.isArray(record.messages)) return null;
  if ("token" in record || "authorization" in record) return null;
  const messages = trimMessages(record.messages as ServerMessage[]);
  if (!messages.length) return null;
  return { conversationId: record.conversationId, messages };
}

export function serializeThreadCache(cache: ThreadCache): string {
  return JSON.stringify({
    conversationId: cache.conversationId,
    messages: trimMessages(cache.messages),
  });
}

/** The runtime stays mounted while a later sync replaces messages for the same conversation. */
export function runtimeKey(conversationId: string | null): string | null {
  return conversationId;
}

/** Server messages replace the cache. An identical copy does not bump the revision, so the list stays put. */
export function nextThread(
  current: { messages: readonly ServerMessage[]; revision: number },
  incoming: readonly ServerMessage[],
): { messages: ServerMessage[]; revision: number; sync: "idle" } {
  const messages = trimMessages(incoming);
  if (messagesEqual(current.messages, messages)) {
    return { messages: trimMessages(current.messages), revision: current.revision, sync: "idle" };
  }
  return { messages, revision: current.revision + 1, sync: "idle" };
}
