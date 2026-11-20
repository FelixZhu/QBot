import { LIMITS } from "../limits.ts";
import type { RuntimeMessage } from "./types.ts";

export type HistoryTurn = { role: "user" | "assistant"; content: string };

/**
 * Newest complete turns that fit the budget, with the agent persona first.
 * The persona comes from the stored agent definition, never from the request.
 * The newest user turn is kept even if it alone exceeds the character budget.
 */
export function buildModelMessages(persona: string, history: readonly HistoryTurn[]): RuntimeMessage[] {
  const recent = history.slice(-LIMITS.contextMessages);
  const selected: HistoryTurn[] = [];
  let used = persona.length;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const row = recent[index];
    if (!row || !row.content) continue;
    const cost = row.content.length + 1;
    if (selected.length > 0 && used + cost > LIMITS.contextChars) break;
    selected.push(row);
    used += cost;
  }
  selected.reverse();
  return [
    { role: "system", content: persona },
    ...selected.map((row) => ({ role: row.role, content: row.content })),
  ];
}
