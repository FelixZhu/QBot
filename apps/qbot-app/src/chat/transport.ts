import type { ChatModelAdapter } from "@assistant-ui/react-native";

/** One turn, as a transport sees it. Plain text only. */
export type ChatTurn = { role: "user" | "assistant"; text: string };

/**
 * Where a reply comes from. The local demo and the streaming HTTP client both
 * satisfy this. The app uses the local one; nothing here has a server address.
 */
export interface ChatTransport {
  readonly label: string;
  /** Yields text deltas. The model adapter assembles them into the full reply. */
  reply(history: readonly ChatTurn[], signal: AbortSignal): AsyncIterable<string>;
}

export function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  throw error;
}

export function messageText(message: { content: unknown }): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (!part || typeof part !== "object") return "";
    const record = part as { type?: string; text?: string };
    return record.type === "text" && typeof record.text === "string" ? record.text : "";
  }).join("");
}

export function toTurns(messages: readonly { role: string; content: unknown }[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    turns.push({ role: message.role, text: messageText(message) });
  }
  return turns;
}

/**
 * assistant-ui model adapter. Each yield is the full text so far, matching
 * the two-step local demo the thread already shows.
 */
export function toModelAdapter(transport: ChatTransport): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      let text = "";
      for await (const delta of transport.reply(toTurns(messages), abortSignal)) {
        text += delta;
        yield { content: [{ type: "text", text }] };
      }
    },
  };
}
