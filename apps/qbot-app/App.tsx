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
import { ChatEmpty, ConversationList } from "./src/ChatPane";
import { LiveChat } from "./src/chat/LiveChat";
import { liveBadge } from "./src/chat/connectionCopy";
import { ChatRuntime, useChatBoot } from "./src/chat/useChatRuntime";
import { configuredOrigin } from "./src/chat/serverEndpoint";
import { createServerClient } from "./src/chat/serverClient";
import type { ConnectionView } from "./src/chat/serverSession";
import { TabBarIcon } from "./src/TabBarIcon";
import { chatChrome, isSplit, listPaneWidth, palette, resolveScheme } from "./src/theme";
import { createFeedClient } from "./src/feed/feedClient";
import { CardFeed } from "./src/feed/CardFeed";
import type { StatusIcons } from "./src/feed/immersive";
import { pullUpdate } from "./src/updates";
import { WebPane, type WebPaneHandle } from "./src/WebPane";
import * as Updates from "expo-updates";

type Tab = "chat" | "feed" | "kb";
const EXIT_CONFIRM_MS = 2000;
const TAB_HEIGHT = 56;

function Shell() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const split = isSplit(width);
  const listWidth = listPaneWidth(width);
  const scheme = resolveScheme(useColorScheme());
  const colors = palette[scheme];
  const dark = scheme === "dark";
  const webRef = useRef<WebPaneHandle>(null);
  const feedBack = useRef<() => boolean>(() => false);
  const lastExit = useRef(0);
  const [tab, setTab] = useState<Tab>("feed");
  const [todayUnread] = useState(false);
  const [follow, setFollow] = useState<"loading" | "on" | "off" | "error">("loading");
  const origin = configuredOrigin();
  const [thread, setThread] = useState(false);
  const boot = useChatBoot();
  const serverClient = useMemo(() => createServerClient({ origin: origin ?? "" }), [origin]);
  const connectionView = useMemo<ConnectionView>(() => (
    boot.phase === "ready"
      ? {
        phase: "ready",
        origin: origin ?? "",
        token: "",
        session: boot.session ?? { ownerId: "", agentId: "", model: "", upstream: "openrouter" },
        conversationId: boot.initialThreadId ?? "",
        client: serverClient,
      }
      : boot.phase === "error"
        ? { phase: "error", message: boot.message ?? "无法连接服务器" }
        : { phase: "checking" }
  ), [boot.initialThreadId, boot.message, boot.phase, boot.session, origin, serverClient]);
  const [keyboard, setKeyboard] = useState(false);
  const [webReady, setWebReady] = useState(false);
  const [libraryReady, setLibraryReady] = useState(false);
  const [coverTabs, setCoverTabs] = useState(false);
  const [feedStatus, setFeedStatus] = useState<StatusIcons | null>(null);
  const tabOpacity = useRef(new Animated.Value(1)).current;
  const live = thread;
  const inThread = tab === "chat" && thread;
  const showTabs = !inThread && !(keyboard && tab === "chat");
  const showList = tab === "chat" && (split || !live);
  const showThread = tab === "chat" && (split || live);
  const screenChrome = chatChrome(scheme);

  useEffect(() => {
    if (!origin) {
      setFollow("error");
      return;
    }
    let alive = true;
    createFeedClient({ origin }).botBySlug("qbot").then((bot) => {
      if (alive) setFollow(bot.followed ? "on" : "off");
    }).catch(() => { if (alive) setFollow("error"); });
    return () => { alive = false; };
  }, [origin]);

  useEffect(() => {
    if (follow === "off") setThread(false);
  }, [follow]);

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
    const timer = setTimeout(() => setWebReady(true), 400);
    return () => clearTimeout(timer);
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
    webRef.current?.setTheme(dark);
  }, [dark]);

  useEffect(() => {
    Animated.timing(tabOpacity, { toValue: coverTabs ? 0 : 1, duration: 300, useNativeDriver: true }).start();
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

  const onBackResult = useCallback((handled: boolean) => {
    if (handled) {
      lastExit.current = 0;
      return;
    }
    exitOrHint();
  }, [exitOrHint]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (tab === "chat" && thread) {
        setThread(false);
        return true;
      }
      if (tab === "feed" && feedBack.current()) return true;
      if (tab === "kb") {
        webRef.current?.back();
        return true;
      }
      exitOrHint();
      return true;
    });
    return () => sub.remove();
  }, [tab, thread, exitOrHint]);

  const openKb = () => {
    console.log(`QBOT_TIMING kb-tap ${libraryReady ? "warm" : "cold"}`);
    setWebReady(true);
    setTab("kb");
    webRef.current?.show("kb");
  };

  return (
    <View style={{ flex: 1, backgroundColor: inThread ? screenChrome.canvas : colors.canvas, paddingTop: tab === "feed" ? 0 : insets.top }}>
      <StatusBar style={tab === "feed" && feedStatus ? feedStatus : colors.status} />
      <View style={{ flex: 1, position: "relative", flexDirection: split && tab === "chat" ? "row" : "column" }}>
        <View
          pointerEvents={tab === "feed" ? "auto" : "none"}
          style={tab === "feed" ? { flex: 1 } : { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0, zIndex: -1 }}
        >
          <CardFeed
            active={tab === "feed"}
            origin={origin}
            topInset={insets.top}
            onBackReady={(back) => { feedBack.current = back; }}
            onCover={setCoverTabs}
            onFollowChange={(bot) => { if (bot.slug === "qbot") setFollow(bot.followed ? "on" : "off"); }}
            onStatusStyle={setFeedStatus}
          />
        </View>
        <ChatRuntime boot={boot}>
        {showList ? (
          <View style={split ? { width: listWidth, borderRightWidth: 1, borderRightColor: colors.line, paddingBottom: thread && !showTabs ? insets.bottom : 0 } : { flex: 1 }}>
            {boot.phase === "ready" ? (
              <ConversationList
                colors={colors}
                badge={liveBadge(connectionView)}
                onOpen={() => setThread(true)}
                follow={follow}
              />
            ) : (
              <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }}>
                <Text style={{ fontSize: 20, lineHeight: 26, fontWeight: "700", color: colors.text }}>对话</Text>
                <Text style={{ marginTop: 12, color: colors.muted, fontSize: 14 }}>{boot.phase === "error" ? boot.message : "正在打开"}</Text>
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
              active={showThread}
            />
          </View>
        ) : showThread ? (
          <View style={{ flex: 1, minWidth: 0 }}>
            <ChatEmpty colors={colors} />
          </View>
        ) : null}
        </ChatRuntime>
        {webReady ? (
          <WebPane
            ref={webRef}
            visible={tab === "kb"}
            tab="kb"
            dark={dark}
            backgroundColor={colors.canvas}
            onBackResult={onBackResult}
            onReady={() => setLibraryReady(true)}
            onExternal={(url) => { Linking.openURL(url).catch(() => {}); }}
          />
        ) : null}
      </View>
      {showTabs && !coverTabs ? (
        <Animated.View
          pointerEvents={coverTabs ? "none" : "auto"}
          style={{
            opacity: tabOpacity,
            backgroundColor: dark ? "#171614" : "#F3EFE7",
            borderTopWidth: 1,
            borderTopColor: dark ? "#34312C" : "#E3DDD1",
            paddingBottom: insets.bottom,
          }}
        >
          <View style={{ height: TAB_HEIGHT, flexDirection: "row" }}>
            {([
              ["feed", "今日", "discover"],
              ["chat", "对话", "chat"],
              ["kb", "知识库", "library"],
            ] as const).map(([id, label, icon]) => {
              const current = tab === id;
              const ink = dark ? "#EDE8DF" : "#1C1B19";
              const quiet = dark ? "#9A9386" : "#736D62";
              return (
                <Pressable
                  key={id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: current }}
                  accessibilityLabel={label}
                  onPress={() => {
                    if (id === "chat") {
                      webRef.current?.park();
                      setTab("chat");
                    } else if (id === "feed") setTab("feed");
                    else openKb();
                  }}
                  style={{ flex: 1, alignItems: "center", justifyContent: "flex-start", paddingTop: 8 }}
                >
                  <View>
                    <TabBarIcon name={icon} tone={dark ? "dark" : "light"} selected={current} />
                    {id === "feed" && todayUnread && !current ? (
                      <View style={{ position: "absolute", top: -4, right: -6, width: 12, height: 12, borderRadius: 6, backgroundColor: "#FF6A2B", borderWidth: 2, borderColor: dark ? "#171614" : "#F3EFE7" }} />
                    ) : null}
                  </View>
                  <Text style={{ marginTop: 4, fontSize: 12, lineHeight: 16, fontWeight: current ? "700" : "400", color: current ? ink : quiet }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      ) : null}
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
