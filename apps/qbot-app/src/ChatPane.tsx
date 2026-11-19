import { useMemo } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useLocalRuntime,
} from "@assistant-ui/react-native";
import {
  createDemoAdapter,
  filterDemos,
  type Demo,
  type DemoId,
} from "./demos";
import type { Palette } from "./theme";

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
}: {
  colors: Palette;
  query: string;
  onQuery: (value: string) => void;
  selected: DemoId | null;
  onOpen: (id: DemoId) => void;
}) {
  const rows = filterDemos(query);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
        <Text style={{ fontSize: 20, lineHeight: 26, fontWeight: "700", color: colors.text }}>对话</Text>
        <Text style={{ marginTop: 2, fontSize: 12, lineHeight: 16, color: colors.muted }}>演示，没有接通真实助手</Text>
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
                backgroundColor: pressed || active ? colors.press : "transparent",
              })}
            >
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
              <View style={{ flex: 1, borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 14 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ flex: 1, fontSize: 16, lineHeight: 22, fontWeight: "600", color: colors.text }} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={{ fontSize: 12, lineHeight: 16, fontWeight: "600", color: colors.accent }}>演示</Text>
                </View>
                <Text style={{ marginTop: 2, fontSize: 14, lineHeight: 20, color: colors.muted }} numberOfLines={1}>
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

function Suggestions({ demo, colors }: { demo: Demo; colors: Palette }) {
  const aui = useAui();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
      {demo.suggestions.map((item) => (
        <Pressable
          key={item}
          accessibilityRole="button"
          onPress={() => {
            const composer = aui.composer();
            composer.setText(item);
            composer.send();
          }}
          style={({ pressed }) => ({
            minHeight: 32,
            paddingHorizontal: 10,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: colors.line,
            justifyContent: "center",
            backgroundColor: pressed ? colors.press : "transparent",
          })}
        >
          <Text style={{ fontSize: 12, lineHeight: 16, color: colors.muted }}>{item}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function ThreadBody({ demo, colors, onBack, showBack }: { demo: Demo; colors: Palette; onBack: () => void; showBack: boolean }) {
  const adapter = useMemo(() => createDemoAdapter(demo.id), [demo.id]);
  const initialMessages = useMemo(
    () => demo.messages.map((line, index) => ({
      id: `${demo.id}-${index}`,
      role: line.role,
      content: line.text,
    })),
    [demo],
  );
  const runtime = useLocalRuntime(adapter, { initialMessages });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
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
        <ThreadPrimitive.Root style={{ flex: 1 }}>
          <ThreadPrimitive.MessagesFlatList
            autoScroll
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 }}
            ListHeaderComponent={
              <Text style={{ fontSize: 12, lineHeight: 18, color: colors.muted, textAlign: "center", marginBottom: 12 }}>
                {demo.note}
              </Text>
            }
          >
            {({ message }) => {
              const mine = message.role === "user";
              return (
                <MessagePrimitive.Root style={{ alignItems: mine ? "flex-end" : "flex-start", marginBottom: 12 }}>
                  <View
                    style={{
                      maxWidth: "78%",
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      borderRadius: 16,
                      backgroundColor: mine ? colors.bubbleMe : colors.bubbleBot,
                      borderWidth: mine ? 0 : 1,
                      borderColor: colors.line,
                    }}
                  >
                    <MessagePrimitive.Content
                      renderText={({ part }) => (
                        <Text style={{ fontSize: 15, lineHeight: 22, color: mine ? colors.bubbleMeText : colors.text }}>
                          {part.text}
                        </Text>
                      )}
                    />
                  </View>
                </MessagePrimitive.Root>
              );
            }}
          </ThreadPrimitive.MessagesFlatList>
          <Suggestions demo={demo} colors={colors} />
          <ComposerPrimitive.Root
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              gap: 8,
              paddingHorizontal: 16,
              paddingTop: 8,
              paddingBottom: 10,
              borderTopWidth: 1,
              borderTopColor: colors.line,
              backgroundColor: colors.bg,
            }}
          >
            <ComposerPrimitive.Input
              placeholder="发消息…"
              placeholderTextColor={colors.muted}
              multiline
              style={{
                flex: 1,
                minHeight: 40,
                maxHeight: 120,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.line,
                backgroundColor: colors.raised,
                color: colors.text,
                fontSize: 15,
                lineHeight: 22,
              }}
            />
            <ComposerPrimitive.Send
              accessibilityRole="button"
              accessibilityLabel="发送"
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? colors.accent : colors.bubbleMe,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ color: colors.bubbleMeText, fontSize: 14, fontWeight: "700" }}>发送</Text>
            </ComposerPrimitive.Send>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.Root>
      </KeyboardAvoidingView>
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
        回复只在这台设备上生成，刷新或重开后，新输入的句子不会保留。
      </Text>
    </View>
  );
}
