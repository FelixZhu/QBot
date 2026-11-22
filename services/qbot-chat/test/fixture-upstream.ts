import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
/** Local stand-in for OpenRouter. Not a model, and not an acceptance test of one. */
const FIXTURE_HEADER = "x-qbot-fixture";
const FIXTURE_VALUE = "openrouter-sse-not-a-model";
export const FIXTURE_REPLY = "夹具固定句";

export type FixtureMode = "ok" | "status" | "break" | "hold";
export type FixtureHit = { authorization: string | null; body: unknown };

export async function startFixture(): Promise<{
  url: string;
  hits: FixtureHit[];
  mode: { current: FixtureMode };
  expectedKey: string;
  close: () => Promise<void>;
}> {
  const hits: FixtureHit[] = [];
  const mode: { current: FixtureMode } = { current: "ok" };
  const expectedKey = "fixture-openrouter-key-not-a-secret";
  const server = createServer(async (req, res) => {
    const raw = await readBody(req);
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw;
    }
    hits.push({ authorization: req.headers.authorization ?? null, body });
    if (req.headers.authorization !== `Bearer ${expectedKey}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "fixture rejected the model key" } }));
      return;
    }
    if (mode.current === "status") {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "fixture-secret-body" } }));
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      [FIXTURE_HEADER]: FIXTURE_VALUE,
    });
    if (mode.current === "hold") {
      res.write(chunk("半", null));
      await new Promise<void>((resolve) => req.on("close", () => resolve()));
      if (!res.writableEnded) res.end();
      return;
    }
    if (mode.current === "break") {
      res.write(chunk("断", null));
      res.write(`data: ${JSON.stringify({ error: { message: "fixture break" } })}\n\n`);
      res.end();
      return;
    }
    res.write(chunk("夹具", null));
    res.write(chunk("固定句", null));
    res.write(chunk(null, "stop"));
    res.write("data: [DONE]\n\n");
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture has no port");
  return {
    url: `http://127.0.0.1:${address.port}/v1/chat/completions`,
    hits,
    mode,
    expectedKey,
    close: () => new Promise((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

function chunk(content: string | null, finish: string | null): string {
  return `data: ${JSON.stringify({
    id: "fixture-not-a-model",
    object: "chat.completion.chunk",
    model: "deepseek/deepseek-v4.1-flash-1017",
    choices: [{ index: 0, delta: content == null ? {} : { content }, finish_reason: finish }],
  })}\n\n`;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export function sseEvents(chunks: string[]): string {
  return chunks.join("");
}

export async function readSse(res: Response): Promise<string[]> {
  if (!res.body) throw new Error("missing body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const data = part.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
      if (data) events.push(data);
    }
  }
  return events;
}
