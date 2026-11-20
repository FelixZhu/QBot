import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react-native";
import { ChatThreadSurface } from "../chat-ui";
import { liveBadge, liveNote } from "./connectionCopy";
import { createServerHistory } from "./serverHistory";
import { messageUrl } from "./serverClient";
import { createServerChatTransport } from "./liveTransport";
import type { ConnectionView } from "./serverSession";
import type { ServerMessage } from "./serverClient";
import { toModelAdapter } from "./transport";
import { READ_MAX, type Palette } from "../theme";

export function LiveChat({
  colors,
  showBack,
  onBack,
  view,
  onSave,
  onClear,
}: {
  colors: Palette;
  showBack: boolean;
  onBack: () => void;
  view: ConnectionView;
  onSave: (url: string, token: string) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(view.phase !== "ready");
  useEffect(() => {
    if (view.phase !== "ready") setEditing(true);
  }, [view.phase]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ height: 52, alignItems: "center", justifyContent: "center", borderBottomWidth: 1, borderBottomColor: colors.line }}>
        {showBack ? (
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="返回会话列表" hitSlop={8} style={{ position: "absolute", left: 8, width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 28, lineHeight: 32, color: colors.text }}>‹</Text>
          </Pressable>
        ) : null}
        <Text style={{ fontSize: 16, lineHeight: 24, fontWeight: "600", color: colors.text }}>真实对话</Text>
        <Text style={{ position: "absolute", right: 16, fontSize: 12, fontWeight: "600", color: colors.accent }}>{liveBadge(view)}</Text>
      </View>
      {view.phase === "ready" && !editing ? (
        <LiveThread colors={colors} view={view} onEdit={() => setEditing(true)} />
      ) : (
        <ServerForm
          colors={colors}
          view={view}
          onSave={onSave}
          onClear={onClear}
          onConnected={() => setEditing(false)}
          onClose={view.phase === "ready" ? () => setEditing(false) : undefined}
        />
      )}
    </View>
  );
}

function ServerForm({
  colors,
  view,
  onSave,
  onClear,
  onConnected,
  onClose,
}: {
  colors: Palette;
  view: ConnectionView;
  onSave: (url: string, token: string) => Promise<void>;
  onClear: () => Promise<void>;
  onConnected: () => void;
  onClose?: () => void;
}) {
  const [url, setUrl] = useState(view.phase === "ready" ? view.origin : "");
  const [token, setToken] = useState("");
  const [localError, setLocalError] = useState<string | null>(view.phase === "error" ? view.message : null);
  const [saving, setSaving] = useState(false);
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <Text style={{ fontSize: 14, lineHeight: 22, color: colors.muted }}>
        访问令牌由服务器管理员另行给你，不要写进对话。它只进这台设备的安全存储。模型密钥只在服务器上。地址填 HTTPS 根地址；如果粘贴了 /health，也会按根地址连接。
      </Text>
      <TextInput
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="https://chat.example"
        placeholderTextColor={colors.muted}
        accessibilityLabel="服务器地址"
        style={field(colors)}
      />
      <TextInput
        value={token}
        onChangeText={setToken}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        placeholder={view.phase === "ready" ? "已保存在安全存储" : "访问令牌"}
        placeholderTextColor={colors.muted}
        accessibilityLabel="访问令牌"
        style={field(colors)}
      />
      {localError ? <Text style={{ color: colors.accent, fontSize: 14, lineHeight: 20 }}>{localError}</Text> : null}
      {view.phase === "checking" || saving ? <Text style={{ marginTop: 8, color: colors.muted }}>正在核对服务器…</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="保存服务器"
        disabled={saving}
        onPress={() => {
          setSaving(true);
          setLocalError(null);
          void onSave(url, token).then(() => {
            setSaving(false);
            onConnected();
          }).catch((error: unknown) => {
            setSaving(false);
            setLocalError(error instanceof Error ? error.message : "无法连接服务器");
          });
        }}
        style={{ marginTop: 16, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.bubbleMe }}
      >
        <Text style={{ color: colors.bubbleMeText, fontWeight: "700" }}>连接并进入对话</Text>
      </Pressable>
      {view.phase === "ready" || view.phase === "error" ? (
        <Pressable accessibilityRole="button" accessibilityLabel="清除服务器" onPress={() => { void onClear(); }} style={{ marginTop: 12, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.muted }}>清除</Text>
        </Pressable>
      ) : null}
      {onClose ? (
        <Pressable accessibilityRole="button" accessibilityLabel="返回真实对话" onPress={onClose} style={{ marginTop: 8, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.text }}>返回对话</Text>
        </Pressable>
      ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function LiveThread({ colors, view, onEdit }: { colors: Palette; view: Extract<ConnectionView, { phase: "ready" }>; onEdit: () => void }) {
  const [loaded, setLoaded] = useState<ServerMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancel = false;
    view.client.listMessages(view.conversationId).then((messages) => {
      if (!cancel) setLoaded(messages);
    }).catch((reason: unknown) => {
      if (!cancel) setError(reason instanceof Error ? reason.message : "无法读取会话");
    });
    return () => { cancel = true; };
  }, [view.client, view.conversationId]);
  if (error) return <Text style={{ padding: 24, color: colors.accent }}>{error}</Text>;
  if (!loaded) return <Text style={{ padding: 24, color: colors.muted }}>正在读取服务器上的会话…</Text>;
  return <LiveRuntime colors={colors} view={view} onEdit={onEdit} />;
}

function LiveRuntime({ colors, view, onEdit }: { colors: Palette; view: Extract<ConnectionView, { phase: "ready" }>; onEdit: () => void }) {
  const transport = useMemo(() => createServerChatTransport({
    url: messageUrl(view.origin, view.conversationId),
    token: view.token,
  }), [view.origin, view.conversationId, view.token]);
  const history = useMemo(() => createServerHistory(() => view.client.listMessages(view.conversationId)), [view.client, view.conversationId]);
  const adapter = useMemo(() => toModelAdapter(transport), [transport]);
  const runtime = useLocalRuntime(adapter, { adapters: { history } });
  const listHeader = useMemo(() => (
    <Text style={{ fontSize: 12, lineHeight: 18, color: colors.muted, textAlign: "center", marginBottom: 12 }}>{liveNote(view.session)}</Text>
  ), [colors.muted, view.session]);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <View style={{ flex: 1, width: "100%", maxWidth: READ_MAX, alignSelf: "center" }}>
        <ChatThreadSurface colors={colors} listHeader={listHeader} bottomSafeArea="parent" />
        <Pressable accessibilityRole="button" accessibilityLabel="服务器设置" onPress={onEdit} style={{ alignItems: "center", paddingBottom: 8 }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>服务器</Text>
        </Pressable>
      </View>
    </AssistantRuntimeProvider>
  );
}

function field(colors: Palette) {
  return {
    marginTop: 12,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    color: colors.text,
    backgroundColor: colors.raised,
  } as const;
}
