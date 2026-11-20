import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  BackHandler,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  Share,
  Text,
  TextInput,
  View,
  type HostInstance,
  type KeyboardEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  type ThreadMessage,
} from "@assistant-ui/react-native";
import { chatChrome, type ChatChrome, type Palette, type Scheme } from "../theme";
import { clipboardAvailable, copyText } from "./copyText";
import { distanceFromBottom, keyboardCover, showJumpToBottom } from "./layout";
import { MarkdownBody, type ReadingStyle } from "./MarkdownBody";
import { ChatMark } from "./ChatMarks";
import { SystemFileChooser, type SystemFileChooserHandle } from "./SystemFileChooser";
import {
  ASSISTANT_DISCLAIMER,
  CAMERA_UNAVAILABLE,
  COPY_MARK_MS,
  COPY_TOAST,
  DRAFT_LIMIT,
  FILES_LOCAL,
  FILES_SHEET,
  LIBRARY_ONLY,
  PICKER_UNAVAILABLE,
  VOICE_UNAVAILABLE,
  addDrafts,
  composerChrome,
  decideSend,
  emptyOutbox,
  extensionLabel,
  formatBytes,
  holdToTalk,
  partsText,
  previousUserText,
  reduceOutbox,
  removeDraft,
  sourceCaption,
  type DraftAttachment,
  type OutboxEvent,
  type PickedWire,
  type QueuedMessage,
} from "./chatModel";

export type ChatThreadSurfaceProps = {
  scheme: Scheme;
  suggestions?: readonly string[];
  listHeader?: ReactElement;
  /**
   * "parent" when a bar under this surface already pads the home indicator.
   * "self" when this surface reaches the screen bottom.
   */
  bottomSafeArea?: "parent" | "self";
  /** False while the thread is parked under another tab, so it does not take the back key. */
  active?: boolean;
  onOpenLibrary?: () => void;
  /** Fixture sessions can drop a local file into the composer. Real servers cannot. */
  localSample?: boolean;
};

type ChatActions = {
  chrome: ChatChrome;
  reading: ReadingStyle;
  markdownColors: Palette;
  submitText: (text: string) => void;
  stop: () => void;
  notice: (message: string) => void;
};

const ChatActionsContext = createContext<ChatActions | null>(null);

function useChatActions(): ChatActions {
  const value = useContext(ChatActionsContext);
  if (!value) throw new Error("Chat actions are only available inside the thread");
  return value;
}

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

function useOutbox() {
  const aui = useAui();
  const auiRef = useRef(aui);
  auiRef.current = aui;
  const running = useAuiState((state) => state.thread.isRunning);
  const box = useRef(emptyOutbox());
  const [items, setItems] = useState<QueuedMessage[]>([]);
  const wasRunning = useRef(false);
  const ids = useRef(0);
  const apply = useCallback((event: OutboxEvent) => {
    const next = reduceOutbox(box.current, event);
    box.current = next.state;
    setItems(next.state.items);
    const client = auiRef.current;
    for (const effect of next.effects) {
      if (effect.type === "cancel") client.thread().cancelRun();
      if (effect.type === "send") client.thread().append(effect.text);
    }
  }, []);
  useEffect(() => {
    if (wasRunning.current && !running) apply({ type: "settled" });
    wasRunning.current = running;
  }, [apply, running]);
  const submitText = useCallback((text: string) => {
    ids.current += 1;
    apply({ type: "submit", id: `q${ids.current}`, text, running });
  }, [apply, running]);
  const sendNow = useCallback((id: string) => {
    apply({ type: "send-now", id, running });
  }, [apply, running]);
  const drop = useCallback((id: string) => {
    apply({ type: "drop", id });
  }, [apply]);
  const stop = useCallback(() => {
    apply({ type: "stop" });
  }, [apply]);
  return { items, running, submitText, sendNow, drop, stop };
}

function ChatMessage() {
  const { chrome, reading, markdownColors, submitText, stop, notice } = useChatActions();
  const role = useAuiState((state) => state.message.role);
  const parts = useAuiState((state) => state.message.parts);
  const content = useAuiState((state) => state.message.content);
  const status = useAuiState((state) => state.message.status);
  const messageId = useAuiState((state) => state.message.id);
  const messages = useAuiState((state) => state.thread.messages);
  const mine = role === "user";
  const text = partsText(parts) || partsText(content);
  const running = status?.type === "running";
  const cancelled = status?.type === "incomplete" && status.reason === "cancelled";
  const caption = sourceCaption(parts);
  const canCopy = clipboardAvailable();
  const [copied, setCopied] = useState(false);
  const [copyLabel, setCopyLabel] = useState("复制");
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPY_MARK_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const copyAll = () => {
    if (!text) {
      setCopyLabel("没有可复制的文字");
      return;
    }
    copyText(text).then(() => {
      setCopied(true);
      setCopyLabel("已复制到剪贴板");
      notice(COPY_TOAST);
      setTimeout(() => setCopyLabel("复制"), 30000);
    }, () => {
      setCopyLabel("没有复制成功");
      notice("没有复制成功");
      setTimeout(() => setCopyLabel("复制"), 30000);
    });
  };
  const share = () => {
    if (!text) return;
    Share.share({ message: text }).catch(() => {});
  };
  const retryText = previousUserText(messages, messageId);
  return (
    <MessagePrimitive.Root style={{ marginBottom: 22, alignItems: mine ? "flex-end" : "stretch" }}>
      <View style={mine ? {
        maxWidth: "86%",
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 18,
        backgroundColor: chrome.userBubble,
      } : { alignSelf: "stretch" }}>
        {mine ? (
          <Text selectable selectionColor={chrome.selection} style={{ color: chrome.userText, fontSize: 16, lineHeight: 22 }}>{text}</Text>
        ) : text ? (
          <MarkdownBody text={text} colors={markdownColors} reading={reading} />
        ) : null}
        {!mine && running && !text ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: chrome.send, fontSize: 16, lineHeight: 24 }}>✻</Text>
            <Text accessibilityLiveRegion="polite" style={{ flex: 1, color: chrome.muted, fontSize: 16, lineHeight: 24 }}>正在回复</Text>
            <Pressable onPress={stop} accessibilityRole="button" accessibilityLabel="停止生成" hitSlop={8}>
              <Text style={{ color: chrome.send, fontSize: 14, lineHeight: 20, fontWeight: "600" }}>停止</Text>
            </Pressable>
          </View>
        ) : null}
        {cancelled ? <Text style={{ marginTop: 6, color: chrome.muted, fontSize: 13, lineHeight: 18 }}>已停止</Text> : null}
        {!mine && caption ? <Text style={{ marginTop: 8, color: chrome.muted, fontSize: 13, lineHeight: 18 }}>{caption}</Text> : null}
        <ErrorPrimitive.Root style={{ marginTop: 6 }}>
          <ErrorPrimitive.Message style={{ color: chrome.send, fontSize: 13, lineHeight: 18 }} />
        </ErrorPrimitive.Root>
        {!mine && text && !running ? (
          <View style={{ marginTop: 12, gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
              {canCopy ? (
                <Pressable onPress={copyAll} accessibilityRole="button" accessibilityLabel={copyLabel} hitSlop={8}>
                  <ChatMark name={copied ? "check" : "copy"} color={copied ? chrome.check : chrome.icon} />
                </Pressable>
              ) : null}
              <Pressable onPress={share} accessibilityRole="button" accessibilityLabel="分享" hitSlop={8}>
                <ChatMark name="share" color={chrome.icon} />
              </Pressable>
              <Pressable onPress={() => notice(VOICE_UNAVAILABLE)} accessibilityRole="button" accessibilityLabel="朗读" accessibilityState={{ disabled: true }} hitSlop={8}>
                <ChatMark name="play" color={chrome.disabled} />
              </Pressable>
              <Pressable onPress={() => setVote((current) => current === "up" ? null : "up")} accessibilityRole="button" accessibilityLabel="赞，只记在这次打开" hitSlop={8}>
                <ChatMark name="up-thumb" color={vote === "up" ? chrome.send : chrome.icon} />
              </Pressable>
              <Pressable onPress={() => setVote((current) => current === "down" ? null : "down")} accessibilityRole="button" accessibilityLabel="踩，只记在这次打开" hitSlop={8}>
                <ChatMark name="down-thumb" color={vote === "down" ? chrome.send : chrome.icon} />
              </Pressable>
              {retryText ? (
                <Pressable onPress={() => submitText(retryText)} accessibilityRole="button" accessibilityLabel="重试" hitSlop={8}>
                  <ChatMark name="retry" color={chrome.icon} />
                </Pressable>
              ) : null}
            </View>
            <Text style={{ color: chrome.muted, fontSize: 12, lineHeight: 18 }}>{ASSISTANT_DISCLAIMER}</Text>
          </View>
        ) : null}
      </View>
    </MessagePrimitive.Root>
  );
}

function RoundButton({ label, background, onPress, children }: { label: string; background: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: background, opacity: pressed ? 0.8 : 1 })}
    >
      {children}
    </Pressable>
  );
}

function Composer({
  chrome,
  drafts,
  onOpenSheet,
  onRemoveDraft,
  queue,
  running,
  onSubmitText,
  onSendNow,
  onDrop,
  onStop,
  onNotice,
}: {
  chrome: ChatChrome;
  drafts: readonly DraftAttachment[];
  onOpenSheet: () => void;
  onRemoveDraft: (id: string) => void;
  queue: readonly QueuedMessage[];
  running: boolean;
  onSubmitText: (text: string) => void;
  onSendNow: (id: string) => void;
  onDrop: (id: string) => void;
  onStop: () => void;
  onNotice: (message: string) => void;
}) {
  const aui = useAui();
  const text = useAuiState((state) => state.composer.text);
  const [focused, setFocused] = useState(false);
  const chromeState = composerChrome({ focused, text, attachments: drafts.length, running, queued: queue.length });
  const send = () => {
    const decision = decideSend(text, drafts.length);
    if (decision.kind !== "text") {
      if (decision.kind === "held") onNotice(FILES_LOCAL);
      return;
    }
    onSubmitText(decision.text);
    aui.composer().setText("");
    setFocused(false);
    Keyboard.dismiss();
  };
  const voice = () => onNotice(holdToTalk().notice);
  const action = chromeState.action === "stop"
    ? <RoundButton label="停止生成" background={chrome.ink} onPress={onStop}><ChatMark name="stop" color={chrome.onInk} size={18} /></RoundButton>
    : chromeState.action === "send"
      ? <RoundButton label="发送" background={chrome.send} onPress={send}><ChatMark name="up" color={chrome.onSend} size={18} /></RoundButton>
      : chromeState.action === "held"
        ? (
          <Pressable
            onPress={() => onNotice(FILES_LOCAL)}
            accessibilityRole="button"
            accessibilityLabel="附件不能发送"
            style={({ pressed }) => ({
              height: 40,
              paddingHorizontal: 14,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: chrome.soft,
              borderWidth: 1,
              borderColor: chrome.line,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ color: chrome.text, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>不能发送</Text>
          </Pressable>
        )
        : <RoundButton label="语音模式" background={chrome.disabled} onPress={voice}><ChatMark name="wave" color={chrome.canvas} size={18} /></RoundButton>;
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8, gap: 8 }}>
      {queue.map((item) => (
        <View key={item.id} style={{ alignItems: "flex-end", gap: 4 }}>
          <View style={{ maxWidth: "86%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, backgroundColor: chrome.userBubble }}>
            <Text style={{ color: chrome.userText, fontSize: 16, lineHeight: 22 }}>{item.text}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            <Pressable onPress={() => onDrop(item.id)} accessibilityRole="button" accessibilityLabel="不发送这条排队消息" hitSlop={6}>
              <Text style={{ color: chrome.muted, fontSize: 13, lineHeight: 18 }}>不发了</Text>
            </Pressable>
            <Pressable onPress={() => onSendNow(item.id)} accessibilityRole="button" accessibilityLabel="立即发送" hitSlop={6}>
              <Text style={{ color: chrome.send, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>立即发送</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {running && chromeState.action !== "stop" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 6 }}>
          <Text style={{ color: chrome.send, fontSize: 15 }}>✻</Text>
          <Text style={{ flex: 1, color: chrome.muted, fontSize: 14, lineHeight: 20 }}>正在回复</Text>
          <Pressable onPress={onStop} accessibilityRole="button" accessibilityLabel="停止生成" hitSlop={8}>
            <Text style={{ color: chrome.send, fontSize: 14, lineHeight: 20, fontWeight: "600" }}>停止</Text>
          </Pressable>
        </View>
      ) : null}
      {chromeState.expanded ? (
        <View style={{ borderRadius: 26, backgroundColor: chrome.composer, padding: 12, gap: 10, borderWidth: 1, borderColor: chrome.line }}>
          {drafts.length > 0 ? <DraftRow drafts={drafts} chrome={chrome} onRemove={onRemoveDraft} /> : null}
          <TextInput
            autoFocus={focused}
            value={text}
            onChangeText={(value) => aui.composer().setText(value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={chromeState.placeholder}
            placeholderTextColor={chrome.muted}
            accessibilityLabel="回复"
            multiline
            blurOnSubmit={false}
            scrollEnabled
            textAlignVertical="top"
            selectionColor={chrome.send}
            underlineColorAndroid="transparent"
            style={{
              minHeight: 44,
              maxHeight: 128,
              color: chrome.text,
              fontSize: 16,
              lineHeight: 22,
              padding: 0,
              borderWidth: 0,
              outlineWidth: 0,
            }}
          />
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Pressable onPress={onOpenSheet} accessibilityRole="button" accessibilityLabel="添加" hitSlop={6} style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? chrome.line : chrome.soft })}>
              <ChatMark name="plus" color={chrome.text} size={18} />
            </Pressable>
            <View style={{ flex: 1 }} />
            {running && chromeState.action === "send" ? (
              <Pressable onPress={onStop} accessibilityRole="button" accessibilityLabel="停止生成" hitSlop={8} style={{ marginRight: 12 }}>
                <Text style={{ color: chrome.send, fontSize: 14, fontWeight: "600" }}>停止</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={voice} accessibilityRole="button" accessibilityLabel="麦克风" accessibilityState={{ disabled: true }} hitSlop={8} style={{ marginRight: 8 }}>
              <ChatMark name="mic" color={chrome.disabled} />
            </Pressable>
            {action}
          </View>
        </View>
      ) : (
        <View style={{ height: 56, borderRadius: 28, backgroundColor: chrome.composer, borderWidth: 1, borderColor: chrome.line, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Pressable onPress={onOpenSheet} accessibilityRole="button" accessibilityLabel="添加" hitSlop={6} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
            <ChatMark name="plus" color={chrome.text} size={20} />
          </Pressable>
          <Pressable
            style={{ flex: 1, height: 40, justifyContent: "center" }}
            onPress={() => setFocused(true)}
            onLongPress={voice}
            delayLongPress={280}
            accessibilityRole="button"
            accessibilityLabel={chromeState.placeholder}
          >
            <Text style={{ color: chrome.muted, fontSize: 16, lineHeight: 22 }}>{chromeState.placeholder}</Text>
          </Pressable>
          <Pressable onPress={voice} accessibilityRole="button" accessibilityLabel="麦克风" accessibilityState={{ disabled: true }} hitSlop={6}>
            <ChatMark name="mic" color={chrome.disabled} />
          </Pressable>
          {action}
        </View>
      )}
    </View>
  );
}

function DraftRow({ drafts, chrome, onRemove }: { drafts: readonly DraftAttachment[]; chrome: ChatChrome; onRemove: (id: string) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {drafts.map((draft) => (
          <View key={draft.id} style={{ width: draft.preview ? 72 : 168, minHeight: 72, borderRadius: 16, backgroundColor: chrome.soft, overflow: "hidden" }}>
            {draft.preview ? (
              <Image source={{ uri: draft.preview }} style={{ width: 72, height: 72 }} accessibilityLabel={draft.name} />
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 8, paddingRight: 28 }}>
                <View style={{ width: 36, height: 44, borderRadius: 8, backgroundColor: chrome.send, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: chrome.onSend, fontSize: 10, fontWeight: "700" }}>{extensionLabel(draft.name, draft.mime)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: chrome.text, fontSize: 13, lineHeight: 18 }}>{draft.name}</Text>
                  <Text style={{ color: chrome.muted, fontSize: 12, lineHeight: 16 }}>{formatBytes(draft.size)}</Text>
                </View>
              </View>
            )}
            <Pressable onPress={() => onRemove(draft.id)} accessibilityRole="button" accessibilityLabel={`移除 ${draft.name}`} hitSlop={6} style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: chrome.ink, alignItems: "center", justifyContent: "center" }}>
              <ChatMark name="close" color={chrome.onInk} size={12} />
            </Pressable>
          </View>
        ))}
      </View>
      <Text style={{ color: chrome.text, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>{FILES_LOCAL}</Text>
    </View>
  );
}

function AddSheet({
  visible,
  chrome,
  onClose,
  onPick,
  onCamera,
  onLibrary,
  onSample,
}: {
  visible: boolean;
  chrome: ChatChrome;
  onClose: () => void;
  onPick: (kind: "photo" | "file") => void;
  onCamera: () => void;
  onLibrary?: () => void;
  onSample?: () => void;
}) {
  const [explained, setExplained] = useState(false);
  const shown = useRef(0);
  if (!visible) shown.current = 0;
  else if (shown.current === 0) shown.current = Date.now();
  useEffect(() => {
    if (!visible) setExplained(false);
  }, [visible]);
  const dismiss = () => {
    if (Date.now() - shown.current < 400) return;
    onClose();
  };
  const tile = (name: "camera" | "image" | "file", label: string, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => ({ flex: 1, minHeight: 92, borderRadius: 18, backgroundColor: pressed ? chrome.line : chrome.tile, alignItems: "center", justifyContent: "center", gap: 8 })}>
      <ChatMark name={name} color={chrome.text} />
      <Text style={{ color: chrome.text, fontSize: 14, lineHeight: 18 }}>{label}</Text>
    </Pressable>
  );
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, justifyContent: "flex-end" }}>
        <Pressable onPress={dismiss} accessibilityLabel="关闭添加" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: chrome.scrim }} />
        <View style={{ backgroundColor: chrome.sheet, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28, gap: 14 }}>
          <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: chrome.line }} />
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="关闭" hitSlop={8} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
              <ChatMark name="close" color={chrome.text} size={18} />
            </Pressable>
            <Text style={{ flex: 1, textAlign: "center", color: chrome.text, fontSize: 16, lineHeight: 22, fontWeight: "700", marginRight: 40 }}>添加到对话</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {tile("camera", "相机", onCamera)}
            {tile("image", "照片", () => onPick("photo"))}
            {tile("file", "文件", () => onPick("file"))}
          </View>
          <Text style={{ color: chrome.muted, fontSize: 12, lineHeight: 16 }}>{FILES_SHEET}</Text>
          <Pressable onPress={() => setExplained(true)} accessibilityRole="button" accessibilityLabel="从知识库选择" style={({ pressed }) => ({ minHeight: 64, borderRadius: 18, backgroundColor: pressed ? chrome.line : chrome.tile, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 12 })}>
            <ChatMark name="book" color={chrome.text} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: chrome.text, fontSize: 15, lineHeight: 20 }}>从知识库选择</Text>
              <Text style={{ color: chrome.muted, fontSize: 12, lineHeight: 16 }}>只列公开文件</Text>
            </View>
            <ChatMark name="chevron" color={chrome.muted} size={16} />
          </Pressable>
          {onSample ? (
            <Pressable onPress={onSample} accessibilityRole="button" accessibilityLabel="放上本地示例" style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", opacity: pressed ? 0.8 : 1 })}>
              <Text style={{ color: chrome.text, fontSize: 14, lineHeight: 20, fontWeight: "600" }}>放上本地示例</Text>
            </Pressable>
          ) : null}
          {explained ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: chrome.muted, fontSize: 13, lineHeight: 18 }}>{LIBRARY_ONLY}</Text>
              {onLibrary ? (
                <Pressable onPress={onLibrary} accessibilityRole="button" accessibilityLabel="打开知识库">
                  <Text style={{ color: chrome.send, fontSize: 14, lineHeight: 20, fontWeight: "600" }}>打开知识库</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

export function ChatThreadSurface({
  scheme,
  suggestions = [],
  listHeader,
  bottomSafeArea = "self",
  active = true,
  onOpenLibrary,
  localSample = false,
}: ChatThreadSurfaceProps) {
  const chrome = useMemo(() => chatChrome(scheme), [scheme]);
  const reading = useMemo<ReadingStyle>(() => ({
    fontSize: 17,
    lineHeight: 28,
    fontFamily: Platform.select({ ios: "Georgia", android: "serif", default: "serif" }),
    selectionColor: chrome.selection,
  }), [chrome.selection]);
  const insets = useSafeAreaInsets();
  const safeInset = bottomSafeArea === "parent" ? 0 : insets.bottom;
  const { ref, pad, onLayout, keyboardOpen } = useBottomCover(safeInset);
  const [sheet, setSheet] = useState(false);
  const [drafts, setDrafts] = useState<DraftAttachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chooser = useRef<SystemFileChooserHandle>(null);
  const fileIds = useRef(0);
  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), COPY_MARK_MS);
  }, []);
  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);
  const outbox = useOutbox();
  const markdownColors = useMemo<Palette>(() => ({
    canvas: chrome.canvas,
    bg: chrome.canvas,
    text: chrome.text,
    muted: chrome.muted,
    line: chrome.line,
    accent: chrome.send,
    bubbleMe: chrome.userBubble,
    bubbleMeText: chrome.userText,
    bubbleBot: "transparent",
    raised: chrome.soft,
    press: chrome.soft,
    selected: chrome.soft,
    status: scheme === "dark" ? "light" : "dark",
  }), [chrome, scheme]);
  const actions = useMemo<ChatActions>(() => ({
    chrome,
    reading,
    markdownColors,
    submitText: outbox.submitText,
    stop: outbox.stop,
    notice: showNotice,
  }), [chrome, markdownColors, outbox.stop, outbox.submitText, reading, showNotice]);
  useEffect(() => {
    if (!active || Platform.OS !== "android") return;
    const onBack = () => {
      if (sheet) {
        setSheet(false);
        return true;
      }
      if (!keyboardOpen()) return false;
      Keyboard.dismiss();
      return true;
    };
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
  }, [active, keyboardOpen, sheet]);
  const listRef = useRef<FlatList<ThreadMessage>>(null);
  const [jump, setJump] = useState(false);
  const renderMessage = useCallback(() => <ChatMessage />, []);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distance = distanceFromBottom(contentSize.height, layoutMeasurement.height, contentOffset.y);
    const next = showJumpToBottom(distance);
    setJump((prev) => (prev === next ? prev : next));
  }, []);
  const onPicked = useCallback((files: PickedWire[]) => {
    if (files.length === 0) return;
    setDrafts((current) => {
      const incoming = files.map((file) => {
        fileIds.current += 1;
        return { ...file, id: `f${fileIds.current}` };
      });
      const result = addDrafts(current, incoming);
      if (result.dropped > 0) showNotice(`一次最多 ${DRAFT_LIMIT} 个附件`);
      return result.next;
    });
    setSheet(false);
  }, [showNotice]);
  return (
    <ChatActionsContext.Provider value={actions}>
      <View ref={ref} collapsable={false} onLayout={onLayout} style={{ flex: 1, paddingBottom: pad, backgroundColor: chrome.canvas }}>
        <ThreadPrimitive.Root style={{ flex: 1 }}>
          <View style={{ flex: 1 }}>
            <ThreadPrimitive.MessagesFlatList
              ref={listRef}
              autoScroll
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              removeClippedSubviews={false}
              onScroll={onScroll}
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}
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
                  backgroundColor: pressed ? chrome.line : chrome.composer,
                  alignItems: "center",
                  justifyContent: "center",
                })}
              >
                <Text style={{ color: chrome.text, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>回到底部</Text>
              </Pressable>
            ) : null}
          </View>
          {suggestions.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16 }}>
              {suggestions.map((item) => (
                <Pressable key={item} onPress={() => outbox.submitText(item)} style={{ minHeight: 32, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: chrome.line, justifyContent: "center" }}>
                  <Text style={{ fontSize: 12, lineHeight: 16, color: chrome.muted }}>{item}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {notice ? (
            <View accessibilityLiveRegion="polite" style={{ marginHorizontal: 16, marginBottom: 6, borderRadius: 14, backgroundColor: chrome.toast, paddingHorizontal: 16, paddingVertical: 12 }}>
              <Text style={{ color: chrome.toastText, fontSize: 14, lineHeight: 20, textAlign: "center" }}>{notice}</Text>
            </View>
          ) : null}
          <Composer
            chrome={chrome}
            drafts={drafts}
            queue={outbox.items}
            running={outbox.running}
            onOpenSheet={() => {
              Keyboard.dismiss();
              setSheet(true);
            }}
            onRemoveDraft={(id) => setDrafts((current) => removeDraft(current, id))}
            onSubmitText={outbox.submitText}
            onSendNow={outbox.sendNow}
            onDrop={outbox.drop}
            onStop={outbox.stop}
            onNotice={showNotice}
          />
        </ThreadPrimitive.Root>
        <AddSheet
          visible={sheet}
          chrome={chrome}
          onClose={() => setSheet(false)}
          onCamera={() => {
            setSheet(false);
            showNotice(CAMERA_UNAVAILABLE);
          }}
          onPick={(kind) => {
            setSheet(false);
            chooser.current?.pick(kind);
          }}
          onLibrary={onOpenLibrary ? () => {
            setSheet(false);
            showNotice(LIBRARY_ONLY);
            onOpenLibrary();
          } : undefined}
          onSample={localSample ? () => onPicked([{ name: "qbot-local.txt", size: 12, mime: "text/plain", preview: null }]) : undefined}
        />
        <SystemFileChooser ref={chooser} onPicked={onPicked} onUnavailable={() => showNotice(PICKER_UNAVAILABLE)} />
      </View>
    </ChatActionsContext.Provider>
  );
}
