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
  const [problem, setProblem] = useState<string | null>(null);
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
    setProblem(null);
    switchToNewThread();
  };
  return (
    <View style={{ paddingHorizontal: 8, paddingBottom: problem ? 8 : 0 }}>
      <View style={{ height: 48, flexDirection: "row", alignItems: "center" }}>
        {showBack ? (
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="返回会话列表" hitSlop={8} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
            <ChatMark name="menu" color={chrome.text} size={20} />
          </Pressable>
        ) : <View style={{ width: 40 }} />}
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <QbotAvatar size={32} />
          <Text style={{ fontSize: 17, lineHeight: 24, fontWeight: "700", color: chrome.text }}>QBot</Text>
        </View>
        <Pressable onPress={start} disabled={view.phase !== "ready"} accessibilityRole="button" accessibilityLabel="新建对话" hitSlop={8} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", opacity: view.phase === "ready" ? 1 : 0.4 }}>
          <ChatMark name="pencil" color={chrome.text} size={20} />
        </Pressable>
        <Pressable onPress={() => setMore((open) => !open)} accessibilityRole="button" accessibilityLabel="更多" hitSlop={8} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
          <ChatMark name="more" color={chrome.text} size={20} />
        </Pressable>
      </View>
      {syncLine ? (
        <Text style={{ textAlign: "center", color: chrome.muted, fontSize: 12, lineHeight: 16, marginBottom: 4 }}>{syncLine}</Text>
      ) : null}
      {problem ? <Text style={{ color: chrome.inkText, fontSize: 13, lineHeight: 18, paddingHorizontal: 8 }}>{problem}</Text> : null}
      {more ? (
        <View style={{ marginHorizontal: 8, marginBottom: 8, borderRadius: 16, backgroundColor: chrome.composer, borderWidth: 1, borderColor: chrome.line, padding: 14, gap: 12 }}>
          <Text style={{ color: chrome.muted, fontSize: 13, lineHeight: 18 }}>{liveNote(view)}</Text>
          <Pressable onPress={() => { setMore(false); start(); }} accessibilityRole="button" accessibilityLabel="新建对话">
            <Text style={{ color: chrome.text, fontSize: 15, lineHeight: 22 }}>新建对话</Text>
          </Pressable>
          {onManageToken ? (
            <Pressable onPress={() => { setMore(false); onManageToken(); }} accessibilityRole="button" accessibilityLabel="访问口令">
              <Text style={{ color: chrome.text, fontSize: 15, lineHeight: 22 }}>访问口令</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
