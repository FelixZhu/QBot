import { useEffect, useState } from "react";
import { BackHandler, Platform, Pressable, Text, View } from "react-native";
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
  onManageToken,
  active = true,
}: {
  scheme: Scheme;
  showBack: boolean;
  onBack: () => void;
  view: ConnectionView;
  onOpenLibrary?: () => void;
  onManageToken?: () => void;
  active?: boolean;
}) {
  const chrome = chatChrome(scheme);
  const syncLine = useSyncLine();
  return (
    <View style={{ flex: 1, backgroundColor: chrome.canvas }}>
      <View style={{ flex: 1, width: "100%", maxWidth: READ_MAX, alignSelf: "center" }}>
        <ChatHeader scheme={scheme} showBack={showBack} onBack={onBack} view={view} syncLine={syncLine} onManageToken={onManageToken} />
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
  onManageToken,
}: {
  scheme: Scheme;
  showBack: boolean;
  onBack: () => void;
  view: ConnectionView;
  syncLine: string | null;
  onManageToken?: () => void;
}) {
  const chrome = chatChrome(scheme);
  const { switchToNewThread } = useThreadListNew();
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (!more || Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setMore(false);
      return true;
    });
    return () => sub.remove();
  }, [more]);
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
        {onManageToken ? (
          <Pressable
            onPress={() => setMore((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel="更多"
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
            <ChatMark name="more" color={chrome.text} size={20} />
          </Pressable>
        ) : null}
      </View>
      {syncLine ? (
        <Text style={{ textAlign: "center", color: chrome.muted, fontSize: 12, lineHeight: 16, paddingBottom: 6 }}>{syncLine}</Text>
      ) : null}
      {more && onManageToken ? (
        <View style={{ marginHorizontal: 12, marginBottom: 10, borderRadius: 14, backgroundColor: chrome.composer, borderWidth: 1, borderColor: chrome.line, padding: 14, gap: 10 }}>
          <Pressable
            onPress={() => { setMore(false); onManageToken(); }}
            accessibilityRole="button"
            accessibilityLabel="访问口令"
            style={{ minHeight: 36, justifyContent: "center" }}
          >
            <Text style={{ color: chrome.text, fontSize: 15, lineHeight: 22, fontWeight: "700" }}>访问口令</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
