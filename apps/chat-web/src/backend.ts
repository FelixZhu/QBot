import type { ChatModelAdapter, ThreadMessage } from "@assistant-ui/react";

/** One turn of conversation as the backend sees it: plain text only. */
export type ChatTurn = { role: "user" | "assistant"; text: string };

/**
 * What a backend hands back for one user message.
 * - `whole`: the reply arrives in one piece (Grok Bot webhook + OSS polling).
 * - `stream`: cumulative-or-delta text chunks (an SSE bridge or a direct LLM API).
 */
export type BackendReply =
  | { kind: "whole"; text: Promise<string> }
  | { kind: "stream"; chunks: AsyncIterable<string> };

/**
 * The only thing the chat UI knows about the server. Mock, webhook-polling
 * and streaming implementations all satisfy this; swapping one is a one-line
 * change in main.tsx.
 */
export interface ChatBackend {
  readonly label: string;
  reply(history: readonly ChatTurn[], signal: AbortSignal): BackendReply;
}

function toTurns(messages: readonly ThreadMessage[]): ChatTurn[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      text: m.content.map((p) => (p.type === "text" ? p.text : "")).join(""),
    }));
}

/**
 * Wraps a ChatBackend as an assistant-ui model adapter. A whole reply yields
 * nothing until it lands, so the message stays "running" with no text and the
 * UI shows the thinking state; a stream yields cumulative text as it arrives.
 */
export function toModelAdapter(getBackend: () => ChatBackend): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const reply = getBackend().reply(toTurns(messages), abortSignal);
      if (reply.kind === "whole") {
        const text = await reply.text;
        yield { content: [{ type: "text", text }] };
        return;
      }
      let text = "";
      for await (const chunk of reply.chunks) {
        text += chunk;
        yield { content: [{ type: "text", text }] };
      }
    },
  };
}
