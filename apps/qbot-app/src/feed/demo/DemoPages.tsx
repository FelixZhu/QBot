import { useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ACCOUNTS, ENGLISH, INFO, STUDY, WAVEFORM, type DemoId } from "./data";
import { SampleMark } from "./DemoCard";

const INK = "#1C1B19";
const CREAM = "#F3EFE7";
const CLAY = "#D9774B";
const AMBER = "#F5A623";
const MONO = "monospace";

const AVATAR = {
  "demo-info": require("../../../assets/demo/av-info.png"),
  "demo-english": require("../../../assets/demo/av-english.png"),
  "demo-study": require("../../../assets/demo/av-study.png"),
} as const;

const MENU = ["稍后", "少看这类", "不再提醒此类型", "取关", "分享"] as const;

function TopBar({
  id,
  title,
  account,
  ink,
  onBack,
  onAccount,
  onMenu,
}: {
  id: DemoId;
  title: string;
  account: string;
  ink: boolean;
  onBack: () => void;
  onAccount: () => void;
  onMenu: () => void;
}) {
  const color = ink ? INK : CREAM;
  return (
    <View style={{ paddingHorizontal: 8, paddingBottom: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回封面" onPress={onBack} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: ink ? "rgba(28,27,25,0.08)" : "rgba(243,239,231,0.1)" }}>
          <Text style={{ color, fontSize: 26 }}>‹</Text>
        </Pressable>
        <Text style={{ flex: 1, color, fontSize: 15, fontWeight: "700", marginHorizontal: 8 }} numberOfLines={1}>{title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="更多" onPress={onMenu} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color, fontSize: 20 }}>···</Text>
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${ACCOUNTS[id].name} 账号`} onPress={onAccount} style={{ minHeight: 44, marginLeft: 48, marginRight: 48, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Image source={AVATAR[id]} style={{ width: 28, height: 28, borderRadius: 14 }} />
        <Text style={{ color, fontSize: 13, opacity: 0.8 }} numberOfLines={1}>{account}</Text>
      </Pressable>
    </View>
  );
}

function Menu({ onPick }: { onPick: (label: string) => void }) {
  return (
    <View style={{ position: "absolute", right: 12, top: 96, width: 210, backgroundColor: "#FFFEFB", borderRadius: 16, zIndex: 5, overflow: "hidden" }}>
      {MENU.map((label) => (
        <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={() => onPick(label)} style={{ minHeight: 44, paddingHorizontal: 16, justifyContent: "center", borderTopWidth: label === MENU[0] ? 0 : 1, borderTopColor: "#ECE7DD" }}>
          <Text style={{ color: INK, fontSize: 15 }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Why({ text, ink }: { text: string; ink: boolean }) {
  return (
    <Text style={{ color: ink ? INK : "rgba(243,239,231,0.85)", fontSize: 12, paddingHorizontal: 20, paddingBottom: 16 }}>
      <Text style={{ fontWeight: "700" }}>为什么推给你</Text>
      {`  ${text}`}
    </Text>
  );
}

export function DemoImmersive({
  id,
  onBack,
  onAccount,
  onSample,
}: {
  id: DemoId;
  onBack: () => void;
  onAccount: () => void;
  onSample: (message: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState(false);
  const [ask, setAsk] = useState(false);
  const [step, setStep] = useState(1);
  const ink = id !== "demo-study";
  const backgroundColor = id === "demo-english" ? CLAY : id === "demo-info" ? CREAM : "#0F0F11";
  const title = id === "demo-info" ? INFO.immersiveTitle : id === "demo-english" ? ENGLISH.phraseLine : STUDY.immersiveTitle;
  const account = id === "demo-info" ? INFO.accountLine : id === "demo-english" ? "English Bot · 11-19 口语" : STUDY.accountLine;
  return (
    <View style={{ flex: 1, backgroundColor, paddingTop: insets.top }}>
      <TopBar id={id} title={title} account={account} ink={ink} onBack={onBack} onAccount={onAccount} onMenu={() => setMenu((value) => !value)} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12, gap: 10 }} showsVerticalScrollIndicator={false}>
        <SampleMark ink={ink} />
        {id === "demo-info" ? <InfoBody ask={ask} onAsk={() => setAsk(true)} onSample={onSample} /> : null}
        {id === "demo-english" ? <EnglishBody onSample={onSample} /> : null}
        {id === "demo-study" ? <StudyBody step={step} setStep={setStep} ask={ask} onAsk={() => setAsk(true)} onSample={onSample} /> : null}
        {ask ? <Text style={{ color: ink ? INK : CREAM, fontSize: 14, lineHeight: 21 }}>{id === "demo-study" ? STUDY.answer : INFO.answer}</Text> : null}
      </ScrollView>
      <Why text={id === "demo-info" ? INFO.why : id === "demo-english" ? ENGLISH.why : STUDY.why} ink={ink} />
      {menu ? <Menu onPick={(label) => { setMenu(false); onSample(`样例 · ${label} · 没有接通`); }} /> : null}
    </View>
  );
}

function InfoBody({ ask, onAsk, onSample }: { ask: boolean; onAsk: () => void; onSample: (message: string) => void }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 2, borderBottomColor: INK, paddingBottom: 8 }}>
        <Text style={{ color: INK, fontWeight: "800" }}>今日三条信号</Text>
        <Text style={{ color: INK, fontFamily: MONO, fontSize: 12 }}>08:16 北京时间</Text>
      </View>
      {INFO.signals.map((item) => (
        <View key={item.n} style={{ flexDirection: "row", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "rgba(28,27,25,0.2)" }}>
          <Text style={{ width: 36, color: INK, fontFamily: MONO, fontSize: 22, fontWeight: "800" }}>{item.n}</Text>
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {item.tags.map((tag) => <Text key={tag} style={{ overflow: "hidden", backgroundColor: INK, color: CREAM, fontSize: 11, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>{tag}</Text>)}
            </View>
            <Text style={{ color: INK, fontSize: 16, fontWeight: "800", lineHeight: 22 }}>{item.title}</Text>
            <Text style={{ color: "#4A463E", fontSize: 13, lineHeight: 20 }}>{item.body}</Text>
            <Pressable accessibilityRole="button" onPress={() => onSample("样例 · 没有原帖链接")}><Text style={{ color: "#A94E27", fontWeight: "700" }}>查看原帖</Text></Pressable>
          </View>
        </View>
      ))}
      <Text style={{ color: INK, fontSize: 11, lineHeight: 16, opacity: 0.7 }}>{INFO.sourceLine}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="问 QBot，模拟" onPress={onAsk} style={{ minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: "rgba(28,27,25,0.3)", paddingHorizontal: 14, flexDirection: "row", alignItems: "center" }}>
        <Text style={{ flex: 1, color: "#4A463E", fontSize: 13 }}>问 QBot：{INFO.ask}</Text>
        <Text style={{ color: INK, fontFamily: MONO, fontSize: 11, borderWidth: 1, borderColor: INK, borderRadius: 3, overflow: "hidden", paddingHorizontal: 4 }}>模拟</Text>
      </Pressable>
      {ask ? null : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable accessibilityRole="button" onPress={() => onSample("样例 · 没有当日归档")} style={{ flex: 1, height: 46, borderRadius: 23, backgroundColor: INK, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: CREAM, fontWeight: "700" }}>打开当日归档</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => onSample("样例 · 没有原帖链接")} style={{ flex: 1, height: 46, borderRadius: 23, borderWidth: 1.5, borderColor: INK, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: INK, fontWeight: "700" }}>查看原帖</Text>
        </Pressable>
      </View>
    </View>
  );
}

function EnglishBody({ onSample }: { onSample: (message: string) => void }) {
  const [playing, setPlaying] = useState(false);
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: INK, fontSize: 32, lineHeight: 36, fontWeight: "900" }}>{ENGLISH.phrase}</Text>
      <Text style={{ color: INK, fontSize: 16, fontWeight: "700" }}>{ENGLISH.meaning}</Text>
      <View style={{ backgroundColor: CREAM, borderRadius: 24, padding: 16, gap: 10 }}>
        <View style={{ height: 62, borderRadius: 20, backgroundColor: INK, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={playing ? "暂停样例" : "播放样例"} onPress={() => { setPlaying((value) => !value); onSample("样例 · 没有音频文件"); }} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: CREAM, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: INK, fontWeight: "800" }}>{playing ? "Ⅱ" : "▶"}</Text>
          </Pressable>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "flex-end", height: 34, gap: 1 }}>
            {WAVEFORM.filter((_, index) => index % 2 === 0).map((bar, index) => (
              <View key={index} style={{ flex: 1, height: Math.max(3, Math.round(bar * 32)), backgroundColor: "rgba(243,239,231,0.45)", borderRadius: 1 }} />
            ))}
          </View>
          <Text style={{ color: CREAM, fontFamily: MONO, fontSize: 11 }}>0:00{"\n"}3:15</Text>
        </View>
        <Text style={{ color: INK, fontFamily: MONO, fontSize: 10, letterSpacing: 1 }}>意思</Text>
        <Text style={{ color: INK, fontSize: 14, lineHeight: 22 }}>{ENGLISH.meaningLong}</Text>
        <Text style={{ color: INK, fontFamily: MONO, fontSize: 10, letterSpacing: 1 }}>短对话</Text>
        <View style={{ alignSelf: "flex-start", maxWidth: "90%", backgroundColor: "#E7E1D4", borderRadius: 16, padding: 10 }}>
          <Text style={{ color: INK, fontSize: 14 }}>{ENGLISH.dialogue[0]}</Text>
        </View>
        <View style={{ alignSelf: "flex-end", maxWidth: "90%", backgroundColor: INK, borderRadius: 16, padding: 10 }}>
          <Text style={{ color: CREAM, fontSize: 14 }}>{ENGLISH.dialogue[1]}</Text>
        </View>
        <Text style={{ color: INK, fontFamily: MONO, fontSize: 10, letterSpacing: 1 }}>别搞混</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {ENGLISH.mix.map((item) => (
            <View key={item.phrase} style={{ flex: 1, borderRadius: 12, padding: 8, borderWidth: 1, borderColor: item.focus ? CLAY : "rgba(28,27,25,0.2)", backgroundColor: item.focus ? "rgba(217,119,75,0.2)" : "transparent" }}>
              <Text style={{ color: INK, fontWeight: "700" }}>{item.phrase}</Text>
              <Text style={{ color: INK }}>{item.gloss}</Text>
            </View>
          ))}
        </View>
        <Text style={{ color: INK, fontFamily: MONO, fontSize: 10, letterSpacing: 1 }}>口头练习</Text>
        <Text style={{ color: INK, fontSize: 14, lineHeight: 22 }}>{ENGLISH.practice}</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="跟读短对话，模拟" onPress={() => onSample("样例 · 跟读没有接通")} style={{ flex: 1, height: 46, borderRadius: 23, backgroundColor: INK, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: CREAM, fontWeight: "700" }}>跟读短对话  模拟</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => onSample("样例 · 口头练习没有接通")} style={{ flex: 1, height: 46, borderRadius: 23, borderWidth: 1.5, borderColor: INK, backgroundColor: CREAM, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: INK, fontWeight: "700" }}>口头练习</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function StudyBody({
  step,
  setStep,
  onAsk,
  onSample,
}: {
  step: number;
  setStep: (step: number) => void;
  ask: boolean;
  onAsk: () => void;
  onSample: (message: string) => void;
}) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: "rgba(243,239,231,0.7)", fontFamily: MONO, fontSize: 12 }}>DAY 03 / 30 · 图文 · 第 {step + 1} / 3 步</Text>
        <Text style={{ color: AMBER, fontSize: 12 }}>含讲解视频</Text>
        <Text style={{ color: AMBER, fontSize: 12, borderWidth: 1, borderColor: AMBER, borderRadius: 3, overflow: "hidden", paddingHorizontal: 4 }}>演示</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {STUDY.steps.map((label, index) => {
          const on = index === step;
          return (
            <View key={label} style={{ flex: 1, minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: on ? AMBER : "rgba(255,255,255,0.14)", backgroundColor: on ? "rgba(245,166,35,0.12)" : "rgba(255,255,255,0.03)", padding: 8 }}>
              <Text style={{ color: on ? AMBER : "rgba(243,239,231,0.65)", fontFamily: MONO, fontSize: 11 }}>{String(index + 1).padStart(2, "0")}</Text>
              <Text style={{ color: CREAM, fontSize: 12 }}>{label}</Text>
            </View>
          );
        })}
      </View>
      <View style={{ borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: 16, padding: 14, backgroundColor: "rgba(10,10,12,0.78)", gap: 6 }}>
        <Text style={{ color: "rgba(243,239,231,0.5)", fontFamily: MONO, fontSize: 11 }}>手算锚点 · N = 8B</Text>
        <Text style={{ color: "rgba(243,239,231,0.85)", fontFamily: MONO, fontSize: 16, lineHeight: 28 }}>F ≈ 2N{"\n"}2 × 8×10⁹ = 1.6×10¹⁰</Text>
        <Text style={{ color: AMBER, fontFamily: MONO, fontSize: 28, fontWeight: "800" }}>≈ 16 GFLOPs / 步</Text>
        <Text style={{ color: "rgba(243,239,231,0.75)", fontSize: 13, lineHeight: 20 }}>{STUDY.note}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="上一步" onPress={() => setStep(Math.max(0, step - 1))} style={{ flex: 1, height: 40, borderRadius: 12, borderWidth: 1, borderColor: "rgba(243,239,231,0.3)", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: CREAM }}>上一步</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="下一步" onPress={() => setStep(Math.min(2, step + 1))} style={{ flex: 1, height: 40, borderRadius: 12, backgroundColor: AMBER, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: INK, fontWeight: "700" }}>下一步</Text>
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="问 AI，模拟" onPress={onAsk} style={{ minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: "rgba(243,239,231,0.2)", paddingHorizontal: 12, flexDirection: "row", alignItems: "center" }}>
        <Text style={{ flex: 1, color: "rgba(243,239,231,0.8)", fontSize: 13 }}>问 AI：{STUDY.ask}</Text>
        <Text style={{ color: CREAM, fontFamily: MONO, fontSize: 11 }}>模拟</Text>
      </Pressable>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {["开始学习", "读讲义", "做小测"].map((label) => (
          <Pressable key={label} accessibilityRole="button" onPress={() => onSample(`样例 · ${label} · 没有接通`)} style={{ flex: 1, height: 46, borderRadius: 23, backgroundColor: label === "开始学习" ? AMBER : "transparent", borderWidth: label === "开始学习" ? 0 : 1, borderColor: "rgba(243,239,231,0.3)", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: label === "开始学习" ? INK : CREAM, fontWeight: "700", fontSize: 13 }}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function DemoAccount({
  id,
  followed,
  onFollow,
  onBack,
}: {
  id: DemoId;
  followed: boolean;
  onFollow: () => void;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const account = ACCOUNTS[id];
  const headerBg = id === "demo-info" ? CREAM : id === "demo-english" ? CLAY : "#0F0F11";
  const headerInk = id !== "demo-study";
  const color = headerInk ? INK : CREAM;
  return (
    <View style={{ flex: 1, backgroundColor: "#141413" }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={{ backgroundColor: headerBg, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, paddingTop: insets.top + 56, paddingHorizontal: 20, paddingBottom: 20 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Image source={AVATAR[id]} style={{ width: 84, height: 84, borderRadius: 42 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color, fontSize: 28, fontWeight: "900" }}>{account.name}</Text>
              <Text style={{ marginTop: 6, alignSelf: "flex-start", overflow: "hidden", backgroundColor: id === "demo-study" ? "rgba(245,166,35,0.15)" : INK, color: id === "demo-study" ? AMBER : CREAM, borderWidth: id === "demo-study" ? 1 : 0, borderColor: "rgba(245,166,35,0.5)", fontSize: 12, fontWeight: "700", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 11 }}>{account.kind}</Text>
            </View>
          </View>
          <Text style={{ color, fontSize: 15, lineHeight: 22, marginTop: 14 }}>{account.bio}</Text>
          <View style={{ flexDirection: "row", marginTop: 14 }}>
            {account.stats.map((stat) => (
              <View key={stat.label} style={{ flex: 1 }}>
                <Text style={{ color, fontSize: 18, fontWeight: "800" }}>{stat.value}</Text>
                <Text style={{ color, fontSize: 12, opacity: 0.7, marginTop: 2 }}>{stat.label}</Text>
              </View>
            ))}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={followed ? "已关注" : "关注"} onPress={onFollow} style={{ marginTop: 14, height: 44, borderRadius: 22, backgroundColor: id === "demo-study" ? AMBER : INK, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: id === "demo-study" ? INK : CREAM, fontWeight: "800" }}>{followed ? "已关注" : "关注"}</Text>
          </Pressable>
          <View style={{ marginTop: 12 }}><SampleMark ink={headerInk} /></View>
        </View>
        <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }}>
            <Text style={{ color: CREAM, fontWeight: "800" }}>{account.section}</Text>
            <Text style={{ color: "rgba(243,239,231,0.55)", fontSize: 12 }}>{account.sectionNote}</Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {id === "demo-info" ? INFO.thumbs.map((thumb) => (
              <View key={thumb.date} style={{ width: "31%", minHeight: 120, backgroundColor: CREAM, borderRadius: 12, padding: 8 }}>
                <Text style={{ color: INK, fontFamily: MONO, fontSize: 10 }}>{thumb.date}</Text>
                {thumb.hero ? <Text style={{ color: INK, fontSize: 28, fontWeight: "900" }}>{thumb.hero}</Text> : null}
                <Text style={{ color: INK, fontSize: 13, fontWeight: "800", marginTop: 4 }}>{thumb.title}</Text>
                <Text style={{ color: INK, fontSize: 10, marginTop: 6 }}>{thumb.tag}</Text>
              </View>
            )) : null}
            {id === "demo-english" ? ENGLISH.phrases.map((item) => (
              <View key={item.date + item.phrase} style={{ width: "31%", minHeight: 120, backgroundColor: CLAY, borderRadius: 12, padding: 8 }}>
                <Text style={{ color: INK, fontFamily: MONO, fontSize: 10 }}>{item.date}</Text>
                <Text style={{ color: INK, fontSize: 16, fontWeight: "900", marginTop: 8 }}>{item.phrase}</Text>
              </View>
            )) : null}
            {id === "demo-study" ? STUDY.lessons.map((item) => (
              <View key={item.kicker + item.day} style={{ width: "31%", minHeight: 132, backgroundColor: "#0F0F11", borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", padding: 8 }}>
                <Text style={{ color: "rgba(243,239,231,0.6)", fontFamily: MONO, fontSize: 10 }}>{item.kicker}</Text>
                <Text style={{ color: AMBER, fontFamily: MONO, fontSize: 16, fontWeight: "800", marginTop: 4 }}>{item.day}</Text>
                <Text style={{ color: CREAM, fontSize: 12, fontWeight: "700", marginTop: 4 }}>{item.title}</Text>
                {item.mark ? <Text style={{ color: item.mark === "待开" ? AMBER : "rgba(243,239,231,0.7)", fontSize: 10, marginTop: 6 }}>{item.mark}</Text> : null}
              </View>
            )) : null}
          </View>
        </View>
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="返回上一页" onPress={onBack} style={{ position: "absolute", top: insets.top + 8, left: 12, width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: headerInk ? "rgba(28,27,25,0.08)" : "rgba(243,239,231,0.1)" }}>
        <Text style={{ color, fontSize: 26 }}>‹</Text>
      </Pressable>
    </View>
  );
}
