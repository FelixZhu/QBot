export type Scheme = "light" | "dark";

/** Matches the web shell fold used for the side rail. */
export const SPLIT_WIDTH = 600;

export type Palette = {
  canvas: string;
  bg: string;
  text: string;
  text2: string;
  muted: string;
  line: string;
  accent: string;
  /** Orange used for text and links. The fill accent is too light for small type. */
  accentInk: string;
  accentSoft: string;
  bubbleMe: string;
  bubbleMeText: string;
  bubbleBot: string;
  raised: string;
  press: string;
  /** Whole-row fill for the open conversation. */
  selected: string;
  btnPrimaryBg: string;
  btnPrimaryFg: string;
  status: "light" | "dark";
};

/** Left navigation rail width on unfolded/wide screens (>= 600dp). */
export const RAIL_WIDTH = 72;

/** Wide list and directory panes: 38% of the window, clamped to 320–400dp. */
export const LIST_PANE_RATIO = 0.38;
export const LIST_PANE_MIN = 320;
export const LIST_PANE_MAX = 400;

/** Messages, composer, and immersive body copy stop growing past this. */
export const READ_MAX = 720;

/** Unfolded feed card, in dp. Scaled up to the feed height; never stretched. */
export const PHONE_CARD_WIDTH = 390;
export const PHONE_CARD_HEIGHT = 844;

/** Side gutters take the card color at this HSL lightness. */
export const GUTTER_LIGHTNESS = 0.15;

/** Single source of truth for v2.0 light and dark warm paper/ink surfaces. */
export const palette: Record<Scheme, Palette> = {
  light: {
    canvas: "#F3EFE7",
    bg: "#FAF8F3",
    text: "#1C1B19",
    text2: "#5C574E",
    muted: "#736D62",
    line: "#E3DDD1",
    accent: "#FF6A2B",
    accentInk: "#C24410",
    accentSoft: "rgba(255,106,43,0.12)",
    bubbleMe: "#ECE7DD",
    bubbleMeText: "#1C1B19",
    bubbleBot: "#FFFEFB",
    raised: "#FFFEFB",
    press: "rgba(28,27,25,0.06)",
    selected: "#ECE7DD",
    btnPrimaryBg: "#1C1B19",
    btnPrimaryFg: "#F3EFE7",
    status: "dark",
  },
  dark: {
    canvas: "#171614",
    bg: "#1F1D1A",
    text: "#EDE8DF",
    text2: "#ABA498",
    muted: "#9A9386",
    line: "#34312C",
    accent: "#FF6A2B",
    accentInk: "#FF8A55",
    accentSoft: "rgba(255,106,43,0.20)",
    bubbleMe: "#2E2B27",
    bubbleMeText: "#EDE8DF",
    bubbleBot: "#262420",
    raised: "#262420",
    press: "rgba(237,232,223,0.08)",
    selected: "#2E2B27",
    btnPrimaryBg: "#EDE8DF",
    btnPrimaryFg: "#171614",
    status: "light",
  },
};

/** A missing or unknown system value stays light. Dark is only the explicit dark scheme. */
export function resolveScheme(colorScheme: string | null | undefined): Scheme {
  return colorScheme === "dark" ? "dark" : "light";
}

/** Chat screen colors derived directly from the unified v2.0 palette. */
export type ChatChrome = {
  canvas: string;
  text: string;
  muted: string;
  userBubble: string;
  userText: string;
  composer: string;
  line: string;
  send: string;
  onSend: string;
  /** Orange for short labels such as 立即发送. */
  inkText: string;
  pressed: string;
  ink: string;
  onInk: string;
  sheet: string;
  tile: string;
  scrim: string;
  toast: string;
  toastText: string;
  check: string;
  selection: string;
  icon: string;
  disabled: string;
  soft: string;
};

export function chatChrome(scheme: Scheme): ChatChrome {
  const tokens = palette[scheme];
  if (scheme === "dark") {
    return {
      canvas: tokens.bg,
      text: tokens.text,
      muted: tokens.muted,
      userBubble: tokens.bubbleMe,
      userText: tokens.bubbleMeText,
      composer: tokens.raised,
      line: tokens.line,
      send: tokens.accent,
      onSend: "#FFFFFF",
      inkText: tokens.accentInk,
      pressed: "#E85A1F",
      ink: tokens.btnPrimaryBg,
      onInk: tokens.btnPrimaryFg,
      sheet: tokens.raised,
      tile: tokens.selected,
      scrim: "rgba(0,0,0,0.56)",
      toast: "#34312C",
      toastText: tokens.text,
      check: "#7FBA96",
      selection: "rgba(255,106,43,0.40)",
      icon: tokens.text2,
      disabled: "#6E695F",
      soft: tokens.selected,
    };
  }
  return {
    canvas: tokens.bg,
    text: tokens.text,
    muted: tokens.muted,
    userBubble: tokens.bubbleMe,
    userText: tokens.bubbleMeText,
    composer: tokens.raised,
    line: tokens.line,
    send: tokens.accent,
    onSend: "#FFFFFF",
    inkText: tokens.accentInk,
    pressed: "#E85A1F",
    ink: tokens.btnPrimaryBg,
    onInk: tokens.btnPrimaryFg,
    sheet: tokens.raised,
    tile: tokens.canvas,
    scrim: "rgba(28,27,25,0.36)",
    toast: "#1C1B19",
    toastText: "#F3EFE7",
    check: "#3E7B57",
    selection: "rgba(255,106,43,0.32)",
    icon: tokens.text2,
    disabled: "#ABA498",
    soft: tokens.selected,
  };
}

export function isSplit(width: number): boolean {
  return width >= SPLIT_WIDTH;
}

/** Shared width for every wide list or directory pane. Narrow layouts do not call this. */
export function listPaneWidth(windowWidth: number): number {
  const preferred = windowWidth * LIST_PANE_RATIO;
  const clamped = Math.min(LIST_PANE_MAX, Math.max(LIST_PANE_MIN, preferred));
  return Math.round(clamped);
}

/** Largest rectangle of `aspect` (width / height) that fits inside the box. */
export function fitAspect(maxWidth: number, maxHeight: number, aspect: number): { width: number; height: number } {
  if (maxWidth <= 0 || maxHeight <= 0 || aspect <= 0) return { width: 0, height: 0 };
  let width = maxHeight * aspect;
  let height = maxHeight;
  if (width > maxWidth) {
    width = maxWidth;
    height = width / aspect;
  }
  return { width, height };
}

export function phoneFrame(maxWidth: number, maxHeight: number): { width: number; height: number } {
  return fitAspect(maxWidth, maxHeight, PHONE_CARD_WIDTH / PHONE_CARD_HEIGHT);
}

function channel(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

/** Card color with lightness set to ~15%, hue and saturation kept. Orange becomes dark orange. */
export function gutterColor(background: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(background.trim());
  if (!match) return "#262626";
  const packed = Number.parseInt(match[1], 16);
  const r = ((packed >> 16) & 255) / 255;
  const g = ((packed >> 8) & 255) / 255;
  const b = (packed & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  let hue = 0;
  if (chroma !== 0) {
    if (max === r) hue = ((g - b) / chroma) % 6;
    else if (max === g) hue = (b - r) / chroma + 2;
    else hue = (r - g) / chroma + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }
  const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(max + min - 1));
  const lightness = GUTTER_LIGHTNESS;
  const nextChroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = nextChroma * (1 - Math.abs((hue * 6) % 2 - 1));
  const m = lightness - nextChroma / 2;
  let nr = 0;
  let ng = 0;
  let nb = 0;
  const sector = hue * 6;
  if (sector < 1) [nr, ng, nb] = [nextChroma, x, 0];
  else if (sector < 2) [nr, ng, nb] = [x, nextChroma, 0];
  else if (sector < 3) [nr, ng, nb] = [0, nextChroma, x];
  else if (sector < 4) [nr, ng, nb] = [0, x, nextChroma];
  else if (sector < 5) [nr, ng, nb] = [x, 0, nextChroma];
  else [nr, ng, nb] = [nextChroma, 0, x];
  return `#${channel((nr + m) * 255)}${channel((ng + m) * 255)}${channel((nb + m) * 255)}`;
}
