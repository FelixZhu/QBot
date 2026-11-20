import { useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Platform, Pressable, Text, View } from "react-native";
import { AssistantRuntimeProvider, useAui, useLocalRuntime } from "@assistant-ui/react-native";
import { ChatThreadSurface } from "../chat-ui";
import { ChatMark } from "../chat-ui/ChatMarks";
import { QbotAvatar } from "../QbotAvatar";
import { liveNote } from "./connectionCopy";
import { createServerHistory, toRepository } from "./serverHistory";
import { messageUrl, type ServerMessage } from "./serverClient";
import { createServerChatTransport } from "./liveTransport";
import type { ConnectionView } from "./serverSession";
import { syncLabel, type ThreadView } from "./useServerConnection";
import { toModelAdapter } from "./transport";
import { READ_MAX, chatChrome, type Scheme } from "../theme";

export function LiveChat({
  scheme,
  showBack,
  onBack,
  view,
  onNewConversation,
  onOpenLibrary,
  active = true,
}: {
  scheme: Scheme;
  showBack: boolean;
  onBack: () => void;
  view: ThreadView;
  onNewConversation: () => Promise<void>;
  onOpenLibrary?: () => void;
  active?: boolean;
}) {
  const chrome = chatChrome(scheme);
  return (
    <View style={{ flex: 1, backgroundColor: chrome.canvas }}>
      {view.phase === "ready" ? (
        <LiveRuntime
          key={view.conversationId}
          scheme={scheme}
          showBack={showBack}
          onBack={onBack}
          view={view}
          onNewConversation={onNewConversation}
          onOpenLibrary={onOpenLibrary}
          active={active}
        />
      ) : (
        <View style={{ flex: 1, width: "100%", maxWidth: READ_MAX, alignSelf: "center" }}>
          <ChatHeader
            scheme={scheme}
            showBack={showBack}
            onBack={onBack}
            view={view}
            onNewConversation={onNewConversation}
            syncLine={syncLabel(view)}
          />
        </View>
      )}
    </View>
  );
}

function LiveRuntime({
  scheme,
  showBack,
  onBack,
  view,
  onNewConversation,
  onOpenLibrary,
  active,
}: {
  scheme: Scheme;
  showBack: boolean;
  onBack: () => void;
  view: ThreadView;
  onNewConversation: () => Promise<void>;
  onOpenLibrary?: () => void;
  active: boolean;
}) {
  const ready = view.phase === "ready" ? view : null;
  const seeded = useRef(ready?.messages ?? []);
  const origin = ready?.origin ?? "";
  const conversationId = ready?.conversationId ?? "";
  const transport = useMemo(
    () => createServerChatTransport({ url: messageUrl(origin, conversationId) }),
    [origin, conversationId],
  );
  const history = useMemo(() => createServerHistory(async () => seeded.current), []);
  const adapter = useMemo(() => toModelAdapter(transport), [transport]);
  const runtime = useLocalRuntime(adapter, { adapters: { history } });
  const listHeader = useMemo(() => {
    if (!ready?.session.model || ready.session.upstream !== "fixture") return undefined;
    return (
      <Text style={{ fontSize: 13, lineHeight: 18, color: chatChrome(scheme).muted, marginBottom: 12 }}>{liveNote(view)}</Text>
    );
  }, [ready, scheme, view]);
  if (!ready) return null;
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SyncMessages messages={ready.messages} revision={ready.revision} />
      <View style={{ flex: 1, width: "100%", maxWidth: READ_MAX, alignSelf: "center" }}>
        <ChatHeader
          scheme={scheme}
          showBack={showBack}
          onBack={onBack}
          view={view}
          onNewConversation={onNewConversation}
          syncLine={syncLabel(view)}
        />
        <ChatThreadSurface
          scheme={scheme}
          listHeader={listHeader}
          bottomSafeArea="self"
          active={active}
          onOpenLibrary={onOpenLibrary}
          localSample={view.phase === "ready" && view.session.upstream === "fixture"}
        />
      </View>
    </AssistantRuntimeProvider>
  );
}

function SyncMessages({ messages, revision }: { messages: ServerMessage[]; revision: number }) {
  const aui = useAui();
  const applied = useRef(revision);
  useEffect(() => {
    if (applied.current === revision) return;
    applied.current = revision;
    aui.thread().import(toRepository(messages));
  }, [aui, messages, revision]);
  return null;
}

function ChatHeader({
  scheme,
  showBack,
  onBack,
  view,
  onNewConversation,
  syncLine,
}: {
  scheme: Scheme;
  showBack: boolean;
  onBack: () => void;
  view: ConnectionView;
  onNewConversation: () => Promise<void>;
  syncLine: string | null;
}) {
  const chrome = chatChrome(scheme);
  const [more, setMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!more || Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setMore(false);
      return true;
    });
    return () => sub.remove();
  }, [more]);
  const start = async () => {
    if (creating || view.phase !== "ready") return;
    setCreating(true);
    setProblem(null);
    try {
      await onNewConversation();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "没有建成新对话");
    } finally {
      setCreating(false);
    }
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
          <Text style={{ fontSize: 17, lineHeight: 24, fontWeight: "700", color: chrome.text }}>Qbot</Text>
        </View>
        <Pressable onPress={() => { void start(); }} disabled={view.phase !== "ready" || creating} accessibilityRole="button" accessibilityLabel="新对话" hitSlop={8} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", opacity: view.phase === "ready" ? 1 : 0.4 }}>
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
          <Pressable onPress={() => { setMore(false); void start(); }} accessibilityRole="button" accessibilityLabel="新对话">
            <Text style={{ color: chrome.text, fontSize: 15, lineHeight: 22 }}>新对话</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
