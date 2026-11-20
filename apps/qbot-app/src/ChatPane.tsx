import { Pressable, ScrollView, Text, View } from "react-native";
import { ThreadListItemByIndexProvider } from "@assistant-ui/react-native";
import { useThreadListItemTrigger, useThreadListNew } from "@assistant-ui/core/react";
import { useAuiState } from "@assistant-ui/store";
import { QbotAvatar } from "./QbotAvatar";
import type { Palette } from "./theme";

export function ConversationList({
  colors,
  badge,
  onOpen,
}: {
  colors: Palette;
  badge: string;
  onOpen: () => void;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 }}>
        <Text style={{ fontSize: 20, lineHeight: 26, fontWeight: "700", color: colors.text }}>对话</Text>
      </View>
      <NewConversation colors={colors} onOpen={onOpen} />
      <ThreadRows colors={colors} badge={badge} onOpen={onOpen} />
    </View>
  );
}

function ThreadRows({
  colors,
  badge,
  onOpen,
}: {
  colors: Palette;
  badge: string;
  onOpen: () => void;
}) {
  const ids = useAuiState((state) => state.threads.threadIds);
  const loading = useAuiState((state) => state.threads.isLoading);
  const loadError = useAuiState((state) => state.threads.loadError);
  const message = loadError instanceof Error ? loadError.message : loadError ? "会话列表没有载入" : "";
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
      {message ? <Text style={{ paddingHorizontal: 16, color: colors.muted }}>{message}</Text> : null}
      {!message && loading && ids.length === 0 ? <Text style={{ paddingHorizontal: 16, color: colors.muted }}>正在打开</Text> : null}
      {!message && !loading && ids.length === 0 ? <Text style={{ paddingHorizontal: 16, color: colors.muted }}>没有会话</Text> : null}
      {ids.map((id, index) => (
        <ThreadListItemByIndexProvider key={id} index={index} archived={false}>
          <ConversationRow colors={colors} badge={badge} onOpen={onOpen} />
        </ThreadListItemByIndexProvider>
      ))}
    </ScrollView>
  );
}

function NewConversation({ colors, onOpen }: { colors: Palette; onOpen: () => void }) {
  const { switchToNewThread } = useThreadListNew();
  return (
    <Pressable
      onPress={() => { switchToNewThread(); onOpen(); }}
      accessibilityRole="button"
      accessibilityLabel="新建对话"
      style={({ pressed }) => ({
        minHeight: 52,
        paddingHorizontal: 16,
        justifyContent: "center",
        backgroundColor: pressed ? colors.press : "transparent",
      })}
    >
      <Text style={{ fontSize: 16, lineHeight: 22, fontWeight: "600", color: colors.accentInk }}>新建对话</Text>
    </Pressable>
  );
}

function ConversationRow({
  colors,
  badge,
  onOpen,
}: {
  colors: Palette;
  badge: string;
  onOpen: () => void;
}) {
  const { switchTo } = useThreadListItemTrigger();
  const title = useAuiState((state) => state.threadListItem.title) || "新对话";
  const active = useAuiState((state) => state.threads.mainThreadId === state.threadListItem.id);
  return (
    <Pressable
      onPress={() => { switchTo(); onOpen(); }}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => ({
        minHeight: 76,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        backgroundColor: active ? colors.selected : pressed ? colors.press : "transparent",
      })}
    >
      <QbotAvatar size={48} />
      <View style={{ flex: 1, minWidth: 0, borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ flex: 1, fontSize: 16, lineHeight: 22, fontWeight: "600", color: colors.text }} numberOfLines={1}>{title}</Text>
          <Text style={{ fontSize: 12, lineHeight: 16, fontWeight: "600", color: colors.accentInk }}>{badge}</Text>
        </View>
        <Text style={{ marginTop: 2, fontSize: 14, lineHeight: 20, color: colors.muted }} numberOfLines={1}>个人对话</Text>
      </View>
    </Pressable>
  );
}

export function ChatEmpty({ colors }: { colors: Palette }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.bg }}>
      <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>点一则对话开始</Text>
    </View>
  );
}
