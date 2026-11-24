import type { FeedCard, FeedScope } from "./feedClient.ts";

/**
 * Bands the app paints over a full-bleed cover. The image fills the card.
 * These bands are where important text must not sit, not a letterbox around the picture.
 */
export const SWITCH_GAP = 6;
export const SWITCH_HEIGHT = 36;
export const CONTENT_GAP = 16;
export const ACCOUNT_HEIGHT = 44;
export const ACCOUNT_GAP = 8;

export const EMPTY_TITLE = "暂时没有新内容";
export const EMPTY_BODY = "关注的 Bot 有更新时，会继续出现在这里。";
export const EMPTY_ACTION = "去推荐看看";

export const SCOPES = ["following", "recommended"] as const;
export const DEFAULT_BOT_SLUG = "qbot";

/** QBot is the built-in personal assistant and never requires following. */
export function isDefaultBot(bot: { slug?: string } | null | undefined): boolean {
  return (bot?.slug ?? "").toLowerCase() === DEFAULT_BOT_SLUG;
}

/** Normalize the default bot display name to QBot across the UI. */
export function botLabel(bot: { slug?: string; displayName: string }): string {
  return isDefaultBot(bot) ? "QBot" : bot.displayName;
}

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

/** v2.0 surfaces: warm paper in light mode, warm ink in dark mode (brand orange uses accent strip + highlights). */
export function surfaceColor(surface: CoverSurface, scheme: "light" | "dark"): string {
  if (surface === "orange") return scheme === "dark" ? "#1F1D1A" : "#FAF8F3";
  if (surface === "paper") return scheme === "dark" ? "#171614" : "#F3EFE7";
  return scheme === "dark" ? "#171614" : "#F3EFE7";
}

export function statusIcons(_surface: CoverSurface, scheme: "light" | "dark"): StatusIcons {
  return scheme === "dark" ? "light" : "dark";
}

export function overlayInk(_surface: CoverSurface, scheme: "light" | "dark"): string {
  return scheme === "dark" ? "#EDE8DF" : "#1C1B19";
}

/** Inject v2.0 warm-ink dark styling (and clean sans typography) into published static HTML work pages. */
export function workThemeScript(dark: boolean): string {
  const css = dark
    ? `:root{color-scheme:dark!important}
html,body{background:#171614!important;color:#EDE8DF!important;font-family:system-ui,-apple-system,"Noto Sans SC",sans-serif!important}
.mast,.deck,.foot,.note,details p{color:#ABA498!important}
.rule{border-top-color:#EDE8DF!important;border-bottom-color:#EDE8DF!important}
.chips span{border-color:#EDE8DF!important;color:#EDE8DF!important}
.chips .fill{background:#FF6A2B!important;border-color:#FF6A2B!important;color:#1C1B19!important}
.phrase{color:#FF8A55!important}
.meaning,.hook,h1,.hero,summary{color:#EDE8DF!important}
.points{border-top-color:#EDE8DF!important}
.points li{border-bottom-color:#34312C!important;color:#EDE8DF!important}
.points .n{color:#FF8A55!important}
.points .tag{background:#2E2B27!important;color:#EDE8DF!important}
.example{background:#262420!important;border:1px solid #34312C!important;border-left:3.5px solid #FF6A2B!important}
.example .label{color:#FF8A55!important}
.example p{color:#EDE8DF!important}`
    : `:root{color-scheme:light!important}
html,body{background:#FAF8F3!important;color:#1C1B19!important;font-family:system-ui,-apple-system,"Noto Sans SC",sans-serif!important}
.mast,.deck,.foot,.note,details p{color:#5C574E!important}
.chips .fill{background:#1C1B19!important;color:#F3EFE7!important}
.points .n{color:#C24410!important}
.points .tag{background:#ECE7DD!important;color:#1C1B19!important}
.example{background:#FFFEFB!important;border:1px solid #E3DDD1!important;border-left:3.5px solid #FF6A2B!important}
.example .label{color:#C24410!important}
.example p{color:#1C1B19!important}`;
  return `(function(){
  function inject(){
    var id="qbot-work-v2";
    var el=document.getElementById(id);
    if(!el&&document.head){el=document.createElement("style");el.id=id;document.head.appendChild(el);}
    if(el) el.textContent=${JSON.stringify(css)};
  }
  inject();
  document.addEventListener("DOMContentLoaded",inject);
})();true;`;
}

/** Mast starts under the real status inset and the switch. Body stops above the native attribution row. */
export function contentBand(input: { topInset: number }): { paddingTop: number; paddingBottom: number } {
  return {
    paddingTop: Math.max(0, input.topInset) + SWITCH_GAP + SWITCH_HEIGHT + CONTENT_GAP,
    paddingBottom: ACCOUNT_GAP + ACCOUNT_HEIGHT + CONTENT_GAP,
  };
}

export function showsAttribution(kind: "card" | "empty"): boolean {
  return kind === "card";
}

export type ReferenceCanvas = {
  width: number;
  height: number;
  insetTop: number;
  insetBottom: number;
};

export type ContentSafe = { top: number; right: number; bottom: number; left: number };

/** Reference device used to author a cover. Not a status-bar size for every phone. */
export const REFERENCE_CANVAS: ReferenceCanvas = {
  width: 390,
  height: 844,
  insetTop: 44,
  insetBottom: 34,
};

export const REFERENCE_SAFE: ContentSafe = { top: 98, right: 20, bottom: 148, left: 20 };

/**
 * Map a reference safe rect onto this device. Real insets replace the reference insets.
 * Scale follows the card width.
 */
export function deviceSafeRect(input: {
  width: number;
  height: number;
  topInset: number;
  bottomInset: number;
  reference?: ReferenceCanvas;
  safe?: ContentSafe;
}): ContentSafe {
  const reference = input.reference ?? REFERENCE_CANVAS;
  const safe = input.safe ?? REFERENCE_SAFE;
  const scale = input.width > 0 && reference.width > 0 ? input.width / reference.width : 1;
  const top = Math.max(0, input.topInset) + Math.max(0, safe.top - reference.insetTop) * scale;
  const bottom = Math.max(0, input.bottomInset) + Math.max(0, safe.bottom - reference.insetBottom) * scale;
  return {
    top,
    bottom,
    left: safe.left * scale,
    right: safe.right * scale,
  };
}

/** A point at this fraction of the cover height, drawn full-bleed, misses the overlay bands. */
export function fractionClearsOverlays(fraction: number, input: { height: number; topInset: number }): boolean {
  if (!(input.height > 0) || !Number.isFinite(fraction)) return false;
  const y = fraction * input.height;
  const switchBottom = Math.max(0, input.topInset) + SWITCH_GAP + SWITCH_HEIGHT;
  const accountTop = input.height - ACCOUNT_GAP - ACCOUNT_HEIGHT;
  return y >= switchBottom && y <= accountTop;
}

export type FeedGesture = "tap" | "vertical" | "horizontal" | "ignore";

/** One touch, one result. A swipe never opens the work. Only a short movement is a tap. */
export function classifyFeedGesture(dx: number, dy: number): FeedGesture {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return "ignore";
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx < 12 && ady < 12) return "tap";
  if (adx >= 48 && adx > ady * 1.4) return "horizontal";
  if (ady >= 48 && ady > adx * 1.4) return "vertical";
  return "ignore";
}

export function horizontalStep(dx: number, dy: number): -1 | 0 | 1 {
  if (classifyFeedGesture(dx, dy) !== "horizontal") return 0;
  return dx < 0 ? 1 : -1;
}

export function verticalStep(dx: number, dy: number): -1 | 0 | 1 {
  if (classifyFeedGesture(dx, dy) !== "vertical") return 0;
  return dy < 0 ? 1 : -1;
}

export function scopeAfterSwipe(scope: FeedScope, dx: number, dy: number): FeedScope {
  const step = horizontalStep(dx, dy);
  const index = SCOPES.indexOf(scope);
  const next = index + step;
  if (next < 0 || next >= SCOPES.length) return scope;
  return SCOPES[next] ?? scope;
}

/** Default QBot stays in 关注 without needing an explicit follow; external bots filter normally. */
export function applyFollow(cards: FeedCard[], botId: string, followed: boolean, scope: FeedScope): FeedCard[] {
  return cards
    .map((card) => card.bot.id === botId ? { ...card, bot: { ...card.bot, followed } } : card)
    .filter((card) => scope !== "following" || isDefaultBot(card.bot) || card.bot.followed);
}

export function clampPage(index: number, count: number): number {
  if (count <= 0) return 0;
  const page = Number.isFinite(index) ? Math.trunc(index) : 0;
  return Math.max(0, Math.min(count - 1, page));
}

/**
 * Pick card ids that need a remote cover capability minted right now.
 * Skips cards with a local face, already-loaded covers, in-flight requests,
 * and cards outside the active paging window.
 */
export function selectCoverPrefetchIds(input: {
  cards: readonly Pick<FeedCard, "id">[];
  index: number;
  loaded: ReadonlySet<string>;
  inFlight: ReadonlySet<string>;
  hasLocalFace: (cardId: string) => boolean;
  radius?: number;
}): string[] {
  const { cards, loaded, inFlight, hasLocalFace } = input;
  if (cards.length === 0) return [];
  const radius = Math.max(0, Math.trunc(input.radius ?? 2));
  const center = clampPage(input.index, cards.length);
  const start = Math.max(0, center - radius);
  const end = Math.min(cards.length - 1, center + radius);
  const ids: string[] = [];
  for (let i = start; i <= end; i += 1) {
    const card = cards[i];
    if (!card) continue;
    if (hasLocalFace(card.id) || loaded.has(card.id) || inFlight.has(card.id)) continue;
    ids.push(card.id);
  }
  return ids;
}
