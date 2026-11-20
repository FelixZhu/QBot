import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
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
  onEnroll,
  onClear,
}: {
  colors: Palette;
  showBack: boolean;
  onBack: () => void;
  view: ConnectionView;
  onEnroll: (setup: string) => Promise<void>;
  onClear: () => Promise<void>;
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
      <LiveRuntime key={view.phase === "ready" ? view.conversationId : "offline"} colors={colors} view={view} onEnroll={onEnroll} onClear={onClear} />
    </View>
  );
}

function LiveRuntime({
  colors,
  view,
  onEnroll,
  onClear,
}: {
  colors: Palette;
  view: ConnectionView;
  onEnroll: (setup: string) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const ready = view.phase === "ready" ? view : null;
  const transport = useMemo(() => ready
    ? createServerChatTransport({ url: messageUrl(ready.origin, ready.conversationId), token: ready.token })
    : unavailableTransport(), [ready]);
  const history = useMemo(() => ready
    ? createServerHistory(() => ready.client.listMessages(ready.conversationId))
    : { load: async () => ({ headId: null, messages: [] }), append: async () => {}, update: async () => {} }, [ready]);
  const adapter = useMemo(() => toModelAdapter(transport), [transport]);
  const runtime = useLocalRuntime(adapter, { adapters: { history } });
  const listHeader = useMemo(() => (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ fontSize: 12, lineHeight: 18, color: colors.muted, textAlign: "center" }}>{liveNote(view)}</Text>
      {ready ? null : <EnrollStrip colors={colors} busy={view.phase === "checking"} onEnroll={onEnroll} />}
      {view.phase === "ready" || view.phase === "error" ? (
        <Pressable accessibilityRole="button" accessibilityLabel="清除这台设备的连接" onPress={() => { void onClear(); }} style={{ alignItems: "center", marginTop: 8 }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>清除这台设备的连接</Text>
        </Pressable>
      ) : null}
    </View>
  ), [colors, onClear, onEnroll, ready, view]);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <View style={{ flex: 1, width: "100%", maxWidth: READ_MAX, alignSelf: "center" }}>
        <ChatThreadSurface colors={colors} listHeader={listHeader} bottomSafeArea="parent" />
      </View>
    </AssistantRuntimeProvider>
  );
}

function EnrollStrip({ colors, busy, onEnroll }: { colors: Palette; busy: boolean; onEnroll: (setup: string) => Promise<void> }) {
  const [setup, setSetup] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={{ marginTop: 12 }}>
      <TextInput
        value={setup}
        onChangeText={setSetup}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="连接码"
        placeholderTextColor={colors.muted}
        accessibilityLabel="连接码"
        style={{
          minHeight: 44,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: 12,
          paddingHorizontal: 12,
          color: colors.text,
          backgroundColor: colors.raised,
        }}
      />
      {error ? <Text style={{ marginTop: 8, color: colors.accent, fontSize: 14, lineHeight: 20 }}>{error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="连接"
        disabled={busy}
        onPress={() => {
          setError(null);
          void onEnroll(setup).catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : "无法连接");
          });
        }}
        style={{ marginTop: 8, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.bubbleMe }}
      >
        <Text style={{ color: colors.bubbleMeText, fontWeight: "700" }}>{busy ? "正在连接" : "连接"}</Text>
      </Pressable>
    </View>
  );
}

function unavailableTransport(): ChatTransport {
  return {
    label: "未连接",
    async *reply(): AsyncGenerator<string> {
      throw new Error("这台设备还没有连接");
    },
  };
}
