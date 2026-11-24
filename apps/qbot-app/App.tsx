import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  Text,
  ToastAndroid,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { setBackgroundColorAsync } from "expo-system-ui";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ChatEmpty, ConversationList } from "./src/ChatPane";
import { clearClientCaches, clearSavedToken, isUnauthorizedMessage, loadSavedToken, verifyAndSaveToken } from "./src/chat/accessToken";
import { deviceSecretStorage } from "./src/chat/deviceSecret";
import { LiveChat } from "./src/chat/LiveChat";
import { TokenModal } from "./src/chat/TokenModal";
import { ChatRuntime, useChatBoot } from "./src/chat/useChatRuntime";
import { configuredOrigin } from "./src/chat/serverEndpoint";
import { createServerClient } from "./src/chat/serverClient";
import type { ConnectionView } from "./src/chat/serverSession";
import { QbotAvatar } from "./src/QbotAvatar";
import { TabBarIcon } from "./src/TabBarIcon";
import { RAIL_WIDTH, chatChrome, isSplit, listPaneWidth, palette, resolveScheme } from "./src/theme";
import { CardFeed } from "./src/feed/CardFeed";
import type { StatusIcons } from "./src/feed/immersive";
import { LibraryPane } from "./src/LibraryPane";
import { pullUpdate } from "./src/updates";
import * as Updates from "expo-updates";

type Tab = "chat" | "feed" | "kb";
const EXIT_CONFIRM_MS = 2000;
const TAB_HEIGHT = 56;

const TABS = [
  ["feed", "今日", "discover"],
  ["chat", "对话", "chat"],
  ["kb", "知识库", "library"],
] as const;

function Shell() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const split = isSplit(width);
  const listWidth = listPaneWidth(width);
  const scheme = resolveScheme(useColorScheme());
  const colors = palette[scheme];
  const dark = scheme === "dark";
  const feedBack = useRef<() => boolean>(() => false);
  const kbBack = useRef<() => boolean>(() => false);
  const lastExit = useRef(0);
  const [tab, setTab] = useState<Tab>("feed");
  const [todayUnread] = useState(false);
  const [token, setToken] = useState("");
  const [tokenReady, setTokenReady] = useState(false);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [authVersion, setAuthVersion] = useState(0);
  const origin = configuredOrigin();
  const [thread, setThread] = useState(false);
  const boot = useChatBoot({ token, tokenReady, retryKey: authVersion });
  const serverClient = useMemo(() => createServerClient({ origin: origin ?? "", token: token || undefined }), [origin, token]);
  const connectionView = useMemo<ConnectionView>(() => (
    boot.phase === "ready"
      ? {
        phase: "ready",
        origin: origin ?? "",
        token,
        session: boot.session ?? { ownerId: "", agentId: "", model: "", upstream: "openrouter" },
        conversationId: boot.initialThreadId ?? "",
        client: serverClient,
      }
      : boot.phase === "error"
        ? { phase: "error", message: boot.message ?? "无法连接服务器" }
        : { phase: "checking" }
  ), [boot.initialThreadId, boot.message, boot.phase, boot.session, origin, serverClient, token]);
  const [keyboard, setKeyboard] = useState(false);
  const [coverTabs, setCoverTabs] = useState(false);
  const [feedStatus, setFeedStatus] = useState<StatusIcons | null>(null);
  const tabOpacity = useRef(new Animated.Value(1)).current;
  const live = thread;
  const inThread = tab === "chat" && thread;
  const showBottomTabs = !split && !inThread && !(keyboard && tab === "chat");
  const showRail = split && !coverTabs;
  const showList = tab === "chat" && (split || !live);
  const showThread = tab === "chat" && (split || live);
  const screenChrome = chatChrome(scheme);

  useEffect(() => {
    let alive = true;
    void loadSavedToken(deviceSecretStorage).then((saved) => {
      if (!alive) return;
      setToken(saved);
      setTokenReady(true);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const background = inThread ? screenChrome.canvas : colors.canvas;
    setBackgroundColorAsync(background).catch(() => {});
  }, [colors.canvas, inThread, screenChrome.canvas]);

  useEffect(() => {
    // Native ON_LOAD also checks. This fetch does not reload; the next cold start picks it up.
    try {
      pullUpdate({
        enabled: Updates.isEnabled,
        check: () => Updates.checkForUpdateAsync(),
        fetch: async () => { await Updates.fetchUpdateAsync(); },
      }).catch(() => {});
    } catch {
      // Keep the embedded bundle.
    }
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, () => setKeyboard(true));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboard(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    Animated.timing(tabOpacity, { toValue: coverTabs ? 0 : 1, duration: 240, useNativeDriver: true }).start();
  }, [coverTabs, tabOpacity]);

  const exitOrHint = useCallback(() => {
    const now = Date.now();
    if (now - lastExit.current < EXIT_CONFIRM_MS) {
      lastExit.current = 0;
      BackHandler.exitApp();
      return;
    }
    lastExit.current = now;
    if (Platform.OS === "android") ToastAndroid.show("再滑一次退出", ToastAndroid.SHORT);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (tab === "chat" && thread && !split) {
        setThread(false);
        return true;
      }
      if (tab === "feed" && feedBack.current()) return true;
      if (tab === "kb" && kbBack.current()) return true;
      exitOrHint();
      return true;
    });
    return () => sub.remove();
  }, [tab, thread, split, exitOrHint]);

  const openKb = () => {
    setTab("kb");
  };

  const handleSaveToken = useCallback(async (rawToken: string) => {
    if (!origin) throw new Error("这一版没有带上服务器地址");
    const verified = await verifyAndSaveToken({ origin, rawToken, secrets: deviceSecretStorage });
    await clearClientCaches(AsyncStorage);
    setToken(verified);
    setAuthVersion((v) => v + 1);
    setTokenModalOpen(false);
  }, [origin]);

  const handleClearToken = useCallback(async () => {
    await clearSavedToken(deviceSecretStorage);
    await clearClientCaches(AsyncStorage);
    setToken("");
    setThread(false);
    setAuthVersion((v) => v + 1);
    setTokenModalOpen(false);
  }, []);

  const listStatusNote = boot.phase === "error"
    ? (boot.message ?? "无法连接服务器")
    : boot.phase === "checking"
      ? "正在连接"
      : null;

  return (
    <View style={{ flex: 1, flexDirection: split ? "row" : "column", backgroundColor: inThread ? screenChrome.canvas : colors.canvas }}>
      <StatusBar style={tab === "feed" && feedStatus ? feedStatus : colors.status} />
      {showRail ? (
        <View
          style={{
            width: RAIL_WIDTH,
            backgroundColor: colors.canvas,
            borderRightWidth: 1,
            borderRightColor: colors.line,
            paddingTop: insets.top + 14,
            paddingBottom: insets.bottom + 12,
            alignItems: "center",
            gap: 6,
          }}
        >
          <View style={{ marginBottom: 14, borderRadius: 10, overflow: "hidden" }}>
            <QbotAvatar size={36} />
          </View>
          {TABS.map(([id, label, icon]) => {
            const current = tab === id;
            return (
              <Pressable
                key={id}
                accessibilityRole="tab"
                accessibilityState={{ selected: current }}
                accessibilityLabel={label}
                onPress={() => setTab(id)}
                style={({ pressed }) => ({
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 3,
                  backgroundColor: current ? colors.selected : pressed ? colors.press : "transparent",
                })}
              >
                <View>
                  <TabBarIcon name={icon} tone={dark ? "dark" : "light"} selected={current} />
                  {id === "feed" && todayUnread && !current ? (
                    <View style={{ position: "absolute", top: -4, right: -6, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.canvas }} />
                  ) : null}
                </View>
                <Text style={{ fontSize: 11, lineHeight: 15, fontWeight: current ? "700" : "400", color: current ? colors.text : colors.muted }}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, paddingTop: tab === "feed" ? 0 : insets.top }}>
        <View style={{ flex: 1, position: "relative", flexDirection: split && tab === "chat" ? "row" : "column" }}>
          <View
            pointerEvents={tab === "feed" ? "auto" : "none"}
            style={tab === "feed" ? { flex: 1 } : { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0, zIndex: -1 }}
          >
            <CardFeed
              active={tab === "feed"}
              origin={origin}
              token={token}
              tokenReady={tokenReady}
              topInset={insets.top}
              onBackReady={(back) => { feedBack.current = back; }}
              onCover={setCoverTabs}
              onStatusStyle={setFeedStatus}
              onRequestAuth={() => setTokenModalOpen(true)}
            />
          </View>
          <ChatRuntime boot={boot} token={token}>
            {showList ? (
              <View style={split ? { width: listWidth, borderRightWidth: 1, borderRightColor: colors.line, paddingBottom: insets.bottom } : { flex: 1 }}>
                {boot.phase === "ready" ? (
                  <ConversationList
                    colors={colors}
                    statusNote={listStatusNote}
                    onOpen={() => setThread(true)}
                  />
                ) : (
                  <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }}>
                    <Text style={{ fontSize: 20, lineHeight: 28, fontWeight: "700", color: colors.text }}>对话</Text>
                    <Text style={{ marginTop: 12, color: colors.muted, fontSize: 14, lineHeight: 20 }}>{boot.phase === "error" ? boot.message : "正在打开"}</Text>
                    {boot.phase === "error" && isUnauthorizedMessage(boot.message) ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="输入访问口令"
                        onPress={() => setTokenModalOpen(true)}
                        style={{ marginTop: 14, alignSelf: "flex-start", height: 44, paddingHorizontal: 20, borderRadius: 22, backgroundColor: colors.btnPrimaryBg, alignItems: "center", justifyContent: "center" }}
                      >
                        <Text style={{ color: colors.btnPrimaryFg, fontSize: 14, fontWeight: "700" }}>输入访问口令</Text>
                      </Pressable>
                    ) : null}
                  </View>
                )}
              </View>
            ) : null}
            {thread && boot.phase === "ready" ? (
              <View
                pointerEvents={showThread ? "auto" : "none"}
                style={showThread ? { flex: 1, minWidth: 0 } : { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0, zIndex: -1 }}
              >
                <LiveChat
                  scheme={scheme}
                  showBack={!split}
                  onBack={() => setThread(false)}
                  view={connectionView}
                  onOpenLibrary={openKb}
                  onManageToken={() => setTokenModalOpen(true)}
                  active={showThread}
                />
              </View>
            ) : showThread ? (
              <View style={{ flex: 1, minWidth: 0 }}>
                <ChatEmpty colors={colors} />
              </View>
            ) : null}
          </ChatRuntime>
          <View
            pointerEvents={tab === "kb" ? "auto" : "none"}
            style={tab === "kb" ? { flex: 1 } : { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0, zIndex: -1 }}
          >
            <LibraryPane
              active={tab === "kb"}
              colors={colors}
              scheme={scheme}
              split={split}
              listWidth={listWidth}
              onBackReady={(back) => { kbBack.current = back; }}
              onExternal={(url) => { Linking.openURL(url).catch(() => {}); }}
            />
          </View>
        </View>
        <TokenModal
          visible={tokenModalOpen}
          colors={colors}
          hasToken={token.length > 0}
          onClose={() => setTokenModalOpen(false)}
          onSubmit={handleSaveToken}
          onClear={handleClearToken}
        />
        {showBottomTabs && !coverTabs ? (
          <Animated.View
            pointerEvents={coverTabs ? "none" : "auto"}
            style={{
              opacity: tabOpacity,
              backgroundColor: colors.canvas,
              borderTopWidth: 1,
              borderTopColor: colors.line,
              paddingBottom: insets.bottom,
            }}
          >
            <View style={{ height: TAB_HEIGHT, flexDirection: "row" }}>
              {TABS.map(([id, label, icon]) => {
                const current = tab === id;
                return (
                  <Pressable
                    key={id}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: current }}
                    accessibilityLabel={label}
                    onPress={() => setTab(id)}
                    style={{ flex: 1, alignItems: "center", justifyContent: "flex-start", paddingTop: 8 }}
                  >
                    <View>
                      <TabBarIcon name={icon} tone={dark ? "dark" : "light"} selected={current} />
                      {id === "feed" && todayUnread && !current ? (
                        <View style={{ position: "absolute", top: -4, right: -6, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.canvas }} />
                      ) : null}
                    </View>
                    <Text style={{ marginTop: 4, fontSize: 12, lineHeight: 16, fontWeight: current ? "700" : "400", color: current ? colors.text : colors.muted }}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}
