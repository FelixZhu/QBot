import { View } from "react-native";

/** Drawn marks, not a font. The tab bar stays on the system typeface. */

export function BubbleIcon({ color, filled, size = 24 }: { color: string; filled?: boolean; size?: number }) {
  const body = size * 0.72;
  const tail = size * 0.22;
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: "absolute",
          left: size * 0.08,
          top: size * 0.08,
          width: body,
          height: body * 0.72,
          borderRadius: body * 0.36,
          backgroundColor: filled ? color : "transparent",
          borderWidth: filled ? 0 : 1.8,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.18,
          bottom: size * 0.06,
          width: 0,
          height: 0,
          borderLeftWidth: tail * 0.35,
          borderRightWidth: tail * 0.7,
          borderTopWidth: tail,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderTopColor: color,
        }}
      />
    </View>
  );
}

export function StarIcon({ color, size = 24 }: { color: string; size?: number }) {
  const arm = size * 0.16;
  const reach = size * 0.42;
  const mid = (size - arm) / 2;
  const point = (top: number, left: number, borders: object) => (
    <View
      style={{
        position: "absolute",
        top,
        left,
        width: 0,
        height: 0,
        borderLeftColor: "transparent",
        borderRightColor: "transparent",
        borderTopColor: "transparent",
        borderBottomColor: "transparent",
        ...borders,
      }}
    />
  );
  return (
    <View style={{ width: size, height: size }}>
      {point(size * 0.04, mid, { borderLeftWidth: arm / 2, borderRightWidth: arm / 2, borderBottomWidth: reach, borderBottomColor: color })}
      {point(size * 0.5, mid, { borderLeftWidth: arm / 2, borderRightWidth: arm / 2, borderTopWidth: reach, borderTopColor: color })}
      {point(mid, size * 0.04, { borderTopWidth: arm / 2, borderBottomWidth: arm / 2, borderRightWidth: reach, borderRightColor: color })}
      {point(mid, size * 0.5, { borderTopWidth: arm / 2, borderBottomWidth: arm / 2, borderLeftWidth: reach, borderLeftColor: color })}
    </View>
  );
}

export function BookIcon({ color, size = 24 }: { color: string; size?: number }) {
  const page = {
    width: size * 0.42,
    height: size * 0.62,
    borderWidth: 1.7,
    borderColor: color,
    backgroundColor: "transparent" as const,
  };
  return (
    <View style={{ width: size, height: size, flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
      <View style={{ ...page, borderRightWidth: 0, borderTopLeftRadius: 2, borderBottomLeftRadius: 3, transform: [{ skewY: "-8deg" }] }} />
      <View style={{ width: 1.7, height: size * 0.7, backgroundColor: color }} />
      <View style={{ ...page, borderLeftWidth: 0, borderTopRightRadius: 2, borderBottomRightRadius: 3, transform: [{ skewY: "8deg" }] }} />
    </View>
  );
}
