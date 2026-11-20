import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  BackHandler,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  Text,
  View,
  type HostInstance,
  type KeyboardEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ActionBarPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  type ThreadMessage,
} from "@assistant-ui/react-native";
import { READ_MAX, type Palette } from "../theme";
import { clipboardAvailable, copyText } from "./copyText";
import { distanceFromBottom, keyboardCover, showJumpToBottom } from "./layout";
import { MarkdownBody } from "./MarkdownBody";

export type ChatThreadSurfaceProps = {
  colors: Palette;
  suggestions?: readonly string[];
  listHeader?: ReactElement;
  /**
   * "parent" when a bar under this surface already pads the home indicator
   * while the keyboard is closed. "self" when this surface reaches the
   * screen bottom, which is what a full-screen live thread should pass.
   */
  bottomSafeArea?: "parent" | "self";
};

function keyboardScreenTop(event: KeyboardEvent): number | null {
  const top = event.endCoordinates?.screenY;
  return typeof top === "number" && Number.isFinite(top) ? top : null;
}

function useBottomCover(safeInset: number) {
  const ref = useRef<HostInstance>(null);
  const keyboardTopRef = useRef<number | null>(null);
  const [pad, setPad] = useState(safeInset);
  const apply = useCallback((top: number | null, inset: number) => {
    if (top == null) {
      setPad((prev) => (prev === inset ? prev : inset));
      return;
    }
    ref.current?.measureInWindow((_x, y, _width, height) => {
      const next = keyboardCover(y + height, top);
      setPad((prev) => (prev === next ? prev : next));
    });
  }, []);
  useEffect(() => {
    apply(keyboardTopRef.current, safeInset);
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (event) => {
      keyboardTopRef.current = keyboardScreenTop(event);
      apply(keyboardTopRef.current, safeInset);
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      keyboardTopRef.current = null;
      apply(null, safeInset);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [apply, safeInset]);
  const onLayout = useCallback(() => {
    apply(keyboardTopRef.current, safeInset);
  }, [apply, safeInset]);
  const keyboardOpen = useCallback(() => keyboardTopRef.current != null, []);
  return { ref, pad, onLayout, keyboardOpen };
}

function Suggestions({ items, colors }: { items: readonly string[]; colors: Palette }) {
  const aui = useAui();
  if (items.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
      {items.map((item) => (
        <Pressable
          key={item}
          accessibilityRole="button"
          onPress={() => {
            if (aui.thread().getState().isRunning) return;
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

function ChatMessage({ colors }: { colors: Palette }) {
  const role = useAuiState((s) => s.message.role);
  const last = useAuiState((s) => s.message.isLast);
  const status = useAuiState((s) => s.message.status);
  const hasText = useAuiState((s) => s.message.parts.some((part) => part.type === "text" && part.text.length > 0));
  const mine = role === "user";
  const running = status?.type === "running";
  const stopped = status?.type === "incomplete" && status.reason === "cancelled";
  const showCopy = hasText && !running && clipboardAvailable();
  const showRetry = !mine && last && !running && (hasText || status?.type === "incomplete");
  const actionStyle = { fontSize: 13, lineHeight: 18, color: mine ? colors.bubbleMeText : colors.muted, paddingVertical: 4 };
  return (
    <MessagePrimitive.Root style={{ marginBottom: 18, alignItems: mine ? "flex-end" : "stretch" }}>
      <View style={mine ? {
        maxWidth: "82%",
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 18,
        backgroundColor: colors.bubbleMe,
      } : { alignSelf: "stretch" }}>
        <MessagePrimitive.Content
          renderText={({ part }) => mine ? (
            <Text selectable style={{ color: colors.bubbleMeText, fontSize: 16, lineHeight: 24 }}>{part.text}</Text>
          ) : (
            <MarkdownBody text={part.text} colors={colors} />
          )}
        />
        {!mine && running && !hasText ? (
          <Text accessibilityLiveRegion="polite" style={{ color: colors.muted, fontSize: 16, lineHeight: 24 }}>正在回复</Text>
        ) : null}
        {!mine && stopped ? (
          <Text style={{ marginTop: 6, color: colors.muted, fontSize: 13, lineHeight: 18 }}>已停止</Text>
        ) : null}
        <ErrorPrimitive.Root style={{ marginTop: 6 }}>
          <ErrorPrimitive.Message style={{ color: colors.accent, fontSize: 13, lineHeight: 18 }} />
        </ErrorPrimitive.Root>
        {showCopy || showRetry ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginTop: 4 }}>
            {showCopy ? (
              <ActionBarPrimitive.Copy copyToClipboard={copyText} accessibilityLabel="复制消息" hitSlop={6}>
                {({ isCopied }) => <Text style={actionStyle}>{isCopied ? "已复制" : "复制"}</Text>}
              </ActionBarPrimitive.Copy>
            ) : null}
            {showRetry ? (
              <ActionBarPrimitive.Reload accessibilityLabel="重试" hitSlop={6}>
                <Text style={actionStyle}>重试</Text>
              </ActionBarPrimitive.Reload>
            ) : null}
          </View>
        ) : null}
      </View>
    </MessagePrimitive.Root>
  );
}

function ComposerBar({ colors }: { colors: Palette }) {
  const running = useAuiState((s) => s.thread.isRunning);
  const canSend = useAuiState((s) => s.composer.canSend);
  const button = {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: colors.bubbleMe,
  };
  return (
    <ComposerPrimitive.Root
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        gap: 8,
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 8,
        borderTopWidth: 1,
        borderTopColor: colors.line,
        backgroundColor: colors.bg,
      }}
    >
      <ComposerPrimitive.Input
        placeholder="发消息…"
        placeholderTextColor={colors.muted}
        accessibilityLabel="发消息"
        multiline
        blurOnSubmit={false}
        scrollEnabled
        textAlignVertical="top"
        style={{
          flex: 1,
          minHeight: 44,
          maxHeight: 128,
          paddingHorizontal: 14,
          paddingTop: 10,
          paddingBottom: 10,
          borderRadius: 22,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.raised,
          color: colors.text,
          fontSize: 16,
          lineHeight: 22,
        }}
      />
      {running ? (
        <ComposerPrimitive.Cancel accessibilityLabel="停止生成" style={({ pressed }) => ({ ...button, opacity: pressed ? 0.75 : 1 })}>
          <View style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: colors.bubbleMeText }} />
        </ComposerPrimitive.Cancel>
      ) : (
        <ComposerPrimitive.Send
          accessibilityLabel="发送"
          style={({ pressed }) => ({
            ...button,
            opacity: canSend ? (pressed ? 0.75 : 1) : 0.35,
            backgroundColor: pressed && canSend ? colors.accent : colors.bubbleMe,
          })}
        >
          <Text style={{ color: colors.bubbleMeText, fontSize: 18, lineHeight: 22, fontWeight: "700" }}>↑</Text>
        </ComposerPrimitive.Send>
      )}
    </ComposerPrimitive.Root>
  );
}

export function ChatThreadSurface({
  colors,
  suggestions = [],
  listHeader,
  bottomSafeArea = "self",
}: ChatThreadSurfaceProps) {
  const insets = useSafeAreaInsets();
  const safeInset = bottomSafeArea === "parent" ? 0 : insets.bottom;
  const { ref, pad, onLayout, keyboardOpen } = useBottomCover(safeInset);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const onBack = () => {
      if (!keyboardOpen()) return false;
      Keyboard.dismiss();
      return true;
    };
    // The shell registers its own back handler after this one. Move ours to
    // the front when the keyboard visibility changes so the first press
    // dismisses the keyboard and a later press leaves the thread.
    let sub = BackHandler.addEventListener("hardwareBackPress", onBack);
    const promote = () => {
      sub.remove();
      sub = BackHandler.addEventListener("hardwareBackPress", onBack);
    };
    const show = Keyboard.addListener("keyboardDidShow", promote);
    const hide = Keyboard.addListener("keyboardDidHide", promote);
    const later = setTimeout(promote, 0);
    return () => {
      clearTimeout(later);
      sub.remove();
      show.remove();
      hide.remove();
    };
  }, [keyboardOpen]);
  const listRef = useRef<FlatList<ThreadMessage>>(null);
  const [jump, setJump] = useState(false);
  const renderMessage = useCallback(() => <ChatMessage colors={colors} />, [colors]);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distance = distanceFromBottom(contentSize.height, layoutMeasurement.height, contentOffset.y);
    const next = showJumpToBottom(distance);
    setJump((prev) => (prev === next ? prev : next));
  }, []);
  return (
    <View ref={ref} collapsable={false} onLayout={onLayout} style={{ flex: 1, paddingBottom: pad }}>
      <ThreadPrimitive.Root style={{ flex: 1, width: "100%", maxWidth: READ_MAX, alignSelf: "center" }}>
        <View style={{ flex: 1 }}>
          <ThreadPrimitive.MessagesFlatList
            ref={listRef}
            autoScroll
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            removeClippedSubviews={false}
            onScroll={onScroll}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20 }}
            ListHeaderComponent={listHeader}
          >
            {renderMessage}
          </ThreadPrimitive.MessagesFlatList>
          {jump ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="回到底部"
              onPress={() => {
                setJump(false);
                listRef.current?.scrollToEnd({ animated: true });
              }}
              style={({ pressed }) => ({
                position: "absolute",
                right: 16,
                bottom: 8,
                minWidth: 44,
                height: 36,
                paddingHorizontal: 12,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: colors.line,
                backgroundColor: pressed ? colors.press : colors.raised,
                alignItems: "center",
                justifyContent: "center",
              })}
            >
              <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>回到底部</Text>
            </Pressable>
          ) : null}
        </View>
        <Suggestions items={suggestions} colors={colors} />
        <ComposerBar colors={colors} />
      </ThreadPrimitive.Root>
    </View>
  );
}
