import { Platform, Pressable, Text, View } from "react-native";
import type { TitlePart } from "./lessons";

export const BG = "#0B0B0F";
export const CREAM = "#F4F1EA";
export const DIM = "rgba(244,241,234,0.62)";
export const AM = "#F5A623";
export const INK = "#141413";
export const ACCOUNT = "Study Bot";
export const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

export type Measurable = {
  measureInWindow: (callback: (x: number, y: number, w: number, h: number) => void) => void;
};

export function asMeasurable(node: unknown): Measurable | null {
  if (!node || typeof node !== "object" || !("measureInWindow" in node)) return null;
  if (typeof (node as { measureInWindow?: unknown }).measureInWindow !== "function") return null;
  return node as Measurable;
}

export function plainTitle(parts: readonly TitlePart[]): string {
  return parts.map((part) => part.text).join("").replace(/\n/g, "");
}

export function accountLine(day: number, extra?: string): string {
  const base = `${ACCOUNT} · 第 ${day} 课`;
  return extra ? `${base} · ${extra}` : base;
}

export function GridLines() {
  const horizontal = Array.from({ length: 18 }, (_, index) => (
    <View
      key={`h-${index}`}
      pointerEvents="none"
      style={{ position: "absolute", left: 0, right: 0, top: index * 28, height: 1, backgroundColor: "rgba(255,255,255,0.045)" }}
    />
  ));
  const vertical = Array.from({ length: 12 }, (_, index) => (
    <View
      key={`v-${index}`}
      pointerEvents="none"
      style={{ position: "absolute", top: 0, bottom: 0, left: index * 28, width: 1, backgroundColor: "rgba(255,255,255,0.045)" }}
    />
  ));
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      {horizontal}
      {vertical}
    </View>
  );
}

export function Avatar() {
  return (
    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#F3EBDD", borderWidth: 1.5, borderColor: CREAM, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: INK, borderRightColor: "transparent", transform: [{ rotate: "40deg" }] }} />
    </View>
  );
}

export function AccountBar({ followed, onFollow }: { followed: boolean; onFollow: () => void }) {
  return (
    <View style={{ paddingTop: 8, paddingBottom: 16, paddingHorizontal: 16, flexDirection: "row", alignItems: "center" }}>
      <Avatar />
      <Text style={{ marginLeft: 10, color: CREAM, fontSize: 16, fontWeight: "700" }}>{ACCOUNT}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: followed }}
        accessibilityLabel={followed ? "已关注" : "关注"}
        onPress={onFollow}
        hitSlop={8}
        style={{
          marginLeft: 10,
          height: 28,
          paddingHorizontal: 12,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: followed ? AM : "rgba(244,241,234,0.45)",
          backgroundColor: followed ? "rgba(245,166,35,0.16)" : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: followed ? AM : CREAM, fontSize: 13, fontWeight: "600" }}>{followed ? "已关注" : "关注"}</Text>
      </Pressable>
    </View>
  );
}

export function Title({ parts, size }: { parts: readonly TitlePart[]; size: number }) {
  return (
    <Text style={{ fontSize: size, lineHeight: Math.round(size * 1.18), fontWeight: "700", color: CREAM }}>
      {parts.map((part, index) => (
        <Text key={index} style={{ color: part.amber || part.mono ? AM : CREAM, fontFamily: part.mono ? MONO : undefined, fontWeight: "700" }}>
          {part.text}
        </Text>
      ))}
    </Text>
  );
}
