import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { WebView as RNWebView } from "react-native-webview";
import type { ComponentType, Ref } from "react";
import type { Palette } from "../theme";

type WebViewHandle = { stopLoading?: () => void };
const WebView = RNWebView as unknown as ComponentType<Record<string, unknown> & { ref?: Ref<WebViewHandle> }>;

/** Opens one card document. The page does not receive the app token, and it cannot leave its bundle. */
export function CardWork({
  url,
  title,
  colors,
  onClose,
}: {
  url: string;
  title: string;
  colors: Palette;
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
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ height: 48, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: colors.line }}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={onClose} style={{ minWidth: 64, minHeight: 40, justifyContent: "center", paddingHorizontal: 8 }}>
          <Text style={{ color: colors.accentInk, fontSize: 16, fontWeight: "700" }}>返回</Text>
        </Pressable>
        <Text style={{ flex: 1, color: colors.text, fontSize: 16, fontWeight: "700" }} numberOfLines={1}>{title}</Text>
      </View>
      <WebView
        source={{ uri: url }}
        originWhitelist={[new URL(url).origin]}
        onShouldStartLoadWithRequest={(request: { url?: string }) => allow(request.url ?? "")}
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
        style={{ flex: 1, backgroundColor: colors.bg }}
      />
    </View>
  );
}
