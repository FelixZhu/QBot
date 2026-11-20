import { useMemo } from "react";
import {
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
} from "@assistant-ui/react-native";
import { deviceChatStorage } from "./chat/deviceStorage";
import { createDemoHistory } from "./chat/history";
import { createLocalTransport } from "./chat/local";
import { toModelAdapter } from "./chat/transport";
import { ChatThreadSurface } from "./chat-ui";
import {
  filterDemos,
  type Demo,
  type DemoId,
} from "./demos";
import { READ_MAX, type Palette } from "./theme";

function Mark({ size = 28 }: { size?: number }) {
  const dot = Math.max(6, Math.round(size * 0.28));
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        backgroundColor: "#1C1B19",
        alignItems: "flex-end",
        justifyContent: "flex-end",
        padding: 3,
      }}
    >
      <View style={{ width: dot, height: dot, borderRadius: dot, backgroundColor: "#D9774B" }} />
    </View>
  );
}

export function ChatList({
  colors,
  query,
  onQuery,
  selected,
  onOpen,
  subtitle,
  liveLabel,
  liveBadge,
  liveSelected,
  onOpenLive,
}: {
  colors: Palette;
  query: string;
  onQuery: (value: string) => void;
  selected: DemoId | null;
  onOpen: (id: DemoId) => void;
  subtitle: string;
  liveLabel: string;
  liveBadge: string;
  liveSelected: boolean;
  onOpenLive: () => void;
}) {
  const rows = filterDemos(query);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
        <Text style={{ fontSize: 20, lineHeight: 26, fontWeight: "700", color: colors.text }}>对话</Text>
        <Text style={{ marginTop: 2, fontSize: 12, lineHeight: 16, color: colors.muted }}>{subtitle}</Text>
      </View>
      <View
        style={{
          marginHorizontal: 16,
          marginVertical: 8,
          height: 40,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.raised,
          paddingHorizontal: 12,
          justifyContent: "center",
        }}
      >
        <TextInput
          value={query}
          onChangeText={onQuery}
          placeholder="搜索对话"
          placeholderTextColor={colors.muted}
          style={{ fontSize: 14, color: colors.text, padding: 0 }}
          autoCorrect={false}
          accessibilityLabel="搜索对话"
        />
      </View>
      <Pressable
        onPress={onOpenLive}
        accessibilityRole="button"
        accessibilityLabel={liveLabel}
        style={({ pressed }) => ({
          minHeight: 76,
          paddingHorizontal: 16,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          backgroundColor: liveSelected ? colors.selected : pressed ? colors.press : "transparent",
        })}
      >
        <View style={{ width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" }}>
          <Mark />
        </View>
        <View style={{ flex: 1, minWidth: 0, borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 16, lineHeight: 22, fontWeight: "600", color: colors.text }}>真实对话</Text>
            <Text style={{ fontSize: 12, lineHeight: 16, fontWeight: "600", color: colors.accent }}>{liveBadge}</Text>
          </View>
          <Text style={{ marginTop: 2, fontSize: 14, lineHeight: 20, color: colors.muted }} numberOfLines={1}>服务器上的会话</Text>
        </View>
      </Pressable>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={{ padding: 32, alignItems: "center" }}>
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>没有匹配的会话</Text>
            <Text style={{ marginTop: 6, fontSize: 14, color: colors.muted }}>换个词，或清空搜索。</Text>
          </View>
        }
        renderItem={({ item }) => {
          const active = item.id === selected;
          return (
            <Pressable
              onPress={() => onOpen(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}，演示`}
              style={({ pressed }) => ({
                minHeight: 76,
                paddingHorizontal: 16,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                backgroundColor: active ? colors.selected : pressed ? colors.press : "transparent",
              })}
            >
              {active ? (
                <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: colors.accent }} />
              ) : null}
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: colors.line,
                  backgroundColor: colors.raised,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Mark />
              </View>
              <View style={{ flex: 1, minWidth: 0, borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 14 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ flex: 1, minWidth: 0, fontSize: 16, lineHeight: 22, fontWeight: "600", color: colors.text }} numberOfLines={1} ellipsizeMode="tail">
                    {item.name}
                  </Text>
                  <Text style={{ fontSize: 12, lineHeight: 16, fontWeight: "600", color: colors.accent }}>演示</Text>
                </View>
                <Text style={{ marginTop: 2, fontSize: 14, lineHeight: 20, color: colors.muted }} numberOfLines={1} ellipsizeMode="tail">
                  {item.preview}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function ThreadBody({ demo, colors, onBack, showBack }: { demo: Demo; colors: Palette; onBack: () => void; showBack: boolean }) {
  const transport = useMemo(() => createLocalTransport(demo.id), [demo.id]);
  const adapter = useMemo(() => toModelAdapter(transport), [transport]);
  const history = useMemo(() => createDemoHistory(deviceChatStorage, demo.id), [demo.id]);
  const initialMessages = useMemo(
    () => demo.messages.map((line, index) => ({
      id: `${demo.id}-${index}`,
      role: line.role,
      content: line.text,
    })),
    [demo],
  );
  const runtime = useLocalRuntime(adapter, { initialMessages, adapters: { history } });
  const listHeader = useMemo(() => (
    <Text style={{ fontSize: 12, lineHeight: 18, color: colors.muted, textAlign: "center", marginBottom: 12 }}>
      {demo.note}
    </Text>
  ), [colors.muted, demo.note]);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ height: 52, alignItems: "center", justifyContent: "center", borderBottomWidth: 1, borderBottomColor: colors.line }}>
          {showBack ? (
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="返回会话列表"
              hitSlop={8}
              style={({ pressed }) => ({
                position: "absolute",
                left: 8,
                width: 44,
                height: 44,
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? colors.press : "transparent",
              })}
            >
              <Text style={{ fontSize: 28, lineHeight: 32, color: colors.text }}>‹</Text>
            </Pressable>
          ) : null}
          <Text style={{ fontSize: 16, lineHeight: 24, fontWeight: "600", color: colors.text }}>{demo.name}</Text>
          <Text style={{ position: "absolute", right: 16, fontSize: 12, fontWeight: "600", color: colors.accent }}>演示</Text>
        </View>
        <View style={{ flex: 1, width: "100%", maxWidth: READ_MAX, alignSelf: "center" }}>
          <ChatThreadSurface
            colors={colors}
            suggestions={demo.suggestions}
            listHeader={listHeader}
            bottomSafeArea="parent"
          />
        </View>
      </View>
    </AssistantRuntimeProvider>
  );
}

export function ChatThread(props: { demo: Demo; colors: Palette; onBack: () => void; showBack: boolean }) {
  return <ThreadBody key={props.demo.id} {...props} />;
}

export function ChatEmpty({ colors }: { colors: Palette }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.bg }}>
      <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>选择一个演示会话</Text>
      <Text style={{ marginTop: 8, fontSize: 14, lineHeight: 22, color: colors.muted, textAlign: "center" }}>
        回复只在这台设备上生成，重开后仍留在这台设备上。没有接通真实助手。
      </Text>
    </View>
  );
}
