export type Scheme = "light" | "dark";

/** Matches the web shell fold used for the side rail. */
export const SPLIT_WIDTH = 600;

export type Palette = {
  canvas: string;
  bg: string;
  text: string;
  muted: string;
  line: string;
  accent: string;
  bubbleMe: string;
  bubbleMeText: string;
  bubbleBot: string;
  raised: string;
  press: string;
  /** Whole-row fill for the open conversation. */
  selected: string;
  status: "light" | "dark";
};

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

export const palette: Record<Scheme, Palette> = {
  light: {
    canvas: "#F3EFE7",
    bg: "#FAF9F6",
    text: "#1C1B19",
    muted: "#8A8781",
    line: "#EAE7E1",
    accent: "#D9774B",
    bubbleMe: "#1C1B19",
    bubbleMeText: "#FAF9F6",
    bubbleBot: "#FFFFFF",
    raised: "#FFFFFF",
    press: "rgba(28,27,25,0.06)",
    selected: "#ECE7DD",
    status: "dark",
  },
  dark: {
    canvas: "#171614",
    bg: "#1F1D1A",
    text: "#EDE8DF",
    muted: "#9A9386",
    line: "#34312C",
    accent: "#E58A5E",
    bubbleMe: "#EDE8DF",
    bubbleMeText: "#1C1B19",
    bubbleBot: "#2E2B27",
    raised: "#2E2B27",
    press: "rgba(237,232,223,0.08)",
    selected: "#2E2B27",
    status: "light",
  },
};

/** A missing or unknown system value stays light. Dark is only the explicit dark scheme. */
export function resolveScheme(colorScheme: string | null | undefined): Scheme {
  return colorScheme === "dark" ? "dark" : "light";
}

/** Chat screen colors taken from the approved 2026-11-20 light and dark frames. */
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
  if (scheme === "dark") {
    return {
      canvas: "#151515",
      text: "#F3F1EA",
      muted: "#9B9B96",
      userBubble: "#2B2B29",
      userText: "#ECEBE6",
      composer: "#232322",
      line: "rgba(255,255,255,0.08)",
      send: "#D9774B",
      onSend: "#FFFFFF",
      ink: "#F4F1EA",
      onInk: "#1C1B19",
      sheet: "#1F1F1E",
      tile: "#2A2A28",
      scrim: "rgba(0,0,0,0.55)",
      toast: "#3A3A38",
      toastText: "#F4F1EA",
      check: "#5FAF6A",
      selection: "rgba(217,119,75,0.45)",
      icon: "#B7B7B2",
      disabled: "#5C5C58",
      soft: "#2A2A28",
    };
  }
  return {
    canvas: "#FAF9F5",
    text: "#1C1B19",
    muted: "#8E8A82",
    userBubble: "#EFEDE6",
    userText: "#1F1E1D",
    composer: "#FFFFFF",
    line: "rgba(28,27,25,0.08)",
    send: "#D9774B",
    onSend: "#FFFFFF",
    ink: "#1C1B19",
    onInk: "#FFFFFF",
    sheet: "#FFFFFF",
    tile: "#F6F3EC",
    scrim: "rgba(28,27,25,0.38)",
    toast: "#323230",
    toastText: "#FFFFFF",
    check: "#5FAF6A",
    selection: "rgba(217,119,75,0.35)",
    icon: "#6F6B64",
    disabled: "#C8C4BC",
    soft: "#F3F0E8",
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
