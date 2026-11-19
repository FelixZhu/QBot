import { useEffect, useRef, useState, type ReactNode } from "react";
import { PanResponder, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LOOP_NODE_4, type Lesson, type LessonAsk } from "./lessons";
import {
  GAME_CHIPS,
  GAME_FIXED,
  checkBoard,
  chipLabel,
  initialBoard,
  placeOnBoard,
  placedCount,
  returnChip,
  type GameBoard,
} from "./game";
import { AM, BG, CREAM, DIM, GridLines, INK, MONO, Title, accountLine, asMeasurable, plainTitle, type Measurable } from "./chrome";

export type ImmersiveMode = "article" | "video" | "game";

const MODE_LABEL: Record<ImmersiveMode, string> = { article: "图文", video: "视频", game: "小游戏" };

type Chapter = { label: string; at: number; line: string };

const LESSON_ONE_VIDEO = {
  kicker: "EP.01 · 3:20",
  headline: "一次\n",
  accent: "想→做→看",
  tail: "\n循环",
  duration: 200,
  start: 62,
  chapters: [
    { label: "01 大脑", at: 0, line: "模型说：「我要查一下天气。」" },
    { label: "02 眼睛", at: 62, line: "上下文里多了这一次工具调用。" },
    { label: "03 手脚", at: 130, line: "工具把结果交回来，循环再走一圈。" },
  ] as Chapter[],
};

const LOOP_STEPS = [
  {
    node: 0,
    body: "大脑是 LLM，决定下一步做什么。窗口里还只有固定前缀和用户消息。",
    rows: [
      ["系统提示", "plain"],
      ["工具定义", "plain"],
      ["用户消息", "plain"],
      ["模型思考 · 这一步出现", "hot"],
      ["工具结果 · 还没有", "ghost"],
    ],
  },
  {
    node: 1,
    body: "模型只决定调哪个工具、传什么参数；真正执行的是 Harness。",
    rows: [
      ["系统提示", "plain"],
      ["工具定义", "plain"],
      ["用户消息", "plain"],
      ["模型思考 + 工具调用", "hot"],
      ["工具结果 · 下一步出现", "ghost"],
    ],
  },
  {
    node: 3,
    body: "眼睛看到这一次做成没有。拿掉「工具返回结果」，就只能盲目重复。",
    rows: [
      ["系统提示", "plain"],
      ["工具定义", "plain"],
      ["用户消息", "plain"],
      ["模型思考 + 工具调用", "mid"],
      ["工具结果", "hot"],
    ],
  },
  {
    node: 2,
    body: `结果写回窗口，下一轮还能看见。每轮都重发整个消息列表，窗口会变长。`,
    rows: [
      ["系统提示", "plain"],
      ["工具定义", "plain"],
      ["用户消息", "plain"],
      ["模型思考 + 工具调用", "mid"],
      ["工具结果", "hot"],
    ],
  },
] as const;

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function TopBar({
  title,
  subtitle,
  onClose,
  onMore,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  onMore: () => void;
}) {
  return (
    <View style={{ height: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="返回信息流" onPress={onClose} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: CREAM, fontSize: 26, lineHeight: 28 }}>‹</Text>
      </Pressable>
      <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 8 }}>
        <Text numberOfLines={1} style={{ color: CREAM, fontSize: 15, fontWeight: "700" }}>{title}</Text>
        <Text numberOfLines={1} style={{ color: DIM, fontSize: 11, marginTop: 1 }}>{subtitle}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="更多" onPress={onMore} hitSlop={8} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: DIM, fontSize: 22, letterSpacing: 1 }}>···</Text>
      </Pressable>
    </View>
  );
}

function ModeSwitch({ mode, onMode }: { mode: ImmersiveMode; onMode: (mode: ImmersiveMode) => void }) {
  return (
    <View style={{ flexDirection: "row", marginHorizontal: 16, marginBottom: 8, padding: 3, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.06)" }}>
      {(["article", "video", "game"] as const).map((id) => {
        const on = mode === id;
        return (
          <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={MODE_LABEL[id]} onPress={() => onMode(id)} style={{ flex: 1, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: on ? AM : "transparent" }}>
            <Text style={{ color: on ? INK : CREAM, fontSize: 13, fontWeight: "700" }}>{MODE_LABEL[id]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function AskBar({ asks }: { asks: readonly LessonAsk[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 12), gap: 8, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)" }}>
      {asks.map((ask, index) => (
        <Pressable key={ask.q} accessibilityRole="button" accessibilityLabel={`问 AI：${ask.q}，模拟`} onPress={() => setOpen(open === index ? null : index)} style={{ paddingHorizontal: 12, paddingVertical: 12, borderRadius: 14, backgroundColor: "rgba(245,166,35,0.12)", flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: AM }}>✦</Text>
          <Text style={{ flex: 1, color: CREAM, fontSize: 14 }} numberOfLines={2}>问 AI：{ask.q}</Text>
          <Text style={{ color: DIM, fontSize: 11 }}>模拟</Text>
        </Pressable>
      ))}
      {open !== null && asks[open] ? (
        <Text style={{ color: CREAM, fontSize: 14, lineHeight: 21, padding: 12, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.06)" }}>模拟 · {asks[open].a}</Text>
      ) : null}
    </View>
  );
}

function Quiz({ lesson }: { lesson: Lesson }) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState(false);
  return (
    <View style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", gap: 8 }}>
      <Text style={{ alignSelf: "flex-start", color: AM, fontSize: 10, fontFamily: MONO, borderWidth: 1, borderColor: "rgba(245,166,35,0.7)", borderRadius: 3, paddingHorizontal: 5, paddingVertical: 2, overflow: "hidden" }}>30 秒</Text>
      {open ? (
        <>
          <Text style={{ color: CREAM, fontSize: 16, lineHeight: 22, fontWeight: "700" }}>{lesson.quiz.q}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="显示答案" onPress={() => setAnswer(true)} style={{ alignSelf: "flex-start", minHeight: 40, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: "rgba(244,241,234,0.4)", justifyContent: "center" }}>
            <Text style={{ color: CREAM, fontWeight: "700" }}>显示答案</Text>
          </Pressable>
          {answer ? <Text style={{ color: CREAM, fontSize: 14, lineHeight: 21 }}>答案 · {lesson.quiz.a}</Text> : null}
        </>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel="30 秒小测" onPress={() => setOpen(true)}>
          <Text style={{ color: CREAM, fontSize: 15, fontWeight: "700" }}>30 秒小测</Text>
        </Pressable>
      )}
    </View>
  );
}

function rowTone(tone: string) {
  if (tone === "hot") return { backgroundColor: "rgba(245,166,35,0.16)", color: AM, borderWidth: 1, borderColor: "rgba(245,166,35,0.6)" };
  if (tone === "mid") return { backgroundColor: "rgba(245,166,35,0.1)", color: CREAM, borderWidth: 0, borderColor: "transparent" };
  if (tone === "ghost") return { backgroundColor: "transparent", color: DIM, borderWidth: 1, borderColor: "rgba(244,241,234,0.25)" };
  return { backgroundColor: "#24242c", color: CREAM, borderWidth: 0, borderColor: "transparent" };
}

function LoopArticle() {
  const [step, setStep] = useState(1);
  const current = LOOP_STEPS[step] ?? LOOP_STEPS[0];
  const nodes = [
    { n: "01", label: "模型思考" },
    { n: "02", label: "调用工具" },
    { n: "04", label: LOOP_NODE_4 },
    { n: "03", label: "环境返回结果" },
  ];
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: DIM, fontSize: 12, fontFamily: MONO }}>DAY 01 · 图文 · 约 8 分钟</Text>
      <Text style={{ color: CREAM, fontSize: 30, lineHeight: 38, fontWeight: "700" }}>
        <Text style={{ color: AM }}>Agent</Text>
        {" 在\n「想→做→看」中循环"}
      </Text>
      <View style={{ borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: 16, padding: 14, backgroundColor: "rgba(18,18,24,0.9)", gap: 10 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: DIM, fontSize: 12, fontFamily: MONO }}>一步步走一遍循环</Text>
          <Text style={{ color: AM, fontSize: 12, fontFamily: MONO }}>{step + 1} / 4</Text>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {nodes.map((node, index) => {
            const on = current.node === index;
            return (
              <View key={node.n} style={{ width: "48%", borderWidth: 1, borderColor: on ? AM : "rgba(255,255,255,0.14)", borderRadius: 12, padding: 10, backgroundColor: on ? "rgba(245,166,35,0.14)" : "#1A1A21" }}>
                <Text style={{ color: DIM, fontSize: 11, fontFamily: MONO }}>{node.n}</Text>
                <Text style={{ color: on ? AM : CREAM, fontSize: 15, fontWeight: on ? "700" : "500", marginTop: 2 }}>{node.label}</Text>
              </View>
            );
          })}
        </View>
        <Text style={{ color: "rgba(244,241,234,0.88)", fontSize: 15, lineHeight: 22 }}>{current.body}</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="上一步" onPress={() => setStep((value) => Math.max(0, value - 1))} style={stepButton}>
            <Text style={{ color: CREAM, fontSize: 14 }}>上一步</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="下一步" onPress={() => setStep((value) => Math.min(LOOP_STEPS.length - 1, value + 1))} style={[stepButton, { backgroundColor: AM, borderWidth: 0 }]}>
            <Text style={{ color: INK, fontSize: 14, fontWeight: "700" }}>下一步</Text>
          </Pressable>
        </View>
      </View>
      <View style={{ borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 16, padding: 14, backgroundColor: "rgba(18,18,24,0.9)", gap: 6 }}>
        <Text style={{ color: DIM, fontSize: 12, fontFamily: MONO, marginBottom: 2 }}>CONTEXT WINDOW · 第 {step + 1} 步</Text>
        {current.rows.map(([label, tone]) => {
          const paint = rowTone(tone);
          return (
            <Text key={label} style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, fontSize: 14, overflow: "hidden", backgroundColor: paint.backgroundColor, color: paint.color, borderWidth: paint.borderWidth, borderColor: paint.borderColor }}>{label}</Text>
          );
        })}
      </View>
    </View>
  );
}

const stepButton = {
  flex: 1,
  height: 42,
  borderRadius: 12,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.2)",
};

function PointArticle({ lesson }: { lesson: Lesson }) {
  const [step, setStep] = useState(0);
  const point = lesson.points[step] ?? lesson.points[0];
  if (!point) return null;
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: DIM, fontSize: 12, fontFamily: MONO }}>{`DAY ${String(lesson.day).padStart(2, "0")} · 图文`}</Text>
      <Title parts={lesson.title} size={30} />
      {lesson.sub ? <Text style={{ color: "rgba(244,241,234,0.75)", fontSize: 15, lineHeight: 22 }}>{lesson.sub}</Text> : null}
      <View style={{ borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: 16, padding: 16, backgroundColor: "rgba(18,18,24,0.9)", gap: 10 }}>
        <Text style={{ color: AM, fontFamily: MONO, fontSize: 12 }}>{step + 1} / {lesson.points.length}</Text>
        <Text style={{ color: CREAM, fontSize: 22, lineHeight: 30, fontWeight: "700" }}>{point.title}</Text>
        <Text style={{ color: "rgba(244,241,234,0.85)", fontSize: 16, lineHeight: 24 }}>{point.body}</Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="上一步" onPress={() => setStep((value) => Math.max(0, value - 1))} style={stepButton}>
            <Text style={{ color: CREAM }}>上一步</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="下一步" onPress={() => setStep((value) => Math.min(lesson.points.length - 1, value + 1))} style={[stepButton, { backgroundColor: AM, borderWidth: 0 }]}>
            <Text style={{ color: INK, fontWeight: "700" }}>下一步</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function DemoVideo({
  spec,
  poster,
}: {
  spec: { kicker: string; duration: number; start: number; chapters: Chapter[] };
  poster: ReactNode;
}) {
  const [time, setTime] = useState(spec.start);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [track, setTrack] = useState(1);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setTime((value) => {
        const next = value + 0.25 * speed;
        if (next >= spec.duration) {
          setPlaying(false);
          return spec.duration;
        }
        return next;
      });
    }, 250);
    return () => clearInterval(timer);
  }, [playing, speed, spec.duration]);
  const chapter = [...spec.chapters].reverse().find((item) => time >= item.at) ?? spec.chapters[0];
  const speeds = [1, 1.5, 2];
  return (
    <View style={{ flex: 1, backgroundColor: "#050507" }}>
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#15131a" }} />
      <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 28, paddingTop: insets.top + 72 }}>{poster}</View>
      <Text style={{ position: "absolute", top: insets.top + 64, left: 20, color: DIM, fontSize: 11, fontFamily: MONO, borderWidth: 1, borderColor: "rgba(255,255,255,0.3)", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" }}>演示</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={playing ? "暂停演示" : "播放演示"} onPress={() => setPlaying((value) => !value)} style={{ position: "absolute", left: "50%", marginLeft: -38, top: "58%", width: 76, height: 76, borderRadius: 38, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#fff", fontSize: 28 }}>{playing ? "Ⅱ" : "▶"}</Text>
      </Pressable>
      <View style={{ paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 20), paddingTop: 24, backgroundColor: "rgba(0,0,0,0.72)", gap: 10 }}>
        <Text style={{ color: CREAM, fontSize: 16, textAlign: "center" }}>{chapter?.line}</Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: DIM, fontSize: 11, fontFamily: MONO }}>{clock(time)}</Text>
          <Text style={{ color: DIM, fontSize: 11, fontFamily: MONO }}>{clock(spec.duration)}</Text>
        </View>
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel="拖动进度，演示"
          onLayout={(event) => setTrack(Math.max(1, event.nativeEvent.layout.width))}
          onPress={(event) => setTime(Math.max(0, Math.min(spec.duration, (event.nativeEvent.locationX / track) * spec.duration)))}
          style={{ height: 20, justifyContent: "center" }}
        >
          <View style={{ height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)" }}>
            <View style={{ width: Math.max(0, Math.min(track, (time / spec.duration) * track)), height: 3, borderRadius: 2, backgroundColor: AM }} />
          </View>
        </Pressable>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {spec.chapters.map((item) => {
            const on = chapter?.label === item.label;
            return (
              <Pressable key={item.label} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setTime(item.at)} style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: on ? AM : "rgba(255,255,255,0.22)" }}>
                <Text style={{ color: on ? AM : CREAM, fontSize: 12 }}>{item.label}</Text>
              </Pressable>
            );
          })}
          <Pressable accessibilityRole="button" accessibilityLabel="倍速" onPress={() => setSpeed((value) => speeds[(speeds.indexOf(value) + 1) % speeds.length] ?? 1)} style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.22)" }}>
            <Text style={{ color: CREAM, fontSize: 12 }}>{speed}×</Text>
          </Pressable>
        </View>
        <Text style={{ color: DIM, fontSize: 11 }}>{spec.kicker}</Text>
      </View>
    </View>
  );
}

function harnessPoster() {
  return (
    <View style={{ gap: 16 }}>
      <Text style={{ color: AM, fontFamily: MONO, fontSize: 12 }}>EP.02 · 3:20</Text>
      <Text style={{ color: CREAM, fontSize: 36, lineHeight: 44, fontWeight: "700" }}>同一模型，{"\n"}差距在 Harness</Text>
    </View>
  );
}

function lessonOnePoster() {
  return (
    <View>
      <Text style={{ color: AM, fontFamily: MONO, fontSize: 13 }}>{LESSON_ONE_VIDEO.kicker}</Text>
      <Text style={{ color: CREAM, fontSize: 48, lineHeight: 58, fontWeight: "700", marginTop: 8 }}>
        {LESSON_ONE_VIDEO.headline}
        <Text style={{ color: AM }}>{LESSON_ONE_VIDEO.accent}</Text>
        {LESSON_ONE_VIDEO.tail}
      </Text>
    </View>
  );
}

const HARNESS_VIDEO = {
  kicker: "HARNESS · 3:20",
  duration: 200,
  start: 42,
  chapters: [
    { label: "基线", at: 0, line: "同一个模型，基线 Harness 52.8%。" },
    { label: "只改 Harness", at: 42, line: "模型没换，得分 +13.7 分。" },
    { label: "五件套", at: 110, line: "上下文管理、工具接口、约束、验证、纠正。" },
  ] as Chapter[],
};

function Game({ onToast }: { onToast: (message: string) => void }) {
  const [board, setBoard] = useState<GameBoard>(initialBoard);
  const [selected, setSelected] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<"empty" | "wrong" | "right" | null>(null);
  const slotRefs = useRef<(Measurable | null)[]>([]);
  const rects = useRef<{ x: number; y: number; w: number; h: number }[]>([]);
  const insets = useSafeAreaInsets();
  const boardRef = useRef(board);
  boardRef.current = board;
  const measure = () => {
    slotRefs.current.forEach((node, index) => {
      node?.measureInWindow((x, y, w, h) => {
        rects.current[index] = { x, y, w, h };
      });
    });
  };

  const drop = (id: string, x: number, y: number) => {
    const slot = rects.current.findIndex((rect) => rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h);
    if (slot < 0) return;
    setBoard((current) => placeOnBoard(current, id, slot));
    setSelected(null);
    setVerdict(null);
  };

  return (
    <View style={{ flex: 1, paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 16), gap: 12 }}>
      <Text style={{ color: CREAM, fontSize: 26, lineHeight: 34, fontWeight: "700" }}>第 30 步时，模型看到了什么？</Text>
      <Text style={{ color: DIM, fontSize: 13 }}>把下面的块按顺序拖进窗口。点一下再点空位也可以。</Text>
      <View style={{ flex: 1, minHeight: 0, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: 16, padding: 12, backgroundColor: "#121218", gap: 8 }}>
        <Text style={{ color: DIM, fontSize: 12, fontFamily: MONO }}>CONTEXT WINDOW</Text>
        {GAME_FIXED.map((label) => (
          <View key={label} style={slotStyle}>
            <Text style={{ color: CREAM, fontSize: 15 }}>{label}</Text>
          </View>
        ))}
        {[0, 1].map((index) => {
          const id = board.slots[index];
          return (
            <Pressable
              key={index}
              ref={(node) => { slotRefs.current[index] = asMeasurable(node); }}
              accessibilityRole="button"
              accessibilityLabel={id ? chipLabel(id) : "放到这里"}
              onPress={() => {
                if (id) {
                  setBoard((current) => returnChip(current, index));
                  setVerdict(null);
                  return;
                }
                if (!selected) return;
                setBoard((current) => placeOnBoard(current, selected, index));
                setSelected(null);
                setVerdict(null);
              }}
              style={[slotStyle, id ? null : { borderWidth: 1.5, borderColor: AM, borderStyle: "dashed", backgroundColor: "rgba(245,166,35,0.08)" }]}
            >
              <Text style={{ color: id ? CREAM : AM, fontSize: 15 }}>{id ? chipLabel(id) : "放到这里"}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {board.pool.map((id) => (
          <DragChip
            key={id}
            label={chipLabel(id)}
            selected={selected === id}
            onMeasure={measure}
            onTap={() => setSelected(selected === id ? null : id)}
            onDrop={(x, y) => drop(id, x, y)}
          />
        ))}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <Text style={{ color: DIM, fontSize: 13 }}>已放 {placedCount(board)} / 5</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="检查答案"
          onPress={() => {
            const result = checkBoard(boardRef.current);
            setVerdict(result);
            if (result === "empty") onToast("还有空位");
          }}
          style={{ backgroundColor: AM, paddingHorizontal: 22, paddingVertical: 14, borderRadius: 12 }}
        >
          <Text style={{ color: INK, fontSize: 15, fontWeight: "700" }}>检查答案</Text>
        </Pressable>
      </View>
      {verdict === "right" ? <Text style={{ color: CREAM, fontSize: 14, lineHeight: 20 }}>排对了。固定前缀在前，执行轨迹跟在后面。</Text> : null}
      {verdict === "wrong" ? <Text style={{ color: CREAM, fontSize: 14, lineHeight: 20 }}>还没排对。天气预报不属于这节的上下文。</Text> : null}
      {verdict ? (
        <Pressable accessibilityRole="button" accessibilityLabel="再玩一次" onPress={() => { setBoard(initialBoard()); setSelected(null); setVerdict(null); }}>
          <Text style={{ color: AM, fontSize: 14 }}>再玩一次</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const slotStyle = {
  minHeight: 48,
  borderRadius: 10,
  backgroundColor: "#24242c",
  justifyContent: "center" as const,
  paddingHorizontal: 12,
};

function DragChip({
  label,
  selected,
  onTap,
  onDrop,
  onMeasure,
}: {
  label: string;
  selected: boolean;
  onTap: () => void;
  onDrop: (x: number, y: number) => void;
  onMeasure: () => void;
}) {
  const drag = useRef({ x: 0, y: 0 });
  const tapRef = useRef(onTap);
  const dropRef = useRef(onDrop);
  const measureRef = useRef(onMeasure);
  tapRef.current = onTap;
  dropRef.current = onDrop;
  measureRef.current = onMeasure;
  const [, bump] = useState(0);
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) + Math.abs(gesture.dy) > 4,
    onPanResponderGrant: () => {
      measureRef.current();
      drag.current = { x: 0, y: 0 };
    },
    onPanResponderMove: (_, gesture) => {
      drag.current = { x: gesture.dx, y: gesture.dy };
      bump((value) => value + 1);
    },
    onPanResponderRelease: (event, gesture) => {
      const moved = Math.abs(gesture.dx) + Math.abs(gesture.dy) > 10;
      drag.current = { x: 0, y: 0 };
      bump((value) => value + 1);
      if (!moved) tapRef.current();
      else dropRef.current(event.nativeEvent.pageX, event.nativeEvent.pageY);
    },
    onPanResponderTerminate: () => {
      drag.current = { x: 0, y: 0 };
      bump((value) => value + 1);
    },
  })).current;
  return (
    <View
      {...responder.panHandlers}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 12,
        backgroundColor: selected ? AM : "#24242c",
        borderWidth: 1,
        borderColor: selected ? AM : "rgba(255,255,255,0.1)",
        transform: [{ translateX: drag.current.x }, { translateY: drag.current.y }],
        zIndex: drag.current.x || drag.current.y ? 3 : 0,
      }}
    >
      <Text style={{ color: selected ? INK : CREAM, fontSize: 14, fontWeight: selected ? "700" : "500" }}>{label}</Text>
    </View>
  );
}

export function ImmersivePage({
  lesson,
  mode,
  onMode,
  onClose,
  onDismiss,
}: {
  lesson: Lesson;
  mode: ImmersiveMode;
  onMode: (mode: ImmersiveMode) => void;
  onClose: () => void;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = (message: string) => {
    setToast(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 1600);
  };
  const showSwitch = lesson.day === 1;
  const title = mode === "video"
    ? (lesson.day === 1 ? "一次「想→做→看」循环" : plainTitle(lesson.title))
    : mode === "game"
      ? "排一排上下文窗口"
      : lesson.sheetTitle;
  const subtitle = mode === "game" ? accountLine(lesson.day, "小游戏") : accountLine(lesson.day);

  const bar = (
    <TopBar title={title} subtitle={subtitle} onClose={onClose} onMore={() => setMenu((value) => !value)} />
  );
  const switcher = showSwitch ? <ModeSwitch mode={mode} onMode={onMode} /> : null;

  return (
    <View style={{ flex: 1, backgroundColor: mode === "video" ? "#050507" : BG }}>
      {mode === "video" ? null : <GridLines />}
      {mode === "video" ? (
        <View style={{ flex: 1 }}>
          <DemoVideo spec={lesson.day === 1 ? LESSON_ONE_VIDEO : HARNESS_VIDEO} poster={lesson.day === 1 ? lessonOnePoster() : harnessPoster()} />
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, paddingTop: insets.top, backgroundColor: "rgba(0,0,0,0.28)" }}>
            {bar}
            {switcher}
          </View>
        </View>
      ) : mode === "game" ? (
        <View style={{ flex: 1, paddingTop: insets.top }}>
          {bar}
          {switcher}
          <Game onToast={show} />
        </View>
      ) : (
        <View style={{ flex: 1, paddingTop: insets.top }}>
          {bar}
          {switcher}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16, gap: 12 }} showsVerticalScrollIndicator={false}>
            {lesson.day === 1 ? <LoopArticle /> : <PointArticle lesson={lesson} />}
            <Quiz lesson={lesson} />
          </ScrollView>
          <AskBar asks={lesson.asks} />
        </View>
      )}
      {menu ? (
        <View style={{ position: "absolute", top: insets.top + 52, right: 12, width: 168, borderRadius: 12, backgroundColor: "#1C1C22", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", overflow: "hidden", zIndex: 6 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="分享" onPress={() => { setMenu(false); show("演示 · 没有接通"); }} style={menuItem}>
            <Text style={{ color: CREAM, fontSize: 15 }}>分享</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="不感兴趣" onPress={() => { setMenu(false); onDismiss(); show("已记在这台设备上"); }} style={menuItem}>
            <Text style={{ color: CREAM, fontSize: 15 }}>不感兴趣</Text>
          </Pressable>
        </View>
      ) : null}
      {toast ? (
        <View pointerEvents="none" style={{ position: "absolute", left: 20, right: 20, bottom: Math.max(insets.bottom, 24), alignItems: "center" }}>
          <Text style={{ color: CREAM, backgroundColor: "rgba(0,0,0,0.82)", overflow: "hidden", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}>{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}

const menuItem = { minHeight: 48, justifyContent: "center" as const, paddingHorizontal: 14 };
