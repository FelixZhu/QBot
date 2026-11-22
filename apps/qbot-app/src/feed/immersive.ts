import type { FeedCard, FeedScope } from "./feedClient.ts";

/** Bands the app paints over a cover. The cover image stays inside the remaining rect. */
export const SWITCH_GAP = 6;
export const SWITCH_HEIGHT = 36;
export const CONTENT_GAP = 12;
export const ACCOUNT_HEIGHT = 44;
export const ACCOUNT_GAP = 8;

export const EMPTY_TITLE = "暂时没有新内容";
export const EMPTY_BODY = "关注的 Bot 有更新时，会继续出现在这里。";
export const EMPTY_ACTION = "去推荐看看";

export const SCOPES = ["following", "recommended"] as const;

/** Surfaces of the two published works. Anything else stays on the system canvas. */
const PUBLISHED_SURFACE = {
  "00000000-0000-4000-8000-0000000000c1": "paper",
  "00000000-0000-4000-8000-0000000000c2": "orange",
} as const;

export type CoverSurface = "paper" | "orange" | "system";
export type StatusIcons = "dark" | "light";

export function coverSurface(cardId: string): CoverSurface {
  if (cardId === "00000000-0000-4000-8000-0000000000c1") return PUBLISHED_SURFACE[cardId];
  if (cardId === "00000000-0000-4000-8000-0000000000c2") return PUBLISHED_SURFACE[cardId];
  return "system";
}

export function surfaceColor(surface: CoverSurface, scheme: "light" | "dark"): string {
  if (surface === "orange") return "#FF6A2B";
  if (surface === "paper") return scheme === "dark" ? "#171614" : "#F3EFE7";
  return scheme === "dark" ? "#171614" : "#F3EFE7";
}

/** Dark icons on the cream and orange works. A dark paper page uses light icons. */
export function statusIcons(surface: CoverSurface, scheme: "light" | "dark"): StatusIcons {
  if (surface === "orange") return "dark";
  if (surface === "paper") return scheme === "dark" ? "light" : "dark";
  return scheme === "dark" ? "light" : "dark";
}

export function overlayInk(surface: CoverSurface, scheme: "light" | "dark"): string {
  if (surface === "orange") return "#1C1B19";
  if (surface === "paper" && scheme === "dark") return "#EDE8DF";
  if (surface === "system" && scheme === "dark") return "#EDE8DF";
  return "#1C1B19";
}

export function coverFrame(input: { width: number; height: number; topInset: number }): { top: number; right: number; bottom: number; left: number } {
  const top = Math.max(0, input.topInset) + SWITCH_GAP + SWITCH_HEIGHT + CONTENT_GAP;
  const bottom = ACCOUNT_GAP + ACCOUNT_HEIGHT + CONTENT_GAP;
  return { top, right: 0, bottom, left: 0 };
}

/** True when the switch and the account row sit outside the cover rect. */
export function overlaysClearCover(input: { width: number; height: number; topInset: number }): boolean {
  if (input.height <= 0 || input.width <= 0) return false;
  const frame = coverFrame(input);
  const switchBottom = Math.max(0, input.topInset) + SWITCH_GAP + SWITCH_HEIGHT;
  const coverBottom = input.height - frame.bottom;
  const accountTop = input.height - ACCOUNT_GAP - ACCOUNT_HEIGHT;
  return frame.top >= switchBottom && coverBottom <= accountTop && coverBottom > frame.top;
}

export function horizontalStep(dx: number, dy: number): -1 | 0 | 1 {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0;
  if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.4) return 0;
  return dx < 0 ? 1 : -1;
}

export function scopeAfterSwipe(scope: FeedScope, dx: number, dy: number): FeedScope {
  const step = horizontalStep(dx, dy);
  const index = SCOPES.indexOf(scope);
  const next = index + step;
  if (next < 0 || next >= SCOPES.length) return scope;
  return SCOPES[next] ?? scope;
}

export function applyFollow(cards: FeedCard[], botId: string, followed: boolean, scope: FeedScope): FeedCard[] {
  return cards
    .map((card) => card.bot.id === botId ? { ...card, bot: { ...card.bot, followed } } : card)
    .filter((card) => scope !== "following" || card.bot.followed);
}

export function clampPage(index: number, count: number): number {
  if (count <= 0) return 0;
  const page = Number.isFinite(index) ? Math.trunc(index) : 0;
  return Math.max(0, Math.min(count - 1, page));
}
