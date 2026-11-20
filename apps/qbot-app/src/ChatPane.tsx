import { Pressable, Text, View } from "react-native";
import type { Palette } from "./theme";

function Mark({ size = 28 }: { size?: number }) {
  const dot = Math.max(6, Math.round(size * 0.28));
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        backgroundColor: "#1C1B19",
        alignItems: "flex-end",
        justifyContent: "flex-end",
        padding: 3,
      }}
    >
      <View style={{ width: dot, height: dot, borderRadius: dot, backgroundColor: "#D9774B" }} />
    </View>
  );
}

export function ChatList({
  colors,
  badge,
  selected,
  onOpen,
}: {
  colors: Palette;
  badge: string;
  selected: boolean;
  onOpen: () => void;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 }}>
        <Text style={{ fontSize: 20, lineHeight: 26, fontWeight: "700", color: colors.text }}>对话</Text>
      </View>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel="Qbot"
        style={({ pressed }) => ({
          minHeight: 76,
          paddingHorizontal: 16,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          backgroundColor: selected ? colors.selected : pressed ? colors.press : "transparent",
        })}
      >
        <View style={{ width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" }}>
          <Mark />
        </View>
        <View style={{ flex: 1, minWidth: 0, borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 16, lineHeight: 22, fontWeight: "600", color: colors.text }}>Qbot</Text>
            <Text style={{ fontSize: 12, lineHeight: 16, fontWeight: "600", color: colors.accent }}>{badge}</Text>
          </View>
          <Text style={{ marginTop: 2, fontSize: 14, lineHeight: 20, color: colors.muted }} numberOfLines={1}>个人对话</Text>
        </View>
      </Pressable>
    </View>
  );
}

export function ChatEmpty({ colors }: { colors: Palette }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.bg }}>
      <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>点 Qbot 开始对话</Text>
    </View>
  );
}
