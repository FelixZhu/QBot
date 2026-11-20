import type { RuntimeRequest, TextRuntime } from "./types.ts";

/**
 * One model pass. Interactive chat and a future background artifact run both call this.
 * Persistence, cancellation, and who is allowed to start the run stay outside.
 */
export function streamAgentText(runtime: TextRuntime, request: RuntimeRequest): AsyncIterable<string> {
  return runtime.stream(request);
}
