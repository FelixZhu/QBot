import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ThreadListItemByIndexProvider } from "@assistant-ui/react-native";
import { useThreadListItemTrigger, useThreadListNew } from "@assistant-ui/core/react";
import { useAuiState } from "@assistant-ui/store";
import { ChatMark } from "./chat-ui/ChatMarks";
import { parseThreadCache, threadStorageKey } from "./chat/threadCache";
import { QbotAvatar } from "./QbotAvatar";
import type { Palette } from "./theme";

export function ConversationList({
  colors,
  statusNote,
  onOpen,
}: {
  colors: Palette;
  statusNote?: string | null;
  onOpen: () => void;
}) {
  const { switchToNewThread } = useThreadListNew();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ height: 52, paddingLeft: 16, paddingRight: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 20, lineHeight: 28, fontWeight: "700", color: colors.text }}>对话</Text>
        <Pressable
          onPress={() => { switchToNewThread(); onOpen(); }}
          accessibilityRole="button"
          accessibilityLabel="新建对话"
          hitSlop={6}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 10,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? colors.press : "transparent",
          })}
        >
          <ChatMark name="pencil" color={colors.text} size={20} />
        </Pressable>
      </View>
      {statusNote ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <Text style={{ fontSize: 12, lineHeight: 16, color: colors.muted }}>{statusNote}</Text>
        </View>
      ) : null}
      <ThreadRows colors={colors} onOpen={onOpen} />
    </View>
  );
}

function ThreadRows({
  colors,
  onOpen,
}: {
  colors: Palette;
  onOpen: () => void;
}) {
  const { switchToNewThread } = useThreadListNew();
  const ids = useAuiState((state) => state.threads.threadIds);
  const loading = useAuiState((state) => state.threads.isLoading);
  const loadError = useAuiState((state) => state.threads.loadError);
  const message = loadError instanceof Error ? loadError.message : loadError ? "会话列表没有载入" : "";
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 4, paddingBottom: 24, flexGrow: 1 }}>
      {message ? <Text style={{ paddingHorizontal: 10, paddingVertical: 12, color: colors.muted, fontSize: 14, lineHeight: 20 }}>{message}</Text> : null}
      {!message && loading && ids.length === 0 ? (
        <Text style={{ paddingHorizontal: 10, paddingVertical: 12, color: colors.muted, fontSize: 14, lineHeight: 20 }}>正在打开</Text>
      ) : null}
      {!message && !loading && ids.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingBottom: 48 }}>
          <QbotAvatar size={48} />
          <Text style={{ marginTop: 16, fontSize: 17, lineHeight: 24, fontWeight: "700", color: colors.text }}>和 QBot 聊聊</Text>
          <Text style={{ marginTop: 6, fontSize: 14, lineHeight: 20, color: colors.muted, textAlign: "center" }}>默认私人助理，随时开始新对话</Text>
          <Pressable
            onPress={() => { switchToNewThread(); onOpen(); }}
            accessibilityRole="button"
            accessibilityLabel="开始新对话"
            style={({ pressed }) => ({
              marginTop: 20,
              minHeight: 44,
              paddingHorizontal: 22,
              borderRadius: 999,
              backgroundColor: colors.btnPrimaryBg,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ fontSize: 15, lineHeight: 20, fontWeight: "700", color: colors.btnPrimaryFg }}>开始新对话</Text>
          </Pressable>
        </View>
      ) : null}
      {ids.map((id, index) => (
        <ThreadListItemByIndexProvider key={id} index={index} archived={false}>
          <ConversationRow colors={colors} onOpen={onOpen} />
        </ThreadListItemByIndexProvider>
      ))}
    </ScrollView>
  );
}

function ConversationRow({
  colors,
  onOpen,
}: {
  colors: Palette;
  onOpen: () => void;
}) {
  const { switchTo } = useThreadListItemTrigger();
  const title = useAuiState((state) => state.threadListItem.title) || "新对话";
  const remoteId = useAuiState((state) => state.threadListItem.remoteId);
  const active = useAuiState((state) => state.threads.mainThreadId === state.threadListItem.id);
  const [preview, setPreview] = useState<{ text: string; time: string }>({ text: "", time: "" });

  useEffect(() => {
    if (!remoteId) return;
    let alive = true;
    AsyncStorage.getItem(threadStorageKey(remoteId)).then((raw) => {
      if (!alive) return;
      const cached = parseThreadCache(raw);
      if (!cached || cached.messages.length === 0) return;
      const last = cached.messages[cached.messages.length - 1];
      if (!last) return;
      const clean = last.content.replace(/\s+/g, " ").trim();
      setPreview({ text: clean, time: formatShortTime(last.createdAt) });
    }).catch(() => {});
    return () => { alive = false; };
  }, [remoteId, active]);

  return (
    <Pressable
      onPress={() => { switchTo(); onOpen(); }}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => ({
        minHeight: 68,
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderRadius: 12,
        justifyContent: "center",
        backgroundColor: active ? colors.selected : pressed ? colors.press : "transparent",
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 16, lineHeight: 22, fontWeight: "700", color: colors.text }} numberOfLines={1}>{title}</Text>
        {preview.time ? (
          <Text style={{ fontSize: 12, lineHeight: 16, color: colors.muted }}>{preview.time}</Text>
        ) : null}
      </View>
      <Text style={{ marginTop: 4, fontSize: 14, lineHeight: 20, color: colors.text2 }} numberOfLines={1}>
        {preview.text || "轻点继续与 QBot 对话"}
      </Text>
      {!active ? (
        <View style={{ position: "absolute", left: 12, right: 12, bottom: 0, height: 1, backgroundColor: colors.line }} />
      ) : null}
    </Pressable>
  );
}

function formatShortTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  if (sameDay) return `今天 ${hh}:${mm}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (date.getFullYear() === yesterday.getFullYear() && date.getMonth() === yesterday.getMonth() && date.getDate() === yesterday.getDate()) {
    return "昨天";
  }
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}-${day}`;
}

export function ChatEmpty({ colors }: { colors: Palette }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.bg }}>
      <QbotAvatar size={48} />
      <Text style={{ marginTop: 14, fontSize: 16, lineHeight: 22, fontWeight: "700", color: colors.text }}>选一则对话开始</Text>
    </View>
  );
}
