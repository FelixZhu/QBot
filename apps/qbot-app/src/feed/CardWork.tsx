import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { WebView as RNWebView } from "react-native-webview";
import type { ComponentType, Ref } from "react";
import { ChatMark } from "../chat-ui/ChatMarks";
import type { Palette, Scheme } from "../theme";
import { workThemeScript } from "./immersive";

type WebViewHandle = { stopLoading?: () => void };
const WebView = RNWebView as unknown as ComponentType<Record<string, unknown> & { ref?: Ref<WebViewHandle> }>;

/** Opens one card document. The page does not receive the app token, and it cannot leave its bundle. */
export function CardWork({
  url,
  title,
  colors,
  scheme = "light",
  topInset = 0,
  onClose,
}: {
  url: string;
  title: string;
  colors: Palette;
  scheme?: Scheme;
  topInset?: number;
  onClose: () => void;
}) {
  const allow = useMemo(() => {
    const page = new URL(url);
    const directory = page.pathname.slice(0, page.pathname.lastIndexOf("/") + 1);
    return (next: string) => {
      if (next === "about:blank") return true;
      try {
        const target = new URL(next);
        if (target.protocol !== "http:" && target.protocol !== "https:") return false;
        if (target.origin !== page.origin) return false;
        return target.pathname.startsWith(directory);
      } catch {
        return false;
      }
    };
  }, [url]);
  const dark = scheme === "dark";
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: topInset }}>
      <View style={{ height: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.bg }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          onPress={onClose}
          hitSlop={6}
          style={({ pressed }) => ({
            minWidth: 44,
            minHeight: 44,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 6,
            borderRadius: 10,
            opacity: pressed ? 0.65 : 1,
          })}
        >
          <ChatMark name="back" color={colors.text} size={22} />
        </Pressable>
        <Text style={{ flex: 1, color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: "700", paddingLeft: 4, paddingRight: 12 }} numberOfLines={1}>{title}</Text>
      </View>
      <WebView
        source={{ uri: url }}
        originWhitelist={["*"]}
        onShouldStartLoadWithRequest={(request: { url?: string }) => allow(request.url ?? "")}
        injectedJavaScriptBeforeContentLoaded={workThemeScript(dark)}
        javaScriptEnabled
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        incognito
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        allowFileAccess={false}
        allowingReadAccessToURL={undefined}
        mixedContentMode="never"
        cacheEnabled
        style={{ flex: 1, backgroundColor: colors.canvas }}
      />
    </View>
  );
}
