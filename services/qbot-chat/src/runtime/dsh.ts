import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";
import type { HarnessNotification } from "@deepseek-ai/dsh-sdk-client";
import { DEFAULT_MODEL } from "../config.ts";
import { SERVER_PERSONA } from "./persona.ts";

const PATCH = fileURLToPath(new URL("../../dsh/qbot.cordis.patch.yml", import.meta.url));

export type DshTurn = {
  sessionId: string | null;
  text: string;
  signal: AbortSignal;
  onSession?: (sessionId: string) => Promise<void>;
};

/**
 * One shared DSH process for every conversation. Sessions are rows in its home, not processes.
 * Official SDK 0.2.2-rc.5 has no per-session cancel method; aborting a turn closes this process.
 */
export type ConversationEngine = {
  readonly engine: "dsh";
  readonly id: "openrouter" | "fixture";
  run(turn: DshTurn): AsyncIterable<string> & { sessionId: () => string | null };
  close(): Promise<void>;
};

export function createDshEngine(options: {
  model: string;
  persona: string;
  apiKey: string;
  fixture: boolean;
  openaiBaseUrl: string | null;
  dshHome: string;
}): ConversationEngine {
  let harness: DeepSeekHarness | null = null;
  let known = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  const queue = <T>(op: () => Promise<T>): Promise<T> => {
    const run = chain.then(op, op);
    chain = run.then(() => undefined, () => undefined);
    return run;
  };
  const childEnv = (): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = {};
    for (const name of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "USER", "LOGNAME", "SHELL"]) {
      if (process.env[name]) env[name] = process.env[name];
    }
    env.OPENROUTER_API_KEY = options.apiKey;
    env.DSH_SYSTEM_PROMPT = options.persona;
    if (options.openaiBaseUrl) env.QBOT_OPENAI_BASE_URL = options.openaiBaseUrl;
    return env;
  };
  const open = (): DeepSeekHarness => {
    if (!harness) {
      harness = new DeepSeekHarness({
        profile: "sdk-minimal",
        patches: [PATCH],
        dshHome: options.dshHome,
        cwd: options.dshHome,
        processCwd: options.dshHome,
        provider: "openrouter",
        model: options.model,
        env: childEnv(),
        initializeTimeoutMs: 30_000,
      });
    }
    return harness;
  };
  return {
    engine: "dsh",
    id: options.fixture ? "fixture" : "openrouter",
    run(turn) {
      let active: string | null = turn.sessionId;
      const iterator = (async function* () {
        const deltas: string[] = [];
        let wake: (() => void) | null = null;
        let finished = false;
        let failure: Error | null = null;
        const poke = () => {
          wake?.();
          wake = null;
        };
        const task = queue(async () => {
          const current = open();
          if (turn.signal.aborted) throw abortError();
          const onAbort = () => { void current.close().finally(() => { harness = null; known = new Set(); }); };
          turn.signal.addEventListener("abort", onAbort, { once: true });
          try {
            const handle = active
              ? known.has(active) ? current.session(active) : await current.resumeSession(active)
              : current.session();
            active = handle.id;
            known.add(handle.id);
            if (turn.onSession) await turn.onSession(handle.id);
            let sent = "";
            const result = await handle.run(turn.text, {
              onNotification(notification: HarnessNotification) {
                const delta = assistantDelta(notification, sent);
                if (!delta) return;
                sent += delta;
                deltas.push(delta);
                poke();
              },
            });
            active = result.sessionId;
            known.add(result.sessionId);
            if (result.finishReason === "error") throw new Error("模型上游中断");
            const finalText = result.finalResponse;
            if (finalText.startsWith(sent) && finalText.length > sent.length) deltas.push(finalText.slice(sent.length));
            if (!finalText) throw new Error("模型没有返回文字");
          } finally {
            turn.signal.removeEventListener("abort", onAbort);
            finished = true;
            poke();
          }
        }).catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : "";
          const safe = detail.toLowerCase().includes("not found")
            ? new Error("模型会话不在这台服务器上")
            : error instanceof Error ? error : new Error("模型上游中断");
          failure = safe;
          finished = true;
          poke();
        });
        while (!finished || deltas.length > 0) {
          if (deltas.length === 0) await new Promise<void>((resolve) => { wake = resolve; });
          while (deltas.length > 0) yield deltas.shift() ?? "";
        }
        await task;
        if (turn.signal.aborted) throw abortError();
        if (failure) throw failure;
      })();
      return Object.assign(iterator, { sessionId: () => active });
    },
    async close() {
      const current = harness;
      harness = null;
      known = new Set();
      if (current) await current.close();
    },
  };
}

export function openaiBase(fixtureUrl: string | null, fixture: boolean): string | null {
  if (!fixture) return null;
  if (!fixtureUrl) return null;
  return fixtureUrl.replace(/\/chat\/completions\/?$/, "");
}

export function defaultDshHome(): string {
  return mkdtempSync(path.join(tmpdir(), "qbot-dsh-"));
}

function assistantDelta(notification: HarnessNotification, sent: string): string {
  if (notification.method !== "session.event") return "";
  const event = notification.params.event;
  if (!event || typeof event !== "object") return "";
  const record = event as { type?: string; data?: { message?: { content?: { type?: string; text?: string }[] } } };
  if (record.type !== "assistant/message") return "";
  const text = (record.data?.message?.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("");
  if (!text.startsWith(sent)) return "";
  return text.slice(sent.length);
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

export const DSH_PROFILE_MODEL = DEFAULT_MODEL;
export const DSH_PROFILE_PERSONA = SERVER_PERSONA;
