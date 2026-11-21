import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, Text, useColorScheme, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QbotAvatar } from "../QbotAvatar";
import { palette, resolveScheme } from "../theme";
import { CardWork } from "./CardWork";
import {
  artifactUrl,
  createFeedClient,
  feedColumnWidth,
  formatPublished,
  presentFeed,
  type FeedCard,
  type FeedScope,
} from "./feedClient";

const CACHE = "qbot.feed.cache.v1";

type Work = { title: string; url: string };

export function CardFeed({
  active,
  origin,
  onBackReady,
  onCover,
  onFollowChange,
}: {
  active: boolean;
  origin: string | null;
  onBackReady: (back: () => boolean) => void;
  onCover: (covered: boolean) => void;
  onFollowChange?: (bot: { id: string; slug: string; followed: boolean }) => void;
}) {
  const scheme = resolveScheme(useColorScheme());
  const colors = palette[scheme];
  const listRef = useRef<FlatList<FeedCard>>(null);
  const offset = useRef(0);
  const [width, setWidth] = useState(0);
  const [scope, setScope] = useState<FeedScope>("following");
  const [cards, setCards] = useState<FeedCard[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [cached, setCached] = useState(false);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [work, setWork] = useState<Work | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const column = feedColumnWidth(width);

  const load = useCallback(async (nextScope: FeedScope, cursor?: string | null) => {
    if (!origin) {
      setPhase("error");
      setMessage("这一版没有带上服务器地址");
      setCards([]);
      setCached(false);
      return;
    }
    const client = createFeedClient({ origin });
    if (!cursor) {
      setPhase("loading");
      setCards([]);
      setCached(false);
    }
    try {
      const page = await client.feed(nextScope, cursor);
      setCards((current) => cursor ? merge(current, page.cards) : page.cards);
      setNext(page.next);
      setPhase("ready");
      setCached(false);
      setMessage("");
      if (!cursor) {
        await AsyncStorage.setItem(`${CACHE}.${nextScope}`, JSON.stringify({ cards: page.cards, savedAt: new Date().toISOString() }));
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : "无法连接服务器";
      if (cursor) {
        setMessage(text);
        return;
      }
      const saved = await readCache(nextScope);
      setCards(saved);
      setCached(saved.length > 0);
      setPhase("error");
      setMessage(text);
    }
  }, [origin]);

  useEffect(() => {
    if (!active) return;
    setCovers({});
    void load(scope);
  }, [active, load, scope]);

  useEffect(() => {
    if (!origin || cards.length === 0) return;
    let alive = true;
    const client = createFeedClient({ origin });
    for (const card of cards) {
      if (covers[card.id]) continue;
      void client.capability(card.id).then((capability) => {
        if (!alive) return;
        setCovers((current) => ({
          ...current,
          [card.id]: artifactUrl(origin, capability.artifactId, capability.version, capability.token, card.coverPath),
        }));
      }).catch(() => {});
    }
    return () => { alive = false; };
  }, [cards, covers, origin]);

  const close = useCallback(() => {
    setWork(null);
    onCover(false);
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: offset.current, animated: false }));
  }, [onCover]);

  const back = useCallback(() => {
    if (!work) return false;
    close();
    return true;
  }, [close, work]);

  useEffect(() => { onBackReady(back); }, [back, onBackReady]);

  const open = async (card: FeedCard) => {
    if (!origin) return;
    setBusy(card.id);
    try {
      const capability = await createFeedClient({ origin }).capability(card.id);
      const page = capability.files.find((file) => file.path === "index.html")?.path ?? "index.html";
      setWork({ title: card.title, url: artifactUrl(origin, capability.artifactId, capability.version, capability.token, page) });
      onCover(true);
    } catch (error) {
      setPhase("error");
      setMessage(error instanceof Error ? error.message : "无法连接服务器");
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (card: FeedCard) => {
    if (!origin) return;
    const followed = !card.bot.followed;
    setBusy(card.bot.id);
    try {
      const bot = await createFeedClient({ origin }).setFollow(card.bot.id, followed);
      setCards((current) => current
        .map((item) => item.bot.id === bot.id ? { ...item, bot: { ...item.bot, followed: bot.followed } } : item)
        .filter((item) => scope !== "following" || item.bot.followed));
      onFollowChange?.({ id: bot.id, slug: bot.slug, followed: bot.followed });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法连接服务器");
    } finally {
      setBusy(null);
    }
  };

  const view = presentFeed({ phase, count: cards.length, cached, message });
  return (
    <View
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      style={{ flex: 1, backgroundColor: colors.bg }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <View style={{ width: column, alignSelf: "center", flex: 1 }}>
        <Text style={{ paddingHorizontal: 16, paddingTop: 8, fontSize: 20, lineHeight: 26, fontWeight: "700", color: colors.text }}>今日</Text>
        <View style={{ flexDirection: "row", paddingHorizontal: 8, paddingBottom: 8 }}>
          {([
            ["following", "关注"],
            ["recommended", "推荐"],
          ] as const).map(([id, label]) => {
            const selected = scope === id;
            return (
              <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={label} onPress={() => setScope(id)} style={{ minHeight: 40, justifyContent: "center", paddingHorizontal: 8 }}>
                <Text style={{ fontSize: 16, fontWeight: selected ? "700" : "400", color: selected ? colors.text : colors.muted }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        {view.kind === "cached" ? <Text style={{ paddingHorizontal: 16, paddingBottom: 8, color: colors.muted }}>{view.message}</Text> : null}
        {view.kind === "error" ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 24 }}>
            <Text style={{ color: colors.text, fontSize: 16 }}>{view.message}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="重试" onPress={() => void load(scope)} style={{ marginTop: 16, alignSelf: "flex-start" }}>
              <Text style={{ color: colors.accentInk, fontSize: 16, fontWeight: "700" }}>重试</Text>
            </Pressable>
          </View>
        ) : null}
        {view.kind === "loading" ? <Text style={{ paddingHorizontal: 16, color: colors.muted }}>正在打开</Text> : null}
        {view.kind === "empty" ? <Text style={{ paddingHorizontal: 16, paddingTop: 24, color: colors.muted, fontSize: 16 }}>暂时没有新内容</Text> : null}
        {view.kind === "ready" || view.kind === "cached" ? (
          <FlatList
            ref={listRef}
            data={cards}
            keyExtractor={(card) => card.id}
            onScroll={(event) => { offset.current = event.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={32}
            contentContainerStyle={{ paddingBottom: 24 }}
            onEndReached={() => { if (next && phase === "ready") void load(scope, next); }}
            renderItem={({ item }) => (
              <View style={{ marginHorizontal: 16, marginBottom: 16, borderRadius: 16, overflow: "hidden", backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.line }}>
                <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingTop: 12 }}>
                  <QbotAvatar size={32} />
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>{item.bot.displayName}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{formatPublished(item.publishedAt)}</Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={item.bot.followed ? "已关注" : "关注"} onPress={() => void toggle(item)} style={{ minHeight: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.line, justifyContent: "center" }}>
                    <Text style={{ color: colors.text, fontSize: 13, fontWeight: "700" }}>{item.bot.followed ? "已关注" : "关注"}</Text>
                  </Pressable>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={item.title} onPress={() => void open(item)}>
                  <Text style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8, color: colors.text, fontSize: 18, lineHeight: 24, fontWeight: "700" }}>{item.title}</Text>
                  {covers[item.id] ? (
                    <Image source={{ uri: covers[item.id] }} accessibilityElementsHidden style={{ width: "100%", aspectRatio: 780 / 1040, backgroundColor: colors.line }} />
                  ) : (
                    <View style={{ height: 180, alignItems: "center", justifyContent: "center" }}>
                      {busy === item.id ? <ActivityIndicator color={colors.accentInk} /> : <Text style={{ color: colors.muted }}>封面没有载入</Text>}
                    </View>
                  )}
                </Pressable>
              </View>
            )}
          />
        ) : null}
      </View>
      {work ? (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
          <CardWork url={work.url} title={work.title} colors={colors} onClose={close} />
        </View>
      ) : null}
    </View>
  );
}

function merge(current: FeedCard[], page: FeedCard[]): FeedCard[] {
  const seen = new Set(current.map((card) => card.id));
  return [...current, ...page.filter((card) => !seen.has(card.id))];
}

async function readCache(scope: FeedScope): Promise<FeedCard[]> {
  try {
    const raw = await AsyncStorage.getItem(`${CACHE}.${scope}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { cards?: FeedCard[] };
    return Array.isArray(parsed.cards) ? parsed.cards.filter((card) => card.provenance === "manual" && card.title && card.id) : [];
  } catch {
    return [];
  }
}
