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
  yield* readAssistantDeltas(response, signal);
}

/** Shared SSE reader for the generic client and the authenticated server client. */
export async function* readAssistantDeltas(response: Response, signal: AbortSignal): AsyncGenerator<string> {
  const contentType = response.headers.get("content-type") ?? "";
  const decoder = contentType.includes("text/event-stream")
    ? new AssistantTransportDecoder()
    : new PlainTextDecoder();
  const reader = AssistantStream.fromResponse(response, decoder).getReader();
  const stop = () => {
    void reader.cancel().catch(() => {});
    void response.body?.cancel().catch(() => {});
  };
  if (signal.aborted) {
    stop();
    throwIfAborted(signal);
  }
  const onAbort = () => stop();
  signal.addEventListener("abort", onAbort);
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await readOrAbort(reader, signal);
      if (done) return;
      const failure = streamError(value);
      if (failure) throw new Error(failure);
      if (isTextDelta(value) && value.textDelta) yield value.textDelta;
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

/** A blocked body read has to reject when stop is pressed, and drop the socket. */
function readOrAbort(
  reader: ReadableStreamDefaultReader<AssistantStreamChunk>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<AssistantStreamChunk>> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      void reader.cancel().catch(() => {});
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function streamError(value: AssistantStreamChunk): string | null {
  if (value.type !== "error") return null;
  const detail = "error" in value && typeof value.error === "string" ? value.error : "";
  return detail.replace(/^Error:\s*/, "").trim() || "chat stream failed";
}

function isTextDelta(value: AssistantStreamChunk): value is AssistantStreamChunk & { type: "text-delta"; textDelta: string } {
  return value.type === "text-delta";
}
