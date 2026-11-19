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
  status: "light" | "dark";
};

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
    status: "light",
  },
};

/** A missing or unknown system value stays light. Dark is only the explicit dark scheme. */
export function resolveScheme(colorScheme: string | null | undefined): Scheme {
  return colorScheme === "dark" ? "dark" : "light";
}

export function isSplit(width: number): boolean {
  return width >= SPLIT_WIDTH;
}
