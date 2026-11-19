import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { listPaneWidth, type Palette } from "../theme";
import { FEED } from "./cards";
import {
  EMPTY_FEED_MEMORY,
  arrangeFeed,
  dismissCard,
  enqueueFeedWrite,
  readFeedMemory,
  rememberInterest,
  rememberRead,
  undoDismiss,
  writeFeedMemory,
  type FeedMemory,
} from "./memory";
import type { FeedCard, FrameId } from "./model";

const FEED_IDS = FEED.map((card) => card.id);

const FRAMES: Record<FrameId, number> = {
  meadow: require("../../assets/feed/meadow.png"),
  island: require("../../assets/feed/island.png"),
  crystal: require("../../assets/feed/crystal.png"),
  film: require("../../assets/feed/film.png"),
};

const FILM = require("../../assets/feed/demo-film.mp4");

function Frame({ id, height }: { id: FrameId; height: number }) {
  return <Image source={FRAMES[id]} style={{ width: "100%", height }} contentFit="cover" accessibilityIgnoresInvertColors />;
}

function Gallery({ frames, height }: { frames: FrameId[]; height: number }) {
  const [page, setPage] = useState(0);
  const [width, setWidth] = useState(0);
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <FlatList
        data={frames}
        horizontal
        pagingEnabled
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item, index) => `${item}-${index}`}
        onMomentumScrollEnd={(event) => {
          const pageWidth = event.nativeEvent.layoutMeasurement.width || 1;
          setPage(Math.round(event.nativeEvent.contentOffset.x / pageWidth));
        }}
        renderItem={({ item }) => (
          <View style={{ width: width || 1 }}>
            <Frame id={item} height={height} />
          </View>
        )}
      />
      <View style={{ position: "absolute", right: 10, bottom: 10, backgroundColor: "rgba(28,27,25,0.72)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
        <Text style={{ color: "#FAF9F6", fontSize: 12 }}>{page + 1}/{frames.length}</Text>
      </View>
    </View>
  );
}

function Film({ active, height }: { active: boolean; height: number }) {
  const player = useVideoPlayer(FILM, (p) => {
    p.loop = true;
    p.pause();
  });
  useEffect(() => {
    if (!active) player.pause();
  }, [active, player]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={active && player.playing ? "暂停演示短片" : "播放演示短片"}
      onPress={() => { if (player.playing) player.pause(); else player.play(); }}
    >
      <VideoView player={player} nativeControls={false} contentFit="cover" style={{ width: "100%", height }} />
      <View style={{ position: "absolute", left: 12, bottom: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(250,249,246,0.92)", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#1C1B19", fontWeight: "700" }}>{player.playing ? "Ⅱ" : "▶"}</Text>
      </View>
    </Pressable>
  );
}

function CardFace({ card, colors, active, read, onOpen }: { card: FeedCard; colors: Palette; active: boolean; read: boolean; onOpen: () => void }) {
  const dark = card.type === "invite";
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${card.source.name}，${card.title}，虚构演示${read ? "，已读" : ""}`}
      style={({ pressed }) => ({
        marginHorizontal: 16,
        marginBottom: 16,
        borderRadius: 18,
        overflow: "hidden",
        backgroundColor: dark ? "#1C1B19" : colors.raised,
        borderWidth: dark ? 0 : 1,
        borderColor: colors.line,
        opacity: pressed ? 0.92 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingTop: 12, gap: 8 }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: dark ? "#3E8F62" : colors.press }} />
        <Text style={{ flex: 1, color: dark ? "#FAF9F6" : colors.text, fontSize: 13 }} numberOfLines={1}>
          {card.source.name} · {card.kicker}
        </Text>
        {read ? <Text style={{ color: dark ? "#C8C2B8" : colors.muted, fontSize: 12 }}>已读</Text> : null}
        <Text style={{ color: colors.accent, fontSize: 12, fontWeight: "700" }}>演示</Text>
      </View>
      {card.type === "gallery" ? <View style={{ marginTop: 10 }}><Gallery frames={card.frames} height={190} /></View> : null}
      {card.type === "invite" ? <View style={{ marginTop: 10, marginHorizontal: 12, borderRadius: 14, overflow: "hidden" }}><Frame id={card.frame} height={150} /></View> : null}
      {card.type === "film" ? <View style={{ marginTop: 10 }}><Film active={active} height={180} /></View> : null}
      <View style={{ padding: 14 }}>
        <Text style={{ color: dark ? "#FAF9F6" : card.type === "gallery" ? colors.accent : colors.text, fontSize: card.type === "invite" ? 20 : 16, lineHeight: 26, fontWeight: "700" }}>
          {card.type === "invite" ? card.gameTitle : card.title}
        </Text>
        <Text style={{ marginTop: 4, color: dark ? "#C8C2B8" : colors.muted, fontSize: 13, lineHeight: 18 }}>{card.note}</Text>
        {card.type === "film" ? <Text style={{ marginTop: 6, color: colors.muted, fontSize: 12 }}>{card.durationLabel}</Text> : null}
      </View>
    </Pressable>
  );
}

function Detail({
  card,
  colors,
  onClose,
  onInterest,
  interested,
  onDismiss,
}: {
  card: FeedCard;
  colors: Palette;
  onClose: () => void;
  onInterest: () => void;
  interested: boolean;
  onDismiss: () => void;
}) {
  const [pieces, setPieces] = useState(0);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ height: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 8 }}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="返回信息流" hitSlop={8} style={({ pressed }) => ({ width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: pressed ? colors.press : "transparent" })}>
          <Text style={{ fontSize: 28, lineHeight: 32, color: colors.text }}>‹</Text>
        </Pressable>
        <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>{card.source.name}</Text>
      </View>
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <Text style={{ color: colors.accent, fontSize: 13 }}>{card.kicker} · 虚构</Text>
        <Text style={{ marginTop: 8, fontSize: 28, lineHeight: 36, fontWeight: "700", color: colors.text }}>{card.title}</Text>
        <Text style={{ marginTop: 8, fontSize: 15, lineHeight: 22, color: colors.muted }}>{card.note}</Text>
      </View>
      {card.type === "gallery" ? <Gallery frames={card.frames} height={220} /> : <Frame id={card.type === "invite" ? card.frame : "film"} height={220} />}
      {card.type === "invite" ? (
        <View style={{ padding: 20, gap: 10 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: "600" }}>
            {pieces === 0 ? "点一下，放上一块演示积木。" : `已放下 ${pieces} 块。没有联机，也没有发出邀请。`}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {["草地", "树", "小屋"].map((label, index) => (
              <Pressable key={label} onPress={() => setPieces(index + 1)} style={({ pressed }) => ({ flex: 1, minHeight: 64, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: pieces === index + 1 ? "#6FA37A" : colors.raised, borderWidth: 1, borderColor: colors.line, opacity: pressed ? 0.8 : 1 })}>
                <Text style={{ color: colors.text, fontWeight: "600" }}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => setPieces((count) => Math.max(count, 1))} style={({ pressed }) => ({ minHeight: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? "#E58A5E" : colors.accent })}>
            <Text style={{ color: "#FAF9F6", fontWeight: "700" }}>一起玩</Text>
          </Pressable>
          <Pressable onPress={onClose} style={({ pressed }) => ({ minHeight: 44, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ color: colors.muted }}>稍后再说</Text>
          </Pressable>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Pressable onPress={onInterest} accessibilityRole="button"><Text style={{ color: colors.text }}>{interested ? "已感兴趣" : "收藏"}</Text></Pressable>
            <Pressable onPress={onDismiss} accessibilityRole="button"><Text style={{ color: colors.muted }}>不感兴趣</Text></Pressable>
          </View>
        </View>
      ) : (
        <Text style={{ padding: 20, color: colors.muted, fontSize: 13 }}>{card.type === "film" ? "播放钮在卡片上。离开这个标签或滑出屏幕会暂停。" : card.caption}</Text>
      )}
    </View>
  );
}

export function FeedPane({
  colors,
  split,
  active,
  onBackReady,
}: {
  colors: Palette;
  split: boolean;
  active: boolean;
  onBackReady: (back: () => boolean) => void;
}) {
  const { width } = useWindowDimensions();
  const [selected, setSelected] = useState<string | null>(null);
  const [memory, setMemory] = useState<FeedMemory>(EMPTY_FEED_MEMORY);
  const [hydrated, setHydrated] = useState(false);
  const [visible, setVisible] = useState<string[]>([]);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const onViewable = useRef(({ viewableItems }: { viewableItems: { key: string }[] }) => {
    setVisible(viewableItems.map((item) => String(item.key)));
  });
  const cards = hydrated ? arrangeFeed(FEED, memory) : [];
  const current = cards.find((card) => card.id === selected) ?? null;

  useEffect(() => {
    let alive = true;
    readFeedMemory(AsyncStorage, FEED_IDS).then((next) => {
      if (!alive) return;
      setMemory(next);
      setHydrated(true);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const snapshot = memory;
    writes.current = enqueueFeedWrite(writes.current, () => writeFeedMemory(AsyncStorage, snapshot, FEED_IDS));
  }, [hydrated, memory]);

  const back = useCallback(() => {
    if (!selected) return false;
    setSelected(null);
    return true;
  }, [selected]);

  useEffect(() => { onBackReady(back); }, [back, onBackReady]);

  const list = (
    <FlatList
      data={cards}
      keyExtractor={(item) => item.id}
      extraData={visible}
      viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
      onViewableItemsChanged={onViewable.current}
      ListHeaderComponent={
        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>设计演示</Text>
            </View>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>主动服务</Text>
          </View>
          <Text style={{ marginTop: 18, fontSize: 14, color: colors.muted }}>由 Agent 为你连接</Text>
          <Text style={{ marginTop: 6, fontSize: 34, lineHeight: 42, fontWeight: "700", color: colors.accent }}>世界很大，{"\n"}与你有关</Text>
          {memory.dismissed.length > 0 ? (
            <Pressable
              onPress={() => setMemory((prev) => undoDismiss(prev))}
              accessibilityRole="button"
              accessibilityLabel="撤销不感兴趣"
              style={({ pressed }) => ({ alignSelf: "flex-start", marginTop: 12, minHeight: 44, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={{ color: colors.muted, fontSize: 13 }}>已收起 {memory.dismissed.length} 条不感兴趣 · 撤销</Text>
            </Pressable>
          ) : null}
        </View>
      }
      ListFooterComponent={<Text style={{ textAlign: "center", color: colors.muted, fontSize: 12, padding: 16 }}>人物与内容均为虚构 · 没有真实邀请</Text>}
      renderItem={({ item }) => (
        <CardFace
          card={item}
          colors={colors}
          active={active && visible.includes(item.id) && (!selected || split)}
          read={memory.read.includes(item.id)}
          onOpen={() => {
            setSelected(item.id);
            setMemory((prev) => rememberRead(prev, item.id));
          }}
        />
      )}
    />
  );

  const detail = current ? (
    <Detail
      card={current}
      colors={colors}
      onClose={() => setSelected(null)}
      interested={memory.interest.includes(current.id)}
      onInterest={() => setMemory((prev) => rememberInterest(prev, current.id))}
      onDismiss={() => {
        setMemory((prev) => dismissCard(prev, current.id));
        setSelected(null);
      }}
    />
  ) : (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text style={{ color: colors.muted, textAlign: "center" }}>左边选一条。打开后的位置会留在列表里。</Text>
    </View>
  );

  if (split) {
    return (
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: colors.bg }}>
        <View style={{ width: listPaneWidth(width), borderRightWidth: 1, borderRightColor: colors.line }}>{list}</View>
        <View style={{ flex: 1, minWidth: 0 }}>{detail}</View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: selected ? 0 : 1, display: selected ? "none" : "flex" }}>{list}</View>
      {selected ? <View style={{ flex: 1 }}>{detail}</View> : null}
    </View>
  );
}
