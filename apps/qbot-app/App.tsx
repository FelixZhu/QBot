import { useCallback, useEffect, useRef, useState } from "react";
import {
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
import { ChatEmpty, ChatList, ChatThread } from "./src/ChatPane";
import { findDemo, type DemoId } from "./src/demos";
import { isSplit, palette, resolveScheme } from "./src/theme";
import { FeedPane } from "./src/feed/FeedPane";
import { WebPane, type WebPaneHandle } from "./src/WebPane";

type Tab = "chat" | "feed" | "kb";
const EXIT_CONFIRM_MS = 2000;

function Shell() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const split = isSplit(width);
  const scheme = resolveScheme(useColorScheme());
  const colors = palette[scheme];
  const dark = scheme === "dark";
  const webRef = useRef<WebPaneHandle>(null);
  const feedBack = useRef<() => boolean>(() => false);
  const lastExit = useRef(0);
  const [tab, setTab] = useState<Tab>("chat");
  const [thread, setThread] = useState<DemoId | null>(null);
  const [query, setQuery] = useState("");
  const [keyboard, setKeyboard] = useState(false);
  const [webReady, setWebReady] = useState(false);
  const demo = findDemo(thread);

  useEffect(() => {
    setBackgroundColorAsync(colors.canvas).catch(() => {});
  }, [colors.canvas]);

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
        setThread(null);
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
  const showList = tab === "chat" && (split || !demo);
  const showThread = tab === "chat" && (split || !!demo);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: insets.top }}>
      <StatusBar style={colors.status} />
      <View style={{ flex: 1, position: "relative", flexDirection: split && tab === "chat" ? "row" : "column" }}>
        <View
          pointerEvents={tab === "feed" ? "auto" : "none"}
          style={tab === "feed" ? { flex: 1 } : { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0, zIndex: -1 }}
        >
          <FeedPane
            colors={colors}
            split={split}
            active={tab === "feed"}
            onBackReady={(back) => { feedBack.current = back; }}
          />
        </View>
        {showList ? (
          <View style={{ flex: split ? 0.42 : 1, minWidth: split ? 280 : undefined, borderRightWidth: split ? 1 : 0, borderRightColor: colors.line }}>
            <ChatList colors={colors} query={query} onQuery={setQuery} selected={thread} onOpen={setThread} />
          </View>
        ) : null}
        {showThread ? (
          <View style={{ flex: 1 }}>
            {demo ? (
              <ChatThread demo={demo} colors={colors} showBack={!split} onBack={() => setThread(null)} />
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
        <View
          style={{
            flexDirection: "row",
            borderTopWidth: 1,
            borderTopColor: colors.line,
            backgroundColor: colors.canvas,
            paddingBottom: Math.max(insets.bottom, 6),
            paddingTop: 6,
          }}
        >
          {([
            ["chat", "对话"],
            ["feed", "主动服务"],
            ["kb", "知识库"],
          ] as const).map(([id, label]) => {
            const current = tab === id;
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
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: 48,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 12,
                  marginHorizontal: 6,
                  backgroundColor: pressed ? colors.press : "transparent",
                })}
              >
                <Text style={{ fontSize: 12, lineHeight: 16, fontWeight: current ? "700" : "500", color: current ? colors.text : colors.muted }}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
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
