import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import type { AppStateStatus } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView as RNWebView } from 'react-native-webview';
import type { ComponentType, Ref } from 'react';

// react-native-webview 14.0.1's bundled typings collapse to `never` against
// RN 0.88 types; the runtime component is fine, so use a loose local type.
type WebViewHandle = { goBack(): void; reload(): void; injectJavaScript(js: string): void };
type Ev = { nativeEvent: any };
const WebView = RNWebView as unknown as ComponentType<Record<string, unknown> & { ref?: Ref<WebViewHandle> }>;

const HOME_URL = 'https://felixzhu.github.io/qian-drive/';
const HOME_ORIGIN = 'https://felixzhu.github.io';
const HOME_PATH = '/qian-drive';
const RESUME_RELOAD_MS = 5 * 60 * 1000;

function hashOf(href: string) {
  const i = href.indexOf('#');
  return i >= 0 ? href.slice(i) : '';
}

function homeUri(hash = '') {
  const h = !hash ? '' : hash.startsWith('#') ? hash : '#' + hash;
  return `${HOME_URL}?v=${Date.now()}${h}`;
}

// Reports in-page navigation (hash routes, pushState) and whether the page
// is scrolled to the top, so Android pull-to-refresh can be enabled safely.
const PAGE_BRIDGE = `
(function () {
  function reportNav() {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'nav', href: location.href, length: history.length
      }));
    } catch (e) {}
  }
  ['hashchange', 'popstate'].forEach(function (ev) { window.addEventListener(ev, reportNav); });
  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    history[m] = function () { var r = orig.apply(this, arguments); setTimeout(reportNav, 0); return r; };
  });
  reportNav();

  var lastTop = null;
  function isAtTop() {
    function top(el) { return !el || (el.scrollTop || 0) <= 0; }
    if (!top(document.scrollingElement) || !top(document.documentElement) || !top(document.body)) return false;
    var nodes = document.querySelectorAll('.scroller,.tree,.pdfwrap,.qs-list,.info');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if ((el.scrollHeight > el.clientHeight + 1) && el.scrollTop > 0) return false;
    }
    return true;
  }
  function reportScroll() {
    var v = isAtTop();
    if (v === lastTop) return;
    lastTop = v;
    try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'scroll', atTop: v })); } catch (e) {}
  }
  window.addEventListener('scroll', reportScroll, { capture: true, passive: true });
  document.addEventListener('touchstart', reportScroll, { capture: true, passive: true });
  document.addEventListener('touchmove', reportScroll, { capture: true, passive: true });
  setInterval(reportScroll, 600);
  reportScroll();
})();
true;
`;

function isInternal(url: string) {
  return url.startsWith(HOME_ORIGIN + HOME_PATH) || url.startsWith('about:') || url.startsWith('blob:') || url.startsWith('data:');
}

function DriveScreen() {
  const ref = useRef<WebViewHandle>(null);
  const lastHash = useRef('');
  const bgAt = useRef<number | null>(null);
  const [uri, setUri] = useState(() => homeUri());
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const dark = useColorScheme() === 'dark';
  const bg = dark ? '#16151c' : '#f6f5fb';
  const fg = dark ? '#ecebf5' : '#1f1d2b';

  const loadFresh = useCallback((opts?: { remount?: boolean }) => {
    setError(null);
    setLoading(true);
    setUri(homeUri(lastHash.current));
    if (opts?.remount) setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack && ref.current) {
        ref.current.goBack();
        return true;
      }
      return false; // let Android leave the app
    });
    return () => sub.remove();
  }, [canGoBack]);

  useEffect(() => {
    const onChange = (s: AppStateStatus) => {
      if (s === 'background' || s === 'inactive') {
        if (bgAt.current == null) bgAt.current = Date.now();
        return;
      }
      if (s === 'active') {
        const t = bgAt.current;
        bgAt.current = null;
        if (t && Date.now() - t > RESUME_RELOAD_MS) loadFresh({ remount: true });
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [loadFresh]);

  const openExternal = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {});
  }, []);

  const retry = useCallback(() => {
    setRefreshing(false);
    loadFresh({ remount: true });
  }, [loadFresh]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadFresh({ remount: true });
  }, [loadFresh]);

  const onMessage = useCallback((e: Ev) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data || '{}');
      if (msg.type === 'nav' && typeof msg.href === 'string') {
        lastHash.current = hashOf(msg.href);
      } else if (msg.type === 'scroll') {
        setAtTop(!!msg.atTop);
      }
    } catch (_) {}
  }, []);

  const webView = (
    <WebView
      key={reloadKey}
      ref={ref}
      source={{ uri }}
      style={[styles.fill, { backgroundColor: bg }]}
      javaScriptEnabled
      domStorageEnabled
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      allowsFullscreenVideo
      allowsBackForwardNavigationGestures
      pullToRefreshEnabled={Platform.OS === 'ios'}
      setSupportMultipleWindows
      cacheEnabled
      cacheMode="LOAD_DEFAULT"
      nestedScrollEnabled
      overScrollMode="never"
      originWhitelist={['*']}
      injectedJavaScript={PAGE_BRIDGE}
      onNavigationStateChange={(nav: { canGoBack: boolean }) => setCanGoBack(nav.canGoBack)}
      onMessage={onMessage}
      onLoadStart={() => setLoading(true)}
      onLoadEnd={() => {
        setLoading(false);
        setRefreshing(false);
      }}
      onError={(e: Ev) => {
        setRefreshing(false);
        setError(e.nativeEvent.description || '网络错误');
      }}
      onHttpError={(e: Ev) => {
        if (e.nativeEvent.url?.startsWith(HOME_URL) && e.nativeEvent.statusCode >= 500) {
          setError(`服务器返回 ${e.nativeEvent.statusCode}`);
        }
      }}
      onRenderProcessGone={() => retry()}
      onContentProcessDidTerminate={() => ref.current?.reload()}
      // target=_blank links and window.open (downloads, "open in new tab")
      onOpenWindow={(e: Ev) => openExternal(e.nativeEvent.targetUrl)}
      onShouldStartLoadWithRequest={(req: { url: string; isTopFrame?: boolean }) => {
        if (req.isTopFrame === false) return true; // iframes/media
        if (isInternal(req.url)) return true;
        openExternal(req.url);
        return false;
      }}
      onFileDownload={({ nativeEvent }: Ev) => openExternal(nativeEvent.downloadUrl)}
    />
  );

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: bg }]} edges={['top', 'bottom', 'left', 'right']}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      {error ? (
        <View style={[styles.center, { backgroundColor: bg }]}>
          <Text style={[styles.title, { color: fg }]}>打不开 Qian's Drive</Text>
          <Text style={[styles.msg, { color: fg }]}>{error}</Text>
          <Pressable style={styles.button} onPress={retry}>
            <Text style={styles.buttonText}>重试</Text>
          </Pressable>
        </View>
      ) : Platform.OS === 'android' ? (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.fill}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} enabled={atTop} tintColor="#6d5ae6" colors={['#6d5ae6']} />
          }
        >
          {webView}
        </ScrollView>
      ) : (
        webView
      )}
      {loading && !error && !refreshing && (
        <View pointerEvents="none" style={styles.loading}>
          <ActivityIndicator size="large" color="#6d5ae6" />
        </View>
      )}
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <DriveScreen />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  msg: { fontSize: 14, opacity: 0.7, textAlign: 'center', marginBottom: 24 },
  button: { backgroundColor: '#6d5ae6', paddingHorizontal: 28, paddingVertical: 12, borderRadius: 10 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  loading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
