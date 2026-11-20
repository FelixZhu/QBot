import { useMemo, useState, useEffect } from "react";
import { BackHandler, Platform, Pressable, Text, View } from "react-native";
import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react-native";
import { ChatThreadSurface } from "../chat-ui";
import { ChatMark } from "../chat-ui/ChatMarks";
import { liveNote } from "./connectionCopy";
import { createServerHistory } from "./serverHistory";
import { messageUrl } from "./serverClient";
import { createServerChatTransport } from "./liveTransport";
import type { ConnectionView } from "./serverSession";
import { toModelAdapter, type ChatTransport } from "./transport";
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
  view: ConnectionView;
  onNewConversation: () => Promise<void>;
  onOpenLibrary?: () => void;
  active?: boolean;
}) {
  const chrome = chatChrome(scheme);
  return (
    <View style={{ flex: 1, backgroundColor: chrome.canvas }}>
      <LiveRuntime
        key={view.phase === "ready" ? view.conversationId : "offline"}
        scheme={scheme}
        showBack={showBack}
        onBack={onBack}
        view={view}
        onNewConversation={onNewConversation}
        onOpenLibrary={onOpenLibrary}
        active={active}
      />
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
  view: ConnectionView;
  onNewConversation: () => Promise<void>;
  onOpenLibrary?: () => void;
  active: boolean;
}) {
  const ready = view.phase === "ready" ? view : null;
  const transport = useMemo(() => ready
    ? createServerChatTransport({ url: messageUrl(ready.origin, ready.conversationId) })
    : unavailableTransport(view.phase === "error" ? view.message : "正在连接。"), [ready, view]);
  const history = useMemo(() => ready
    ? createServerHistory(() => ready.client.listMessages(ready.conversationId))
    : { load: async () => ({ headId: null, messages: [] }), append: async () => {}, update: async () => {} }, [ready]);
  const adapter = useMemo(() => toModelAdapter(transport), [transport]);
  const runtime = useLocalRuntime(adapter, { adapters: { history } });
  const listHeader = useMemo(() => {
    if (view.phase === "ready" && view.session.upstream !== "fixture") return undefined;
    return (
      <Text style={{ fontSize: 13, lineHeight: 18, color: chatChrome(scheme).muted, marginBottom: 12 }}>{liveNote(view)}</Text>
    );
  }, [scheme, view]);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <View style={{ flex: 1, width: "100%", maxWidth: READ_MAX, alignSelf: "center" }}>
        <ChatHeader scheme={scheme} showBack={showBack} onBack={onBack} view={view} onNewConversation={onNewConversation} />
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

function ChatHeader({
  scheme,
  showBack,
  onBack,
  view,
  onNewConversation,
}: {
  scheme: Scheme;
  showBack: boolean;
  onBack: () => void;
  view: ConnectionView;
  onNewConversation: () => Promise<void>;
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
        <Text style={{ flex: 1, textAlign: "center", fontSize: 17, lineHeight: 24, fontWeight: "700", color: chrome.text }}>Qbot</Text>
        <Pressable onPress={() => { void start(); }} disabled={view.phase !== "ready" || creating} accessibilityRole="button" accessibilityLabel="新对话" hitSlop={8} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", opacity: view.phase === "ready" ? 1 : 0.4 }}>
          <ChatMark name="pencil" color={chrome.text} size={20} />
        </Pressable>
        <Pressable onPress={() => setMore((open) => !open)} accessibilityRole="button" accessibilityLabel="更多" hitSlop={8} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
          <ChatMark name="more" color={chrome.text} size={20} />
        </Pressable>
      </View>
      {problem ? <Text style={{ color: chrome.send, fontSize: 13, lineHeight: 18, paddingHorizontal: 8 }}>{problem}</Text> : null}
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

function unavailableTransport(message: string): ChatTransport {
  return {
    label: "未连接",
    async *reply(): AsyncGenerator<string> {
      throw new Error(message);
    },
  };
}
