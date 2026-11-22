import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react-native";
import { ChatThreadSurface } from "../chat-ui";
import { liveBadge, liveNote } from "./connectionCopy";
import { createServerHistory } from "./serverHistory";
import { messageUrl } from "./serverClient";
import { createServerChatTransport } from "./liveTransport";
import type { ConnectionView } from "./serverSession";
import { toModelAdapter, type ChatTransport } from "./transport";
import { READ_MAX, type Palette } from "../theme";

export function LiveChat({
  colors,
  showBack,
  onBack,
  view,
}: {
  colors: Palette;
  showBack: boolean;
  onBack: () => void;
  view: ConnectionView;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ height: 52, alignItems: "center", justifyContent: "center", borderBottomWidth: 1, borderBottomColor: colors.line }}>
        {showBack ? (
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="返回会话列表" hitSlop={8} style={{ position: "absolute", left: 8, width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 28, lineHeight: 32, color: colors.text }}>‹</Text>
          </Pressable>
        ) : null}
        <Text style={{ fontSize: 16, lineHeight: 24, fontWeight: "600", color: colors.text }}>Qbot</Text>
        <Text style={{ position: "absolute", right: 16, fontSize: 12, fontWeight: "600", color: colors.accent }}>{liveBadge(view)}</Text>
      </View>
      <LiveRuntime key={view.phase === "ready" ? view.conversationId : "offline"} colors={colors} view={view} />
    </View>
  );
}

function LiveRuntime({ colors, view }: { colors: Palette; view: ConnectionView }) {
  const ready = view.phase === "ready" ? view : null;
  const transport = useMemo(() => ready
    ? createServerChatTransport({ url: messageUrl(ready.origin, ready.conversationId) })
    : unavailableTransport(view.phase === "error" ? view.message : "正在连接。"), [ready, view]);
  const history = useMemo(() => ready
    ? createServerHistory(() => ready.client.listMessages(ready.conversationId))
    : { load: async () => ({ headId: null, messages: [] }), append: async () => {}, update: async () => {} }, [ready]);
  const adapter = useMemo(() => toModelAdapter(transport), [transport]);
  const runtime = useLocalRuntime(adapter, { adapters: { history } });
  const listHeader = useMemo(() => (
    <Text style={{ fontSize: 12, lineHeight: 18, color: colors.muted, textAlign: "center", marginBottom: 12 }}>{liveNote(view)}</Text>
  ), [colors.muted, view]);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <View style={{ flex: 1, width: "100%", maxWidth: READ_MAX, alignSelf: "center" }}>
        <ChatThreadSurface colors={colors} listHeader={listHeader} bottomSafeArea="parent" />
      </View>
    </AssistantRuntimeProvider>
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
