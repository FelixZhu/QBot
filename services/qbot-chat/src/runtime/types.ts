/**
 * Shared model boundary for every Bot run: the interactive SSE turn now, and a later
 * scheduled or event-driven artifact run. One service process handles many runs.
 * There is no process per Bot and no second runtime for cards.
 *
 * The caller already loaded the agent definition and the history. An adapter only
 * streams assistant text. It does not read Postgres, authenticate the app, or run tools.
 *
 * No agent SDK is wired in. `@mariozechner/pi-agent-core` and `@earendil-works/pi-agent-core`
 * were reviewed and not added. A later adapter can wrap the chosen library: seed it with
 * `messages`, subscribe to text deltas, pass `signal`, and leave tools empty until a tool
 * loop is actually required. Routes and SQL stay put.
 */

/** `background` is reserved for a future artifact run. Nothing schedules it yet. */
export const RUN_KINDS = ["interactive", "background"] as const;
export type RunKind = (typeof RUN_KINDS)[number];
export type RuntimeMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type RuntimeRequest = {
  model: string;
  messages: readonly RuntimeMessage[];
  signal: AbortSignal;
};

export type RuntimeId = "openrouter" | "fixture";

export interface TextRuntime {
  readonly id: RuntimeId;
  stream(request: RuntimeRequest): AsyncIterable<string>;
}
