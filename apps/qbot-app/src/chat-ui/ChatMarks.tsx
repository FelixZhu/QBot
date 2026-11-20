import { View } from "react-native";

/** Line marks drawn with views. The chat screen stays on the system typeface. */

export function ChatMark({ name, color, size = 22 }: { name: MarkName; color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size }}>
      <Mark name={name} color={color} size={size} />
    </View>
  );
}

export type MarkName =
  | "menu"
  | "pencil"
  | "more"
  | "plus"
  | "mic"
  | "wave"
  | "up"
  | "stop"
  | "close"
  | "copy"
  | "share"
  | "play"
  | "up-thumb"
  | "down-thumb"
  | "retry"
  | "check"
  | "camera"
  | "image"
  | "file"
  | "book"
  | "chevron";

function Mark({ name, color, size }: { name: MarkName; color: string; size: number }) {
  const stroke = Math.max(1.5, size * 0.08);
  if (name === "menu") {
    return (
      <View style={{ flex: 1, justifyContent: "center", gap: size * 0.16 }}>
        {[0, 1, 2].map((row) => (
          <View key={row} style={{ height: stroke, borderRadius: stroke, backgroundColor: color, marginHorizontal: size * 0.12 }} />
        ))}
      </View>
    );
  }
  if (name === "more") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "space-evenly" }}>
        {[0, 1, 2].map((row) => (
          <View key={row} style={{ width: stroke * 1.7, height: stroke * 1.7, borderRadius: stroke, backgroundColor: color }} />
        ))}
      </View>
    );
  }
  if (name === "plus" || name === "close") {
    const arm = name === "close" ? size * 0.62 : size * 0.52;
    const rotate = name === "close" ? "45deg" : "0deg";
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", transform: [{ rotate }] }}>
        <View style={{ position: "absolute", width: arm, height: stroke, borderRadius: stroke, backgroundColor: color }} />
        <View style={{ position: "absolute", width: stroke, height: arm, borderRadius: stroke, backgroundColor: color }} />
      </View>
    );
  }
  if (name === "stop") {
    const box = size * 0.38;
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: box, height: box, borderRadius: 2, backgroundColor: color }} />
      </View>
    );
  }
  if (name === "check") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: size * 0.28, height: stroke, borderRadius: stroke, backgroundColor: color, transform: [{ rotate: "45deg" }, { translateX: -size * 0.08 }, { translateY: size * 0.06 }] }} />
        <View style={{ position: "absolute", width: size * 0.48, height: stroke, borderRadius: stroke, backgroundColor: color, transform: [{ rotate: "-45deg" }, { translateX: size * 0.08 }, { translateY: size * 0.02 }] }} />
      </View>
    );
  }
  if (name === "up") {
    const wing = size * 0.22;
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 0, height: 0, borderLeftWidth: wing, borderRightWidth: wing, borderBottomWidth: wing, borderLeftColor: "transparent", borderRightColor: "transparent", borderBottomColor: color }} />
        <View style={{ width: stroke, height: size * 0.34, backgroundColor: color, marginTop: -1 }} />
      </View>
    );
  }
  if (name === "play") {
    const wing = size * 0.28;
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 0, height: 0, marginLeft: size * 0.08, borderTopWidth: wing * 0.75, borderBottomWidth: wing * 0.75, borderLeftWidth: wing, borderTopColor: "transparent", borderBottomColor: "transparent", borderLeftColor: color }} />
      </View>
    );
  }
  if (name === "wave") {
    const heights = [0.28, 0.55, 0.9, 0.55, 0.28];
    return (
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: size * 0.06 }}>
        {heights.map((height, index) => (
          <View key={index} style={{ width: stroke, height: size * height, borderRadius: stroke, backgroundColor: color }} />
        ))}
      </View>
    );
  }
  if (name === "mic") {
    return (
      <View style={{ flex: 1, alignItems: "center" }}>
        <View style={{ marginTop: size * 0.08, width: size * 0.34, height: size * 0.48, borderRadius: size * 0.17, borderWidth: stroke, borderColor: color }} />
        <View style={{ marginTop: size * 0.04, width: size * 0.5, height: size * 0.22, borderBottomLeftRadius: size * 0.2, borderBottomRightRadius: size * 0.2, borderWidth: stroke, borderTopWidth: 0, borderColor: color }} />
        <View style={{ width: stroke, height: size * 0.1, backgroundColor: color }} />
      </View>
    );
  }
  if (name === "copy") {
    const box = size * 0.46;
    return (
      <View style={{ flex: 1 }}>
        <View style={{ position: "absolute", right: size * 0.12, top: size * 0.14, width: box, height: box, borderRadius: 3, borderWidth: stroke, borderColor: color }} />
        <View style={{ position: "absolute", left: size * 0.16, bottom: size * 0.14, width: box, height: box, borderRadius: 3, borderWidth: stroke, borderColor: color, backgroundColor: "transparent" }} />
      </View>
    );
  }
  if (name === "share") {
    return (
      <View style={{ flex: 1, alignItems: "center" }}>
        <View style={{ marginTop: size * 0.12, width: 0, height: 0, borderLeftWidth: size * 0.14, borderRightWidth: size * 0.14, borderBottomWidth: size * 0.16, borderLeftColor: "transparent", borderRightColor: "transparent", borderBottomColor: color }} />
        <View style={{ width: stroke, height: size * 0.28, backgroundColor: color }} />
        <View style={{ width: size * 0.5, height: size * 0.22, borderLeftWidth: stroke, borderRightWidth: stroke, borderBottomWidth: stroke, borderColor: color, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 }} />
      </View>
    );
  }
  if (name === "retry") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: size * 0.62, height: size * 0.62, borderRadius: size, borderWidth: stroke, borderColor: color, borderRightColor: "transparent" }} />
        <View style={{ position: "absolute", right: size * 0.12, top: size * 0.16, width: 0, height: 0, borderLeftWidth: size * 0.12, borderTopWidth: size * 0.1, borderBottomWidth: size * 0.1, borderLeftColor: color, borderTopColor: "transparent", borderBottomColor: "transparent" }} />
      </View>
    );
  }
  if (name === "up-thumb" || name === "down-thumb") {
    const flip = name === "down-thumb" ? "180deg" : "0deg";
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", transform: [{ rotate: flip }] }}>
        <View style={{ position: "absolute", left: size * 0.28, top: size * 0.12, width: size * 0.16, height: size * 0.42, borderRadius: size * 0.08, borderWidth: stroke, borderColor: color }} />
        <View style={{ position: "absolute", left: size * 0.22, top: size * 0.4, width: size * 0.48, height: size * 0.32, borderRadius: 3, borderWidth: stroke, borderColor: color }} />
      </View>
    );
  }
  if (name === "camera") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: size * 0.72, height: size * 0.5, borderRadius: 4, borderWidth: stroke, borderColor: color, marginTop: size * 0.08 }} />
        <View style={{ position: "absolute", width: size * 0.24, height: size * 0.24, borderRadius: size, borderWidth: stroke, borderColor: color }} />
      </View>
    );
  }
  if (name === "image") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: size * 0.7, height: size * 0.56, borderRadius: 3, borderWidth: stroke, borderColor: color }} />
        <View style={{ position: "absolute", top: size * 0.28, left: size * 0.22, width: size * 0.12, height: size * 0.12, borderRadius: size, backgroundColor: color }} />
      </View>
    );
  }
  if (name === "file") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: size * 0.52, height: size * 0.66, borderRadius: 3, borderWidth: stroke, borderColor: color }} />
        <View style={{ position: "absolute", right: size * 0.2, top: size * 0.16, width: size * 0.16, height: stroke, backgroundColor: color }} />
      </View>
    );
  }
  if (name === "book") {
    return (
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2 }}>
        <View style={{ width: size * 0.3, height: size * 0.56, borderWidth: stroke, borderColor: color, borderTopLeftRadius: 3, borderBottomLeftRadius: 3 }} />
        <View style={{ width: size * 0.3, height: size * 0.56, borderWidth: stroke, borderColor: color, borderTopRightRadius: 3, borderBottomRightRadius: 3 }} />
      </View>
    );
  }
  if (name === "chevron") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: size * 0.28, height: size * 0.28, borderTopWidth: stroke, borderRightWidth: stroke, borderColor: color, transform: [{ rotate: "45deg" }] }} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: size * 0.62, height: stroke, backgroundColor: color, transform: [{ rotate: "-35deg" }] }} />
      <View style={{ position: "absolute", right: size * 0.16, top: size * 0.18, width: size * 0.16, height: size * 0.16, borderRightWidth: stroke, borderTopWidth: stroke, borderColor: color }} />
    </View>
  );
}
