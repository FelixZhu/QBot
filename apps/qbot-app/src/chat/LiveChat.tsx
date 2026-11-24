import { Pressable, Text, View } from "react-native";
import { useThreadListNew } from "@assistant-ui/core/react";
import { ChatThreadSurface } from "../chat-ui";
import { ChatMark } from "../chat-ui/ChatMarks";
import { QbotAvatar } from "../QbotAvatar";
import { liveNote } from "./connectionCopy";
import type { ConnectionView } from "./serverSession";
import { useSyncLine } from "./useChatRuntime";
import { READ_MAX, chatChrome, type Scheme } from "../theme";

export function LiveChat({
  scheme,
  showBack,
  onBack,
  view,
  onOpenLibrary,
  active = true,
}: {
  scheme: Scheme;
  showBack: boolean;
  onBack: () => void;
  view: ConnectionView;
  onOpenLibrary?: () => void;
  active?: boolean;
}) {
  const chrome = chatChrome(scheme);
  const syncLine = useSyncLine();
  return (
    <View style={{ flex: 1, backgroundColor: chrome.canvas }}>
      <View style={{ flex: 1, width: "100%", maxWidth: READ_MAX, alignSelf: "center" }}>
        <ChatHeader scheme={scheme} showBack={showBack} onBack={onBack} view={view} syncLine={syncLine} />
        <ChatThreadSurface
          scheme={scheme}
          listHeader={view.phase === "ready" && view.session.upstream === "fixture" ? (
            <Text style={{ fontSize: 13, lineHeight: 18, color: chrome.muted, marginBottom: 12 }}>{liveNote(view)}</Text>
          ) : undefined}
          bottomSafeArea="self"
          active={active}
          onOpenLibrary={onOpenLibrary}
          localSample={view.phase === "ready" && view.session.upstream === "fixture"}
        />
      </View>
    </View>
  );
}

function ChatHeader({
  scheme,
  showBack,
  onBack,
  view,
  syncLine,
}: {
  scheme: Scheme;
  showBack: boolean;
  onBack: () => void;
  view: ConnectionView;
  syncLine: string | null;
}) {
  const chrome = chatChrome(scheme);
  const { switchToNewThread } = useThreadListNew();
  const start = () => {
    if (view.phase !== "ready") return;
    switchToNewThread();
  };
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: chrome.line }}>
      <View style={{ height: 52, paddingHorizontal: 6, flexDirection: "row", alignItems: "center" }}>
        {showBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="返回会话列表"
            hitSlop={6}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: 10,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.65 : 1,
            })}
          >
            <ChatMark name="back" color={chrome.text} size={22} />
          </Pressable>
        ) : <View style={{ width: 44 }} />}
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <QbotAvatar size={28} />
          <Text style={{ fontSize: 17, lineHeight: 24, fontWeight: "700", color: chrome.text }}>QBot</Text>
        </View>
        <Pressable
          onPress={start}
          disabled={view.phase !== "ready"}
          accessibilityRole="button"
          accessibilityLabel="新建对话"
          hitSlop={6}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 10,
            alignItems: "center",
            justifyContent: "center",
            opacity: view.phase !== "ready" ? 0.35 : pressed ? 0.65 : 1,
          })}
        >
          <ChatMark name="pencil" color={chrome.text} size={20} />
        </Pressable>
      </View>
      {syncLine ? (
        <Text style={{ textAlign: "center", color: chrome.muted, fontSize: 12, lineHeight: 16, paddingBottom: 6 }}>{syncLine}</Text>
      ) : null}
    </View>
  );
}
