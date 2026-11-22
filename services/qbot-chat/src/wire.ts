import { AssistantStream, AssistantTransportEncoder, createAssistantStream } from "assistant-stream";
import type { ServerResponse } from "node:http";

/** assistant-ui SSE used by the existing app transport. This is a wire codec, not a model runtime. */
export async function writeAssistantSse(res: ServerResponse, run: (append: (delta: string) => void) => Promise<void>): Promise<void> {
  const encoder = new AssistantTransportEncoder();
  const headers = Object.fromEntries(encoder.headers.entries());
  headers["Cache-Control"] = "no-cache, no-transform";
  headers["X-Accel-Buffering"] = "no";
  headers["X-Content-Type-Options"] = "nosniff";
  res.writeHead(200, headers);
  const stream = createAssistantStream(async (controller) => {
    await run((delta) => {
      if (delta) controller.appendText(delta);
    });
  });
  const reader = AssistantStream.toByteStream(stream, encoder).getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || res.destroyed) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise((resolve) => res.once("drain", resolve));
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (!res.writableEnded) res.end();
}
