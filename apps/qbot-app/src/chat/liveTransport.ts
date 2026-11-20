import { readAssistantDeltas } from "./httpStream.ts";
import { throwIfAborted, type ChatTransport } from "./transport.ts";

/** Sends only the newest user text. The server rebuilds persona and history. */
export function createServerChatTransport(options: {
  url: string;
  token?: string;
  fetchImpl?: typeof fetch;
  onStart?: () => void;
  onError?: (message: string) => void;
}): ChatTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    label: "服务器",
    reply(history, signal) {
      const text = [...history].reverse().find((turn) => turn.role === "user")?.text.trim() ?? "";
      if (!text) throw new Error("没有要发送的文字");
      options.onStart?.();
      return postText(fetchImpl, options.url, options.token, text, signal, options.onError);
    },
  };
}

async function* postText(
  fetchImpl: typeof fetch,
  url: string,
  token: string | undefined,
  text: string,
  signal: AbortSignal,
  onError?: (message: string) => void,
): AsyncGenerator<string> {
  throwIfAborted(signal);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
      signal,
    });
  } catch (error) {
    throw report(error, token, onError);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    await response.body?.cancel().catch(() => {});
    throw report(new Error(readError(response.status, body)), token, onError);
  }
  try {
    yield* readAssistantDeltas(response, signal);
  } catch (error) {
    throw report(error, token, onError);
  }
}

function readError(status: number, text: string): string {
  try {
    const body = JSON.parse(text) as { error?: { message?: string } };
    if (typeof body.error?.message === "string" && body.error.message) return body.error.message;
  } catch {
    // Keep the status.
  }
  return `服务器返回 HTTP ${status}`;
}

function report(error: unknown, token: string | undefined, onError?: (message: string) => void): Error {
  const raw = error instanceof Error ? error.message : "chat stream failed";
  const message = token ? raw.split(token).join("[redacted]") : raw;
  onError?.(message);
  return new Error(message);
}
