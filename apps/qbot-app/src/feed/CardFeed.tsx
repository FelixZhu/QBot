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
import { nextFeedPage } from "./paging";
import {
  ACCOUNT_GAP,
  ACCOUNT_HEIGHT,
  applyFollow,
  clampPage,
  coverFrame,
  coverSurface,
  EMPTY_ACTION,
  EMPTY_BODY,
  EMPTY_TITLE,
  overlayInk,
  scopeAfterSwipe,
  statusIcons,
  surfaceColor,
  SWITCH_GAP,
  SWITCH_HEIGHT,
  type StatusIcons,
} from "./immersive";

const CACHE = "qbot.feed.cache.v1";

type Work = { title: string; url: string; index: number };

export function CardFeed({
  active,
  origin,
  topInset,
  onBackReady,
  onCover,
  onFollowChange,
  onStatusStyle,
}: {
  active: boolean;
  origin: string | null;
  topInset: number;
  onBackReady: (back: () => boolean) => void;
  onCover: (covered: boolean) => void;
  onFollowChange?: (bot: { id: string; slug: string; followed: boolean }) => void;
  onStatusStyle?: (style: StatusIcons) => void;
}) {
  const scheme = resolveScheme(useColorScheme());
  const colors = palette[scheme];
  const listRef = useRef<FlatList<FeedCard>>(null);
  const touch = useRef({ x: 0, y: 0, moved: false });
  const page = useRef(0);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [scope, setScope] = useState<FeedScope>("following");
  const [cards, setCards] = useState<FeedCard[]>([]);
  const [index, setIndex] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [cached, setCached] = useState(false);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [work, setWork] = useState<Work | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const column = feedColumnWidth(width);
  page.current = index;

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
      setIndex(0);
    }
    try {
      const loaded = await client.feed(nextScope, cursor);
      setCards((current) => cursor ? merge(current, loaded.cards) : loaded.cards);
      setNext(loaded.next);
      setPhase("ready");
      setCached(false);
      setMessage("");
      if (!cursor) {
        await AsyncStorage.setItem(`${CACHE}.${nextScope}`, JSON.stringify({ cards: loaded.cards, savedAt: new Date().toISOString() }));
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
    const restore = work?.index ?? page.current;
    setWork(null);
    onCover(false);
    requestAnimationFrame(() => listRef.current?.scrollToIndex({ index: clampPage(restore, cards.length), animated: false }));
  }, [cards.length, onCover, work]);

  const back = useCallback(() => {
    if (!work) return false;
    close();
    return true;
  }, [close, work]);

  useEffect(() => { onBackReady(back); }, [back, onBackReady]);

  const surface = cards[index] ? coverSurface(cards[index].id) : "paper";
  useEffect(() => {
    if (work) {
      onStatusStyle?.(scheme === "dark" ? "light" : "dark");
      return;
    }
    const current = presentFeed({ phase, count: cards.length, cached, message });
    if (current.kind === "empty") {
      onStatusStyle?.("dark");
      return;
    }
    if (current.kind === "ready" || current.kind === "cached") {
      onStatusStyle?.(statusIcons(surface, scheme));
      return;
    }
    onStatusStyle?.(scheme === "dark" ? "light" : "dark");
  }, [cached, cards.length, message, onStatusStyle, phase, scheme, surface, work]);

  const open = async (card: FeedCard, at: number) => {
    if (!origin || touch.current.moved) return;
    setBusy(card.id);
    try {
      const capability = await createFeedClient({ origin }).capability(card.id);
      const pagePath = capability.files.find((file) => file.path === "index.html")?.path ?? "index.html";
      setWork({ title: card.title, url: artifactUrl(origin, capability.artifactId, capability.version, capability.token, pagePath), index: at });
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
      setCards((current) => {
        const nextCards = applyFollow(current, bot.id, bot.followed, scope);
        setIndex((value) => clampPage(value, nextCards.length));
        return nextCards;
      });
      onFollowChange?.({ id: bot.id, slug: bot.slug, followed: bot.followed });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法连接服务器");
    } finally {
      setBusy(null);
    }
  };

  const view = presentFeed({ phase, count: cards.length, cached, message });
  const frame = coverFrame({ width: column || width, height, topInset });
  const overlayScheme = view.kind === "empty" ? "light" : scheme;
  const ink = overlayInk(view.kind === "empty" ? "paper" : surface, overlayScheme);
  const quiet = overlayScheme === "dark" && surface !== "orange" ? "rgba(237,232,223,0.6)" : "rgba(28,27,25,0.6)";
  const ground = view.kind === "empty" || view.kind === "ready" || view.kind === "cached"
    ? surfaceColor(view.kind === "empty" ? "paper" : surface, scheme)
    : scheme === "dark" ? colors.canvas : "#F3EFE7";

  return (
    <View
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      style={{ flex: 1, backgroundColor: ground }}
      onLayout={(event) => {
        setWidth(event.nativeEvent.layout.width);
        setHeight(event.nativeEvent.layout.height);
      }}
      onTouchStart={(event) => {
        touch.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY, moved: false };
      }}
      onTouchMove={(event) => {
        const dx = event.nativeEvent.pageX - touch.current.x;
        const dy = event.nativeEvent.pageY - touch.current.y;
        if (Math.abs(dx) > 12 || Math.abs(dy) > 12) touch.current.moved = true;
      }}
      onTouchEnd={(event) => {
        const dx = event.nativeEvent.pageX - touch.current.x;
        const dy = event.nativeEvent.pageY - touch.current.y;
        const nextScope = scopeAfterSwipe(scope, dx, dy);
        if (nextScope !== scope) setScope(nextScope);
      }}
    >
      <View style={{ width: column || "100%", alignSelf: "center", flex: 1 }}>
        {view.kind === "error" ? (
          <View style={{ flex: 1, paddingHorizontal: 32, paddingTop: topInset + 72, alignItems: "center" }}>
            <Text style={{ color: colors.text, fontSize: 16, lineHeight: 24, textAlign: "center" }}>{view.message}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="重试" onPress={() => void load(scope)} style={{ marginTop: 16, minHeight: 44, justifyContent: "center" }}>
              <Text style={{ color: colors.accentInk, fontSize: 16, fontWeight: "700" }}>重试</Text>
            </Pressable>
          </View>
        ) : null}
        {view.kind === "loading" ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: colors.muted }}>正在打开</Text>
          </View>
        ) : null}
        {view.kind === "empty" ? (
          <View style={{ flex: 1, backgroundColor: "#F3EFE7", alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
            <QbotAvatar size={48} />
            <Text style={{ marginTop: 22, color: "#1C1B19", fontSize: 26, lineHeight: 34, fontWeight: "700", textAlign: "center" }}>{EMPTY_TITLE}</Text>
            <Text style={{ marginTop: 10, color: "#5C574E", fontSize: 15, lineHeight: 24, textAlign: "center" }}>{EMPTY_BODY}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={EMPTY_ACTION} onPress={() => setScope("recommended")} style={{ marginTop: 22, height: 44, paddingHorizontal: 22, borderRadius: 22, backgroundColor: "#1C1B19", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#F3EFE7", fontSize: 16, fontWeight: "700" }}>{EMPTY_ACTION}</Text>
            </Pressable>
          </View>
        ) : null}
        {(view.kind === "ready" || view.kind === "cached") && height > 0 ? (
          <FlatList
            ref={listRef}
            data={cards}
            keyExtractor={(card) => card.id}
            pagingEnabled
            decelerationRate="fast"
            snapToInterval={height || undefined}
            disableIntervalMomentum
            showsVerticalScrollIndicator={false}
            getItemLayout={(_, itemIndex) => ({ length: height, offset: height * itemIndex, index: itemIndex })}
            onMomentumScrollEnd={(event) => {
              const nextIndex = nextFeedPage(page.current, event.nativeEvent.contentOffset.y, height, cards.length);
              setIndex(nextIndex);
              if (nextIndex * height !== event.nativeEvent.contentOffset.y) {
                listRef.current?.scrollToIndex({ index: nextIndex, animated: true });
              }
            }}
            onEndReached={() => { if (next && phase === "ready") void load(scope, next); }}
            renderItem={({ item, index: itemIndex }) => {
              const tone = coverSurface(item.id);
              const itemInk = overlayInk(tone, scheme);
              return (
                <View style={{ height, backgroundColor: surfaceColor(tone, scheme) }}>
                  <Pressable accessibilityRole="button" accessibilityLabel={item.title} onPress={() => void open(item, itemIndex)} style={{ position: "absolute", top: frame.top, right: frame.right, bottom: frame.bottom, left: frame.left }}>
                    {covers[item.id] ? (
                      <Image source={{ uri: covers[item.id] }} resizeMode="contain" accessibilityElementsHidden style={{ width: "100%", height: "100%" }} />
                    ) : (
                      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                        {busy === item.id ? <ActivityIndicator color={itemInk} /> : <Text style={{ color: itemInk }}>封面没有载入</Text>}
                      </View>
                    )}
                  </Pressable>
                  <View style={{ position: "absolute", left: 16, right: 16, bottom: ACCOUNT_GAP, height: ACCOUNT_HEIGHT, flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: itemInk, overflow: "hidden" }}>
                      <QbotAvatar size={36} />
                    </View>
                    <Text style={{ color: itemInk, fontSize: 16, fontWeight: "700" }}>{item.bot.displayName}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={item.bot.followed ? "已关注" : "关注"} onPress={() => void toggle(item)} style={{ height: 26, paddingHorizontal: 11, borderRadius: 13, borderWidth: 1.5, borderColor: item.bot.followed ? (itemInk === "#EDE8DF" ? "rgba(237,232,223,0.28)" : "rgba(28,27,25,0.28)") : itemInk, justifyContent: "center" }}>
                      <Text style={{ color: itemInk, fontSize: 13, fontWeight: item.bot.followed ? "400" : "700" }}>{item.bot.followed ? "已关注" : "关注"}</Text>
                    </Pressable>
                    <Text style={{ marginLeft: "auto", color: itemInk, opacity: 0.7, fontSize: 12 }}>{formatPublished(item.publishedAt)}</Text>
                  </View>
                </View>
              );
            }}
          />
        ) : null}
        {view.kind === "cached" ? (
          <Text style={{ position: "absolute", top: topInset + SWITCH_GAP + SWITCH_HEIGHT, left: 0, right: 0, textAlign: "center", color: ink, fontSize: 12 }}>{view.message}</Text>
        ) : null}
        <View pointerEvents="box-none" style={{ position: "absolute", top: topInset + SWITCH_GAP, left: 0, right: 0, height: SWITCH_HEIGHT, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14 }}>
          {([
            ["following", "关注"],
            ["recommended", "推荐"],
          ] as const).map(([id, label], itemIndex) => {
            const selected = scope === id;
            return (
              <View key={id} style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                {itemIndex === 1 ? <Text style={{ color: ink, opacity: 0.4, fontSize: 17 }}>·</Text> : null}
                <Pressable accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={label} onPress={() => setScope(id)} style={{ minHeight: SWITCH_HEIGHT, justifyContent: "center" }}>
                  <Text style={{ color: selected ? ink : quiet, fontSize: 17, lineHeight: 36, fontWeight: selected ? "700" : "400" }}>{label}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      </View>
      {work ? (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
          <CardWork url={work.url} title={work.title} colors={colors} topInset={topInset} onClose={close} />
        </View>
      ) : null}
    </View>
  );
}

function merge(current: FeedCard[], pageCards: FeedCard[]): FeedCard[] {
  const seen = new Set(current.map((card) => card.id));
  return [...current, ...pageCards.filter((card) => !seen.has(card.id))];
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
