import {
  AssistantStream,
  AssistantTransportDecoder,
  PlainTextDecoder,
  type AssistantStreamChunk,
} from "assistant-stream";
import { throwIfAborted, type ChatTransport, type ChatTurn } from "./transport.ts";

export type HttpStreamOptions = {
  /** Absolute URL of a streaming endpoint. The app never supplies one. */
  url: string;
  fetchImpl?: typeof fetch;
};

/**
 * Generic streaming HTTP client. `text/event-stream` is assistant-ui's SSE
 * encoding; anything else is read as chunked plain text. There is no default
 * address, and the chat screen does not call this.
 */
export function createHttpStreamTransport(options: HttpStreamOptions): ChatTransport {
  const url = options.url;
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    label: "流式 HTTP（未接入）",
    reply(history, signal) {
      return readDeltas(fetchImpl, url, history, signal);
    },
  };
}

async function* readDeltas(
  fetchImpl: typeof fetch,
  url: string,
  history: readonly ChatTurn[],
  signal: AbortSignal,
): AsyncGenerator<string> {
  throwIfAborted(signal);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "text/event-stream, text/plain",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messages: history }),
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`chat stream HTTP ${response.status}`);
  }
  if (!response.body) throw new Error("chat stream has no body");
  const contentType = response.headers.get("content-type") ?? "";
  const decoder = contentType.includes("text/event-stream")
    ? new AssistantTransportDecoder()
    : new PlainTextDecoder();
  const reader = AssistantStream.fromResponse(response, decoder).getReader();
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) return;
      if (value.type === "error") throw new Error("chat stream failed");
      if (isTextDelta(value) && value.textDelta) yield value.textDelta;
    }
  } finally {
    reader.releaseLock();
  }
}

function isTextDelta(value: AssistantStreamChunk): value is AssistantStreamChunk & { type: "text-delta"; textDelta: string } {
  return value.type === "text-delta";
}
