import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  FlatList,
  Modal,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FeedCard } from "./FeedCard";
import { ImmersivePage, type ImmersiveMode } from "./ImmersivePage";
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

export function LessonFeed({
  active,
  onBackReady,
  onCover,
}: {
  active: boolean;
  onBackReady: (back: () => boolean) => void;
  onCover: (covered: boolean) => void;
}) {
  const listRef = useRef<FlatList<Lesson>>(null);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const indexRef = useRef(0);
  const anchor = useRef(0);
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const [height, setHeight] = useState(0);
  const [index, setIndex] = useState(0);
  const [memory, setMemory] = useState<FeedMemory>(EMPTY_FEED_MEMORY);
  const [hydrated, setHydrated] = useState(false);
  const [followed, setFollowed] = useState(false);
  const [scrollable, setScrollable] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<ImmersiveMode>("article");
  const [origin, setOrigin] = useState<Rect>(EMPTY_RECT);
  const lesson = openId ? lessonById(openId) : null;
  const screen = Dimensions.get("screen");

  useEffect(() => {
    let alive = true;
    readFeedMemory(AsyncStorage, LESSON_IDS).then((next) => {
      if (!alive) return;
      setMemory(next);
      setHydrated(true);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const snapshot = memory;
    writes.current = enqueueFeedWrite(writes.current, () => writeFeedMemory(AsyncStorage, snapshot, LESSON_IDS));
  }, [hydrated, memory]);

  useEffect(() => {
    if (!hydrated) return;
    const id = LESSONS[index]?.id;
    if (!id) return;
    setMemory((prev) => rememberRead(prev, id));
  }, [hydrated, index]);

  const settle = useCallback((next: number) => {
    if (height <= 0) return;
    const clamped = Math.max(0, Math.min(LESSONS.length - 1, next));
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

  const close = useCallback(() => {
    if (!openId || closing.current) return false;
    closing.current = true;
    onCover(false);
    Animated.timing(progress, { toValue: 0, duration: 300, useNativeDriver: false }).start(({ finished }) => {
      if (finished) finishClose();
      else closing.current = false;
    });
    return true;
  }, [finishClose, onCover, openId, progress]);

  const back = useCallback(() => {
    if (openId) return close();
    if (indexRef.current > 0) {
      settle(0);
      return true;
    }
    return false;
  }, [close, openId, settle]);

  useEffect(() => { onBackReady(back); }, [back, onBackReady]);

  useEffect(() => {
    if (active || !openId) return;
    progress.setValue(0);
    finishClose();
  }, [active, finishClose, openId, progress]);

  useEffect(() => {
    if (!openId) return;
    progress.setValue(0);
    const animation = Animated.timing(progress, { toValue: 1, duration: 300, useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [openId, progress]);

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
    <View style={{ flex: 1, backgroundColor: BG }} onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
      {height > 0 ? (
        <FlatList
          ref={listRef}
          data={LESSONS}
          keyExtractor={(item) => item.id}
          pagingEnabled
          directionalLockEnabled
          showsVerticalScrollIndicator={false}
          scrollEnabled={scrollable && !openId}
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
            const next = nextFeedPage(anchor.current, event.nativeEvent.contentOffset.y, height, LESSONS.length);
            settle(next);
          }}
          onMomentumScrollEnd={(event) => {
            const target = indexRef.current * height;
            if (Math.abs(event.nativeEvent.contentOffset.y - target) > height * 0.2) {
              listRef.current?.scrollToOffset({ offset: target, animated: false });
            }
          }}
          renderItem={({ item, index: itemIndex }) => (
            <FeedCard
              lesson={item}
              height={height}
              active={active && itemIndex === index && !openId}
              followed={followed}
              onFollow={() => setFollowed((value) => !value)}
              onOpen={(node) => openFrom(item.id, node)}
            />
          )}
        />
      ) : null}
      <Modal visible={lesson !== null} transparent animationType="none" statusBarTranslucent onRequestClose={() => { close(); }} navigationBarTranslucent>
        <View style={{ flex: 1 }} pointerEvents="box-none">
          {lesson ? (
            <Animated.View style={{ position: "absolute", overflow: "hidden", left: frame.left, top: frame.top, width: frame.width, height: frame.height, borderRadius: frame.radius, backgroundColor: BG }}>
              <ImmersivePage
                lesson={lesson}
                mode={lesson.day === 1 ? mode : modeFor(lesson)}
                onMode={setMode}
                onClose={() => { close(); }}
                onDismiss={() => setMemory((prev) => dismissCard(prev, lesson.id))}
              />
            </Animated.View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}
