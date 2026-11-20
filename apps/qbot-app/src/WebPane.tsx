import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { WebView as RNWebView } from "react-native-webview";
import type { ComponentType, Ref } from "react";
import { ASK_BACK, parkWeb, showWebTab, themeBoot, themeUpdate } from "./embed";

type WebViewHandle = { injectJavaScript(js: string): void; reload(): void };
type Ev = { nativeEvent: { data?: string; description?: string; url?: string; statusCode?: number; targetUrl?: string; downloadUrl?: string } };
const WebView = RNWebView as unknown as ComponentType<Record<string, unknown> & { ref?: Ref<WebViewHandle> }>;

export const HOME_URL = "https://felixzhu.github.io/QBot/";
/** The published page opens 知识库 on a fresh #/ visit, before it paints the chat shell. */
export const LIBRARY_URL = `${HOME_URL}#/`;
const kbClock = Date.now();
const HOME_ORIGIN = "https://felixzhu.github.io";
const HOME_PATH = "/QBot";

export type WebTab = "feed" | "kb";
export type WebPaneHandle = {
  back(): void;
  show(tab: WebTab): void;
  park(): void;
  setTheme(dark: boolean): void;
  reload(): void;
};

function isInternal(url: string) {
  return url.startsWith(HOME_ORIGIN + HOME_PATH) || url.startsWith("about:") || url.startsWith("blob:") || url.startsWith("data:");
}

export const WebPane = forwardRef<WebPaneHandle, {
  visible: boolean;
  tab: WebTab;
  dark: boolean;
  backgroundColor: string;
  onBackResult: (handled: boolean) => void;
  onExternal: (url: string) => void;
  onReady?: () => void;
}>(function WebPane({ visible, tab, dark, backgroundColor, onBackResult, onExternal, onReady }, ref) {
  const webRef = useRef<WebViewHandle>(null);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const started = useRef(0);
  const tabRef = useRef(tab);
  const darkRef = useRef(dark);
  tabRef.current = tab;
  darkRef.current = dark;

  const apply = () => {
    webRef.current?.injectJavaScript(themeUpdate(darkRef.current));
    webRef.current?.injectJavaScript(showWebTab(tabRef.current));
  };

  useImperativeHandle(ref, () => ({
    back() {
      webRef.current?.injectJavaScript(ASK_BACK);
    },
    show(next) {
      tabRef.current = next;
      webRef.current?.injectJavaScript(showWebTab(next));
    },
    park() {
      webRef.current?.injectJavaScript(parkWeb());
    },
    setTheme(nextDark) {
      darkRef.current = nextDark;
      webRef.current?.injectJavaScript(themeUpdate(nextDark));
    },
    reload() {
      webRef.current?.reload();
    },
  }));

  return (
    <View
      pointerEvents={visible ? "auto" : "none"}
      style={visible ? [styles.fill, { backgroundColor }] : [styles.parked, { backgroundColor }]}
    >
      <WebView
        ref={webRef}
        source={{ uri: LIBRARY_URL }}
        style={[styles.fill, { backgroundColor }]}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo
        allowsBackForwardNavigationGestures={false}
        pullToRefreshEnabled={false}
        setSupportMultipleWindows
        cacheEnabled
        cacheMode="LOAD_DEFAULT"
        nestedScrollEnabled
        overScrollMode="never"
        forceDarkOn={dark}
        originWhitelist={["*"]}
        injectedJavaScriptBeforeContentLoaded={themeBoot(dark)}
        onLoadStart={() => {
          if (started.current) return;
          started.current = Date.now();
          console.log(`QBOT_TIMING kb-start ${started.current - kbClock}`);
        }}
        onLoadEnd={() => {
          apply();
          if (!readyRef.current) {
            readyRef.current = true;
            setReady(true);
            onReady?.();
            console.log(`QBOT_TIMING kb-ready ${Date.now() - (started.current || kbClock)}`);
          }
        }}
        onMessage={(e: Ev) => {
          try {
            const msg = JSON.parse(e.nativeEvent.data || "{}") as { type?: string; handled?: boolean };
            if (msg.type === "back") onBackResult(!!msg.handled);
          } catch {
            /* ignore malformed page messages */
          }
        }}
        onOpenWindow={(e: Ev) => {
          if (e.nativeEvent.targetUrl) onExternal(e.nativeEvent.targetUrl);
        }}
        onShouldStartLoadWithRequest={(req: { url: string; isTopFrame?: boolean }) => {
          if (req.isTopFrame === false) return true;
          if (isInternal(req.url)) return true;
          onExternal(req.url);
          return false;
        }}
        onFileDownload={({ nativeEvent }: Ev) => {
          if (nativeEvent.downloadUrl) onExternal(nativeEvent.downloadUrl);
        }}
        onContentProcessDidTerminate={() => webRef.current?.reload()}
        {...(Platform.OS === "android" ? { onRenderProcessGone: () => { webRef.current?.reload(); return true; } } : {})}
      />
      {visible && !ready ? (
        <Text pointerEvents="none" style={{ position: "absolute", top: 16, alignSelf: "center", color: "#8A8781", fontSize: 13, lineHeight: 18 }}>正在打开</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  parked: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0, zIndex: -1 },
});
