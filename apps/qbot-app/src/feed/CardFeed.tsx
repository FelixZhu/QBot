import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, ScrollView, Text, useColorScheme, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QbotAvatar } from "../QbotAvatar";
import { isSplit, listPaneWidth, palette, resolveScheme } from "../theme";
import { CardWork } from "./CardWork";
import { CoverFace, publishedFace } from "./CoverFace";
import {
  artifactUrl,
  createFeedClient,
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
  botLabel,
  clampPage,
  classifyFeedGesture,
  coverSurface,
  EMPTY_ACTION,
  EMPTY_BODY,
  EMPTY_TITLE,
  isDefaultBot,
  overlayInk,
  scopeAfterSwipe,
  selectCoverPrefetchIds,
  statusIcons,
  surfaceColor,
  SWITCH_GAP,
  SWITCH_HEIGHT,
  type StatusIcons,
} from "./immersive";

const CACHE = "qbot.feed.cache.v1";

type Work = { title: string; url: string; index: number };
type UndoToast = { botId: string; botName: string };

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
  const touchRef = useRef({ x: 0, y: 0 });
  const page = useRef(0);
  const loadedScopeRef = useRef<FeedScope | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const coversRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<Set<string>>(new Set());
  const coverEpochRef = useRef(0);
  const [work, setWork] = useState<Work | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [undoToast, setUndoToast] = useState<UndoToast | null>(null);
  const split = isSplit(width);
  const dirWidth = Math.min(320, Math.max(260, listPaneWidth(width) - 40));
  page.current = index;

  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, []);

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
      loadedScopeRef.current = nextScope;
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

  // Preserve current scope & card index across Tab switches.
  // Only reload when switching scope or on initial cold load.
  useEffect(() => {
    if (!active) return;
    if (loadedScopeRef.current === scope && cards.length > 0) return;
    coverEpochRef.current += 1;
    coversRef.current.clear();
    inFlightRef.current.clear();
    setCovers({});
    void load(scope);
  }, [active, cards.length, load, scope]);

  useEffect(() => {
    if (!origin || cards.length === 0) return;
    const toFetch = selectCoverPrefetchIds({
      cards,
      index,
      loaded: coversRef.current,
      inFlight: inFlightRef.current,
      hasLocalFace: (cardId) => publishedFace(cardId) !== null,
    });
    if (toFetch.length === 0) return;
    const epoch = coverEpochRef.current;
    const client = createFeedClient({ origin });
    const byId = new Map(cards.map((card) => [card.id, card]));
    for (const cardId of toFetch) {
      const card = byId.get(cardId);
      if (!card) continue;
      inFlightRef.current.add(cardId);
      void client.capability(cardId).then((capability) => {
        if (coverEpochRef.current !== epoch) return;
        coversRef.current.add(cardId);
        setCovers((current) => ({
          ...current,
          [cardId]: artifactUrl(origin, capability.artifactId, capability.version, capability.token, card.coverPath),
        }));
      }).catch(() => {}).finally(() => {
        if (coverEpochRef.current === epoch) inFlightRef.current.delete(cardId);
      });
    }
  }, [cards, index, origin]);

  const close = useCallback(() => {
    const restore = work?.index ?? page.current;
    setWork(null);
    onCover(false);
    const at = clampPage(restore, cards.length);
    console.log(`QBOT_NAV cover index=${at}`);
    requestAnimationFrame(() => listRef.current?.scrollToIndex({ index: at, animated: false }));
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
      onStatusStyle?.(scheme === "dark" ? "light" : "dark");
      return;
    }
    if (current.kind === "ready" || current.kind === "cached") {
      onStatusStyle?.(statusIcons(surface, scheme));
      return;
    }
    onStatusStyle?.(scheme === "dark" ? "light" : "dark");
  }, [cached, cards.length, message, onStatusStyle, phase, scheme, surface, work]);

  const open = async (card: FeedCard, at: number) => {
    if (!origin) return;
    setBusy(card.id);
    try {
      const capability = await createFeedClient({ origin }).capability(card.id);
      const pagePath = capability.files.find((file) => file.path === "index.html")?.path ?? "index.html";
      setWork({ title: card.title, url: artifactUrl(origin, capability.artifactId, capability.version, capability.token, pagePath), index: at });
      onCover(true);
      console.log(`QBOT_NAV work card=${card.id} index=${at}`);
    } catch (error) {
      setPhase("error");
      setMessage(error instanceof Error ? error.message : "无法连接服务器");
    } finally {
      setBusy(null);
    }
  };

  const toggleFollow = async (botId: string, botName: string, nextFollowed: boolean) => {
    if (!origin) return;
    setBusy(botId);
    try {
      const bot = await createFeedClient({ origin }).setFollow(botId, nextFollowed);
      setCards((current) => {
        const nextCards = applyFollow(current, bot.id, bot.followed, scope);
        setIndex((value) => clampPage(value, nextCards.length));
        return nextCards;
      });
      onFollowChange?.({ id: bot.id, slug: bot.slug, followed: bot.followed });
      if (!bot.followed) {
        setUndoToast({ botId: bot.id, botName });
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        undoTimerRef.current = setTimeout(() => setUndoToast(null), 3500);
      } else {
        setUndoToast(null);
        if (scope === "following") void load(scope);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法连接服务器");
    } finally {
      setBusy(null);
    }
  };

  const switchScope = (nextScope: FeedScope) => {
    if (nextScope === scope) return;
    loadedScopeRef.current = null;
    setScope(nextScope);
  };

  const jumpToCard = (targetIndex: number) => {
    const clamped = clampPage(targetIndex, cards.length);
    setIndex(clamped);
    listRef.current?.scrollToIndex({ index: clamped, animated: true });
  };

  const groups = useMemo(() => {
    const map = new Map<string, { botName: string; isDefault: boolean; items: { card: FeedCard; idx: number }[] }>();
    cards.forEach((card, idx) => {
      const key = card.bot.id;
      const existing = map.get(key);
      if (existing) {
        existing.items.push({ card, idx });
      } else {
        map.set(key, {
          botName: botLabel(card.bot),
          isDefault: isDefaultBot(card.bot),
          items: [{ card, idx }],
        });
      }
    });
    return Array.from(map.entries());
  }, [cards]);

  const view = presentFeed({ phase, count: cards.length, cached, message });
  const ink = overlayInk(view.kind === "empty" ? "paper" : surface, scheme);
  const quiet = scheme === "dark" ? "rgba(237,232,223,0.58)" : "rgba(28,27,25,0.58)";
  const ground = split
    ? colors.canvas
    : view.kind === "empty" || view.kind === "ready" || view.kind === "cached"
      ? surfaceColor(view.kind === "empty" ? "paper" : surface, scheme)
      : colors.canvas;

  const renderAttribution = (item: FeedCard, itemInk: string) => {
    const defaultBot = isDefaultBot(item.bot);
    const label = botLabel(item.bot);
    return (
      <View style={{ position: "absolute", left: 16, right: 16, bottom: ACCOUNT_GAP, height: ACCOUNT_HEIGHT, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ width: 34, height: 34, borderRadius: 17, overflow: "hidden" }}>
          <QbotAvatar size={36} />
        </View>
        <Text style={{ color: itemInk, fontSize: 15, lineHeight: 20, fontWeight: "700" }}>{label}</Text>
        {defaultBot ? (
          <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.selected }}>
            <Text style={{ color: colors.muted, fontSize: 11, lineHeight: 15, fontWeight: "700" }}>默认</Text>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.bot.followed ? `已关注 ${label}` : `关注 ${label}`}
            hitSlop={10}
            onPress={() => void toggleFollow(item.bot.id, label, !item.bot.followed)}
            style={({ pressed }) => ({
              height: 28,
              paddingHorizontal: 11,
              borderRadius: 14,
              borderWidth: 1.25,
              borderColor: item.bot.followed ? colors.line : itemInk,
              justifyContent: "center",
              opacity: pressed ? 0.65 : 1,
            })}
          >
            <Text style={{ color: item.bot.followed ? colors.text2 : itemInk, fontSize: 12, lineHeight: 16, fontWeight: item.bot.followed ? "400" : "700" }}>
              {item.bot.followed ? "已关注" : "关注"}
            </Text>
          </Pressable>
        )}
        <Text style={{ marginLeft: "auto", color: colors.muted, fontSize: 12, lineHeight: 16 }}>{formatPublished(item.publishedAt)}</Text>
      </View>
    );
  };

  const renderCardBody = (item: FeedCard, itemIndex: number, cardHeight: number, compact = false) => {
    const tone = coverSurface(item.id);
    const itemInk = overlayInk(tone, scheme);
    return (
      <View style={{ height: cardHeight, backgroundColor: surfaceColor(tone, scheme) }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.title}
          onPress={() => void open(item, itemIndex)}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
        >
          {publishedFace(item.id) ? (
            <CoverFace cardId={item.id} surface={tone} scheme={scheme} topInset={topInset} compact={compact} />
          ) : covers[item.id] ? (
            <Image source={{ uri: covers[item.id] }} resizeMode="cover" accessibilityElementsHidden style={{ width: "100%", height: "100%" }} />
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              {busy === item.id ? <ActivityIndicator color={itemInk} /> : <Text style={{ color: itemInk }}>封面没有载入</Text>}
            </View>
          )}
        </Pressable>
        {renderAttribution(item, itemInk)}
      </View>
    );
  };

  const renderFeedStates = () => (
    <>
      {view.kind === "error" ? (
        <View style={{ flex: 1, paddingHorizontal: 32, paddingTop: topInset + 72, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.text, fontSize: 16, lineHeight: 24, textAlign: "center" }}>{view.message}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="重试" onPress={() => void load(scope)} style={{ marginTop: 18, minHeight: 44, paddingHorizontal: 20, borderRadius: 999, backgroundColor: colors.btnPrimaryBg, justifyContent: "center" }}>
            <Text style={{ color: colors.btnPrimaryFg, fontSize: 15, fontWeight: "700" }}>重试</Text>
          </Pressable>
        </View>
      ) : null}
      {view.kind === "loading" ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.muted, fontSize: 14 }}>正在打开</Text>
        </View>
      ) : null}
      {view.kind === "empty" ? (
        <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
          <QbotAvatar size={48} />
          <Text style={{ marginTop: 20, color: colors.text, fontSize: 24, lineHeight: 32, fontWeight: "700", textAlign: "center" }}>{EMPTY_TITLE}</Text>
          <Text style={{ marginTop: 8, color: colors.text2, fontSize: 15, lineHeight: 24, textAlign: "center" }}>{EMPTY_BODY}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={EMPTY_ACTION} onPress={() => switchScope("recommended")} style={{ marginTop: 22, height: 44, paddingHorizontal: 22, borderRadius: 22, backgroundColor: colors.btnPrimaryBg, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: colors.btnPrimaryFg, fontSize: 15, fontWeight: "700" }}>{EMPTY_ACTION}</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );

  const stageCard = cards[index] ?? null;

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
        touchRef.current.x = event.nativeEvent.pageX;
        touchRef.current.y = event.nativeEvent.pageY;
      }}
      onTouchEnd={(event) => {
        if (work || split) return;
        const dx = event.nativeEvent.pageX - touchRef.current.x;
        const dy = event.nativeEvent.pageY - touchRef.current.y;
        if (classifyFeedGesture(dx, dy) === "horizontal") {
          switchScope(scopeAfterSwipe(scope, dx, dy));
        }
      }}
    >
      {split ? (
        <View style={{ flex: 1, flexDirection: "row", paddingTop: topInset }}>
          <View style={{ width: dirWidth, borderRightWidth: 1, borderRightColor: colors.line, backgroundColor: colors.canvas }}>
            <View style={{ height: 52, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 20, lineHeight: 28, fontWeight: "700", color: colors.text }}>今日</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                {([["following", "关注"], ["recommended", "推荐"]] as const).map(([id, label]) => {
                  const selected = scope === id;
                  return (
                    <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={label} hitSlop={8} onPress={() => switchScope(id)} style={{ minHeight: 36, justifyContent: "center" }}>
                      <Text style={{ fontSize: 14, lineHeight: 20, fontWeight: selected ? "700" : "400", color: selected ? colors.text : colors.muted }}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
              {groups.map(([botId, group]) => (
                <View key={botId}>
                  <Text style={{ fontSize: 12, lineHeight: 16, fontWeight: "700", color: colors.muted, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
                    {group.botName}{group.isDefault ? " · 默认" : ""}
                  </Text>
                  {group.items.map(({ card, idx }) => {
                    const selected = idx === index;
                    return (
                      <Pressable
                        key={card.id}
                        accessibilityRole="button"
                        accessibilityLabel={card.title}
                        onPress={() => jumpToCard(idx)}
                        style={({ pressed }) => ({
                          marginHorizontal: 10,
                          marginBottom: 4,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          borderRadius: 10,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 10,
                          backgroundColor: selected ? colors.selected : pressed ? colors.press : "transparent",
                          borderLeftWidth: selected ? 3 : 0,
                          borderLeftColor: colors.accent,
                        })}
                      >
                        <QbotAvatar size={28} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ fontSize: 14, lineHeight: 20, fontWeight: "700", color: colors.text }} numberOfLines={1}>{card.title}</Text>
                          <Text style={{ fontSize: 12, lineHeight: 16, color: colors.muted, marginTop: 2 }}>{formatPublished(card.publishedAt)}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </View>
          <View style={{ flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: colors.canvas }}>
            {view.kind === "ready" || view.kind === "cached" ? (
              stageCard ? (
                <View style={{ width: "100%", maxWidth: 420, flex: 1, maxHeight: 740, borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: colors.line }}>
                  {renderCardBody(stageCard, index, Math.min(740, Math.max(420, height - topInset - 40)), true)}
                </View>
              ) : null
            ) : renderFeedStates()}
          </View>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {renderFeedStates()}
          {(view.kind === "ready" || view.kind === "cached") && height > 0 ? (
            <FlatList
              ref={listRef}
              data={cards}
              keyExtractor={(card) => card.id}
              scrollEnabled
              pagingEnabled
              decelerationRate="fast"
              showsVerticalScrollIndicator={false}
              getItemLayout={(_, itemIndex) => ({ length: height, offset: height * itemIndex, index: itemIndex })}
              onMomentumScrollEnd={(event) => {
                const nextIndex = nextFeedPage(page.current, event.nativeEvent.contentOffset.y, height, cards.length);
                setIndex(nextIndex);
              }}
              onEndReached={() => { if (next && phase === "ready") void load(scope, next); }}
              renderItem={({ item, index: itemIndex }) => renderCardBody(item, itemIndex, height)}
            />
          ) : null}
          {(view.kind === "ready" || view.kind === "cached") && cards.length > 1 ? (
            <View pointerEvents="none" style={{ position: "absolute", right: 7, top: "45%", gap: 5, alignItems: "center" }}>
              {cards.slice(0, 8).map((card, dotIdx) => (
                <View
                  key={card.id}
                  style={{
                    width: 4,
                    height: dotIdx === index ? 16 : 4,
                    borderRadius: 2,
                    backgroundColor: ink,
                    opacity: dotIdx === index ? 0.85 : 0.25,
                  }}
                />
              ))}
            </View>
          ) : null}
          {view.kind === "cached" ? (
            <Text style={{ position: "absolute", top: topInset + SWITCH_GAP + SWITCH_HEIGHT + 2, left: 0, right: 0, textAlign: "center", color: ink, fontSize: 12 }}>{view.message}</Text>
          ) : null}
          <View pointerEvents="box-none" style={{ position: "absolute", top: topInset + SWITCH_GAP, left: 0, right: 0, height: SWITCH_HEIGHT, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16 }}>
            {([
              ["following", "关注"],
              ["recommended", "推荐"],
            ] as const).map(([id, label], itemIndex) => {
              const selected = scope === id;
              return (
                <View key={id} style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
                  {itemIndex === 1 ? <Text style={{ color: ink, opacity: 0.35, fontSize: 16 }}>·</Text> : null}
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    accessibilityLabel={label}
                    hitSlop={8}
                    onPress={() => switchScope(id)}
                    style={{ minHeight: SWITCH_HEIGHT, justifyContent: "center", alignItems: "center" }}
                  >
                    <Text style={{ color: selected ? ink : quiet, fontSize: 16, lineHeight: 24, fontWeight: selected ? "700" : "400" }}>{label}</Text>
                    <View style={{ marginTop: 2, width: 16, height: 2.5, borderRadius: 2, backgroundColor: selected ? ink : "transparent" }} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
      )}
      {undoToast ? (
        <View style={{ position: "absolute", left: 16, right: 16, bottom: ACCOUNT_GAP + ACCOUNT_HEIGHT + 12, borderRadius: 12, backgroundColor: colors.btnPrimaryBg, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: colors.btnPrimaryFg, fontSize: 14, lineHeight: 20 }}>已取消关注 {undoToast.botName}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="撤销取消关注"
            hitSlop={10}
            onPress={() => void toggleFollow(undoToast.botId, undoToast.botName, true)}
          >
            <Text style={{ color: colors.accent, fontSize: 14, lineHeight: 20, fontWeight: "700" }}>撤销</Text>
          </Pressable>
        </View>
      ) : null}
      {work ? (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
          <CardWork url={work.url} title={work.title} colors={colors} scheme={scheme} topInset={topInset} onClose={close} />
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
