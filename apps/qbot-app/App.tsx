import { useCallback, useEffect, useRef, useState } from "react";
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
import { ChatEmpty, ChatList } from "./src/ChatPane";
import { LiveChat } from "./src/chat/LiveChat";
import { liveBadge } from "./src/chat/connectionCopy";
import { useServerConnection } from "./src/chat/useServerConnection";
import { BookIcon, BubbleIcon, StarIcon } from "./src/TabIcons";
import { isSplit, listPaneWidth, palette, resolveScheme } from "./src/theme";
import { LessonFeed } from "./src/feed/LessonFeed";
import { pullUpdate } from "./src/updates";
import { WebPane, type WebPaneHandle } from "./src/WebPane";
import * as Updates from "expo-updates";

type Tab = "chat" | "feed" | "kb";
const EXIT_CONFIRM_MS = 2000;
const TAB_HEIGHT = 60;
const TAB_AMBER = "#F5A623";
const TAB_CREAM = "#F4F1EA";
const TAB_MUTED = "#8A8A8E";

function TabIcon({ id, color, filled }: { id: Tab; color: string; filled: boolean }) {
  if (id === "chat") return <BubbleIcon color={color} filled={filled} size={24} />;
  if (id === "feed") return <StarIcon color={color} size={24} />;
  return <BookIcon color={color} size={24} />;
}

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
  const [tab, setTab] = useState<Tab>("chat");
  const [thread, setThread] = useState(false);
  const connection = useServerConnection();
  const [keyboard, setKeyboard] = useState(false);
  const [webReady, setWebReady] = useState(false);
  const [coverTabs, setCoverTabs] = useState(false);
  const tabOpacity = useRef(new Animated.Value(1)).current;
  const live = thread;

  useEffect(() => {
    setBackgroundColorAsync(colors.canvas).catch(() => {});
  }, [colors.canvas]);

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
    setWebReady(true);
    setTab("kb");
    webRef.current?.show("kb");
  };

  const showTabs = !(keyboard && tab === "chat");
  const showList = tab === "chat" && (split || !live);
  const showThread = tab === "chat" && (split || live);

  const feedOn = tab === "feed" || coverTabs;
  return (
    <View style={{ flex: 1, backgroundColor: feedOn ? "#0B0B0F" : colors.canvas, paddingTop: insets.top }}>
      <StatusBar style={feedOn ? "light" : colors.status} />
      <View style={{ flex: 1, position: "relative", flexDirection: split && tab === "chat" ? "row" : "column" }}>
        <View
          pointerEvents={tab === "feed" ? "auto" : "none"}
          style={tab === "feed" ? { flex: 1 } : { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0, zIndex: -1 }}
        >
          <LessonFeed
            active={tab === "feed"}
            onBackReady={(back) => { feedBack.current = back; }}
            onCover={setCoverTabs}
          />
        </View>
        {showList ? (
          <View style={split ? { width: listWidth, borderRightWidth: 1, borderRightColor: colors.line } : { flex: 1 }}>
            <ChatList
              colors={colors}
              badge={liveBadge(connection.view)}
              selected={live}
              onOpen={() => setThread(true)}
            />
          </View>
        ) : null}
        {showThread ? (
          <View style={{ flex: 1, minWidth: 0 }}>
            {live ? (
              <LiveChat
                colors={colors}
                showBack={!split}
                onBack={() => setThread(false)}
                view={connection.view}
              />
            ) : (
              <ChatEmpty colors={colors} />
            )}
          </View>
        ) : null}
        {webReady ? (
          <WebPane
            ref={webRef}
            visible={tab === "kb"}
            tab="kb"
            dark={dark}
            backgroundColor={colors.canvas}
            onBackResult={onBackResult}
            onExternal={(url) => { Linking.openURL(url).catch(() => {}); }}
          />
        ) : null}
      </View>
      {showTabs ? (
        <Animated.View
          pointerEvents={coverTabs ? "none" : "auto"}
          style={{
            opacity: tabOpacity,
            backgroundColor: "#000",
            borderTopWidth: 1,
            borderTopColor: "#1A1A1A",
            paddingBottom: insets.bottom,
          }}
        >
          <View style={{ height: TAB_HEIGHT, flexDirection: "row" }}>
            {([
              ["chat", "对话"],
              ["feed", "主动服务"],
              ["kb", "知识库"],
            ] as const).map(([id, label]) => {
              const current = tab === id;
              const color = current ? TAB_AMBER : TAB_MUTED;
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
                  style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
                >
                  <TabIcon id={id} color={color} filled={current} />
                  <Text style={{ marginTop: 3, fontSize: 11, lineHeight: 14, fontWeight: current ? "700" : "400", color: current ? TAB_CREAM : TAB_MUTED }}>
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
