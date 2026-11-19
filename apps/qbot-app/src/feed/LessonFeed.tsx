import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Dimensions,
  FlatList,
  Modal,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { gutterColor, isSplit, PHONE_CARD_HEIGHT, PHONE_CARD_WIDTH, phoneFrame } from "../theme";
import { FeedCard, lessonSurface } from "./FeedCard";
import { ImmersivePage, type ImmersiveMode } from "./ImmersivePage";
import { DemoCard } from "./demo/DemoCard";
import { DemoAccount, DemoImmersive } from "./demo/DemoPages";
import { DEMO_IDS, demoById, demoSurface, type DemoId } from "./demo/data";
import { LESSONS, LESSON_IDS, lessonById, type Lesson } from "./lessons";
import {
  EMPTY_FEED_MEMORY,
  dismissCard,
  enqueueFeedWrite,
  readFeedMemory,
  rememberRead,
  writeFeedMemory,
  type FeedMemory,
} from "./memory";
import { nextFeedPage } from "./paging";
import { BG, type Measurable } from "./chrome";

type Rect = { x: number; y: number; w: number; h: number };

const EMPTY_RECT: Rect = { x: 0, y: 0, w: 1, h: 1 };

function modeFor(lesson: Lesson): ImmersiveMode {
  return lesson.kind === "video" ? "video" : "article";
}

type FeedRow = { key: string; lesson?: Lesson; demo?: DemoId };

const ROWS: FeedRow[] = [
  ...LESSONS.map((lesson) => ({ key: lesson.id, lesson })),
  ...DEMO_IDS.map((id) => ({ key: id, demo: id })),
];

const KNOWN_IDS = [...LESSON_IDS, ...DEMO_IDS];

function rowSurface(row: FeedRow | undefined): string {
  if (row?.lesson) return lessonSurface(row.lesson.kind);
  if (row?.demo) return demoSurface(row.demo);
  return BG;
}

/** 390×844 card, scaled to the feed height and centered. Gutters stay empty. */
function WideCard({
  width,
  height,
  gutter,
  children,
}: {
  width: number;
  height: number;
  gutter: string;
  children: ReactNode;
}) {
  const frame = phoneFrame(width, height);
  const scale = frame.width > 0 ? frame.width / PHONE_CARD_WIDTH : 1;
  return (
    <View style={{ width, height, backgroundColor: gutter, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: frame.width, height: frame.height, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: PHONE_CARD_WIDTH, height: PHONE_CARD_HEIGHT, transform: [{ scale }] }}>
          {children}
        </View>
      </View>
    </View>
  );
}

export function LessonFeed({
  active,
  onBackReady,
  onCover,
}: {
  active: boolean;
  onBackReady: (back: () => boolean) => void;
  onCover: (covered: boolean) => void;
}) {
  const listRef = useRef<FlatList<FeedRow>>(null);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const indexRef = useRef(0);
  const anchor = useRef(0);
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const height = box.h;
  const wide = isSplit(box.w);
  const [index, setIndex] = useState(0);
  const [memory, setMemory] = useState<FeedMemory>(EMPTY_FEED_MEMORY);
  const [hydrated, setHydrated] = useState(false);
  const [followed, setFollowed] = useState(false);
  const [scrollable, setScrollable] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [demoId, setDemoId] = useState<DemoId | null>(null);
  const [demoPage, setDemoPage] = useState<"immersive" | "account">("immersive");
  const [demoParent, setDemoParent] = useState<"feed" | "immersive">("feed");
  const [demoFollow, setDemoFollow] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState("");
  const [mode, setMode] = useState<ImmersiveMode>("article");
  const [origin, setOrigin] = useState<Rect>(EMPTY_RECT);
  const lesson = openId ? lessonById(openId) : null;
  const screen = Dimensions.get("screen");
  const windowSize = useWindowDimensions();

  useEffect(() => {
    let alive = true;
    readFeedMemory(AsyncStorage, KNOWN_IDS).then((next) => {
      if (!alive) return;
      setMemory(next);
      setHydrated(true);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const snapshot = memory;
    writes.current = enqueueFeedWrite(writes.current, () => writeFeedMemory(AsyncStorage, snapshot, KNOWN_IDS));
  }, [hydrated, memory]);

  useEffect(() => {
    if (!hydrated) return;
    const row = ROWS[index];
    const id = row?.lesson?.id ?? row?.demo;
    if (!id) return;
    setMemory((prev) => rememberRead(prev, id));
  }, [hydrated, index]);

  const settle = useCallback((next: number) => {
    if (height <= 0) return;
    const clamped = Math.max(0, Math.min(ROWS.length - 1, next));
    indexRef.current = clamped;
    anchor.current = clamped;
    setIndex(clamped);
    setScrollable(false);
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: clamped * height, animated: true });
      setTimeout(() => setScrollable(true), 340);
    });
  }, [height]);

  const finishClose = useCallback(() => {
    closing.current = false;
    setOpenId(null);
    onCover(false);
  }, [onCover]);

  const covered = Boolean(openId || demoId);

  const close = useCallback(() => {
    if ((!openId && !demoId) || closing.current) return false;
    closing.current = true;
    onCover(false);
    Animated.timing(progress, { toValue: 0, duration: 300, useNativeDriver: false }).start(({ finished }) => {
      if (finished) {
        setDemoId(null);
        finishClose();
      } else closing.current = false;
    });
    return true;
  }, [demoId, finishClose, onCover, openId, progress]);

  const back = useCallback(() => {
    if (demoId && demoPage === "account" && demoParent === "immersive") {
      setDemoPage("immersive");
      return true;
    }
    if (openId || demoId) return close();
    if (indexRef.current > 0) {
      settle(0);
      return true;
    }
    return false;
  }, [close, demoId, demoPage, demoParent, openId, settle]);

  useEffect(() => { onBackReady(back); }, [back, onBackReady]);

  useEffect(() => {
    if (active || (!openId && !demoId)) return;
    progress.setValue(0);
    finishClose();
  }, [active, demoId, finishClose, openId, progress]);

  useEffect(() => {
    if (!openId && !demoId) return;
    progress.setValue(0);
    const animation = Animated.timing(progress, { toValue: 1, duration: 300, useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [demoId, openId, progress]);

  const openFrom = (id: string, node: Measurable | null) => {
    const begin = (rect: Rect) => {
      setOrigin(rect);
      setMode(modeFor(lessonById(id)));
      setOpenId(id);
      onCover(true);
    };
    if (!node) {
      begin({ x: 0, y: 0, w: screen.width, h: screen.height });
      return;
    }
    node.measureInWindow((x, y, w, h) => begin({ x, y, w: w || screen.width, h: h || height || screen.height }));
  };

  const frame = {
    left: progress.interpolate({ inputRange: [0, 1], outputRange: [origin.x, 0] }),
    top: progress.interpolate({ inputRange: [0, 1], outputRange: [origin.y, 0] }),
    width: progress.interpolate({ inputRange: [0, 1], outputRange: [Math.max(origin.w, 1), screen.width] }),
    height: progress.interpolate({ inputRange: [0, 1], outputRange: [Math.max(origin.h, 1), screen.height] }),
    radius: progress.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }),
  };

  return (
    <View
      style={{ flex: 1, backgroundColor: wide ? gutterColor(rowSurface(ROWS[index])) : BG }}
      onLayout={(event) => {
        const { width, height: nextHeight } = event.nativeEvent.layout;
        setBox((prev) => (prev.w === width && prev.h === nextHeight ? prev : { w: width, h: nextHeight }));
      }}
    >
      {height > 0 ? (
        <FlatList
          ref={listRef}
          data={ROWS}
          keyExtractor={(item) => item.key}
          pagingEnabled
          removeClippedSubviews={wide ? false : undefined}
          directionalLockEnabled
          showsVerticalScrollIndicator={false}
          scrollEnabled={scrollable && !covered}
          decelerationRate="fast"
          snapToInterval={height}
          snapToAlignment="start"
          disableIntervalMomentum
          bounces={false}
          overScrollMode="never"
          windowSize={3}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          getItemLayout={(_, itemIndex) => ({ length: height, offset: height * itemIndex, index: itemIndex })}
          onScrollBeginDrag={() => { anchor.current = indexRef.current; }}
          onScrollEndDrag={(event) => {
            const next = nextFeedPage(anchor.current, event.nativeEvent.contentOffset.y, height, ROWS.length);
            settle(next);
          }}
          onMomentumScrollEnd={(event) => {
            const target = indexRef.current * height;
            if (Math.abs(event.nativeEvent.contentOffset.y - target) > height * 0.2) {
              listRef.current?.scrollToOffset({ offset: target, animated: false });
            }
          }}
          extraData={wide ? `${box.w}x${height}:${index}` : index}
          renderItem={({ item, index: itemIndex }) => {
            const cardHeight = wide ? PHONE_CARD_HEIGHT : height;
            const card = item.lesson ? (
              <FeedCard
                lesson={item.lesson}
                height={cardHeight}
                active={active && itemIndex === index && !covered}
                followed={followed}
                onFollow={() => setFollowed((value) => !value)}
                onOpen={(node) => openFrom(item.lesson?.id ?? "", node)}
              />
            ) : (
              <DemoCard
                id={item.demo ?? "demo-info"}
                height={cardHeight}
                followed={Boolean(demoFollow[item.demo ?? ""])}
                onFollow={() => {
                  const id = item.demo ?? "";
                  setDemoFollow((prev) => ({ ...prev, [id]: !prev[id] }));
                }}
                onOpen={(node) => {
                  const id = demoById(item.demo ?? "");
                  if (!id) return;
                  setDemoPage("immersive");
                  setDemoParent("feed");
                  openFrom(id, node);
                  setDemoId(id);
                  setOpenId(null);
                }}
                onAccount={() => {
                  const id = demoById(item.demo ?? "");
                  if (!id) return;
                  setOrigin({ x: 0, y: 0, w: screen.width, h: screen.height });
                  setDemoPage("account");
                  setDemoParent("feed");
                  setDemoId(id);
                  setOpenId(null);
                  onCover(true);
                }}
              />
            );
            if (!wide) return card;
            return (
              <WideCard width={box.w} height={height} gutter={gutterColor(rowSurface(item))}>
                {card}
              </WideCard>
            );
          }}
        />
      ) : null}
      <Modal visible={lesson !== null || demoId !== null} transparent animationType="none" statusBarTranslucent onRequestClose={() => { back(); }} navigationBarTranslucent>
        <View style={{ flex: 1 }} pointerEvents="box-none">
          {lesson || demoId ? (
            <Animated.View style={{ position: "absolute", overflow: "hidden", left: frame.left, top: frame.top, width: frame.width, height: frame.height, borderRadius: frame.radius, backgroundColor: wide && demoId ? gutterColor(demoSurface(demoId)) : BG }}>
              {lesson ? (
                <ImmersivePage
                  lesson={lesson}
                  mode={lesson.day === 1 ? mode : modeFor(lesson)}
                  onMode={setMode}
                  onClose={() => { close(); }}
                  onDismiss={() => setMemory((prev) => dismissCard(prev, lesson.id))}
                />
              ) : null}
              {demoId ? (
                wide ? (
                  <WideCard width={windowSize.width} height={windowSize.height} gutter={gutterColor(demoSurface(demoId))}>
                    {demoPage === "account" ? (
                      <DemoAccount
                        id={demoId}
                        followed={Boolean(demoFollow[demoId])}
                        onFollow={() => setDemoFollow((prev) => ({ ...prev, [demoId]: !prev[demoId] }))}
                        onBack={() => { back(); }}
                      />
                    ) : (
                      <DemoImmersive
                        id={demoId}
                        onBack={() => { close(); }}
                        onAccount={() => { setDemoParent("immersive"); setDemoPage("account"); }}
                        onSample={(message) => setToast(message)}
                      />
                    )}
                  </WideCard>
                ) : demoPage === "account" ? (
                  <DemoAccount
                    id={demoId}
                    followed={Boolean(demoFollow[demoId])}
                    onFollow={() => setDemoFollow((prev) => ({ ...prev, [demoId]: !prev[demoId] }))}
                    onBack={() => { back(); }}
                  />
                ) : (
                  <DemoImmersive
                    id={demoId}
                    onBack={() => { close(); }}
                    onAccount={() => { setDemoParent("immersive"); setDemoPage("account"); }}
                    onSample={(message) => setToast(message)}
                  />
                )
              ) : null}
              {toast ? (
                <View pointerEvents="none" style={{ position: "absolute", left: 20, right: 20, bottom: 40, alignItems: "center" }}>
                  <Text style={{ color: "#F3EFE7", backgroundColor: "rgba(0,0,0,0.82)", overflow: "hidden", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}>{toast}</Text>
                </View>
              ) : null}
            </Animated.View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}
