import { Image, Pressable, Text, View } from "react-native";
import type { Measurable } from "../chrome";
import { asMeasurable } from "../chrome";
import { ENGLISH, INFO, STUDY, WAVEFORM, type DemoId } from "./data";
import { useRef } from "react";

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

export function SampleMark({ ink }: { ink?: boolean }) {
  return (
    <Text style={{ alignSelf: "flex-start", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1, borderColor: ink ? INK : "rgba(243,239,231,0.45)", color: ink ? INK : CREAM, fontSize: 11, fontWeight: "700" }}>样例</Text>
  );
}

function AccountChip({
  id,
  ink,
  followed,
  onAccount,
  onFollow,
}: {
  id: DemoId;
  ink: boolean;
  followed: boolean;
  onAccount: () => void;
  onFollow: () => void;
}) {
  const name = id === "demo-info" ? "Info Bot" : id === "demo-english" ? "English Bot" : "Study Bot";
  const color = ink ? INK : CREAM;
  return (
    <View style={{ paddingTop: 8, paddingBottom: 16, paddingHorizontal: 16, flexDirection: "row", alignItems: "center" }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${name} 账号`} onPress={onAccount} style={{ minWidth: 160, minHeight: 44, flexDirection: "row", alignItems: "center" }}>
        <Image source={AVATAR[id]} style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: color }} />
        <Text style={{ marginLeft: 10, color, fontSize: 16, fontWeight: "700" }}>{name}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={followed ? "已关注" : "关注"} onPress={onFollow} hitSlop={8} style={{ marginLeft: 8, height: 28, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: color, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color, fontSize: 13, fontWeight: "700" }}>{followed ? "已关注" : "关注"}</Text>
      </Pressable>
    </View>
  );
}

function InfoCover() {
  return (
    <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: INK, fontSize: 12, fontWeight: "800", letterSpacing: 1 }}>AI DAILY SIGNAL</Text>
        <Text style={{ color: INK, fontFamily: MONO, fontSize: 12 }}>{INFO.date}</Text>
      </View>
      <View style={{ marginTop: 8, borderTopWidth: 3, borderTopColor: INK, paddingTop: 3, borderBottomWidth: 1, borderBottomColor: INK }} />
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <SampleMark ink />
        {INFO.chips.map((chip, index) => (
          <Text key={chip} style={{ overflow: "hidden", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: index === 0 ? INK : "transparent", color: index === 0 ? CREAM : INK, borderWidth: index === 0 ? 0 : 1.5, borderColor: INK, fontSize: 12, fontWeight: "700" }}>{chip}</Text>
        ))}
      </View>
      <View style={{ height: 168, marginTop: 4, justifyContent: "flex-end" }}>
        <Text style={{ color: INK, fontSize: 132, lineHeight: 132, fontWeight: "900", letterSpacing: -4 }}>{INFO.hero}</Text>
        <View style={{ position: "absolute", right: 0, top: 8, width: 92, height: 92, borderRadius: 46, borderWidth: 2, borderColor: INK, alignItems: "center", justifyContent: "center", transform: [{ rotate: "-8deg" }] }}>
          <Text style={{ color: INK, fontSize: 12, fontWeight: "800" }}>周四开盘</Text>
          <Text style={{ color: INK, fontFamily: MONO, fontSize: 20, fontWeight: "900" }}>ANT</Text>
        </View>
      </View>
      <Text style={{ color: INK, fontSize: 28, lineHeight: 34, fontWeight: "800" }}>Anthropic 定价{"\n"}83 美元，周四 ANT 开盘</Text>
      <Text style={{ marginTop: 8, color: "#4A463E", fontSize: 15, lineHeight: 22 }}>{INFO.hook}</Text>
      <View style={{ marginTop: "auto", borderTopWidth: 2, borderTopColor: INK }}>
        {INFO.points.map((point) => (
          <View key={point.n} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, borderBottomWidth: 1, borderBottomColor: "rgba(28,27,25,0.22)" }}>
            <Text style={{ width: 24, color: INK, fontFamily: MONO, fontWeight: "700" }}>{point.n}</Text>
            <Text style={{ overflow: "hidden", backgroundColor: INK, color: CREAM, fontSize: 12, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>{point.tag}</Text>
            <Text style={{ flex: 1, color: INK, fontSize: 15, fontWeight: "700" }}>{point.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function EnglishCover() {
  const flagAt = Math.round((50.5 / 64) * 100);
  return (
    <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: INK, fontSize: 11, fontWeight: "800", letterSpacing: 1 }}>DAILY SPOKEN ENGLISH</Text>
        <Text style={{ color: INK, fontFamily: MONO, fontSize: 12 }}>11.19</Text>
      </View>
      <View style={{ marginTop: 8, borderTopWidth: 3, borderTopColor: INK, paddingTop: 3, borderBottomWidth: 1, borderBottomColor: INK }} />
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <SampleMark ink />
        <Text style={{ overflow: "hidden", backgroundColor: INK, color: CREAM, fontSize: 12, fontWeight: "700", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>今日口语</Text>
        <Text style={{ overflow: "hidden", borderWidth: 1.5, borderColor: INK, color: INK, fontSize: 12, fontWeight: "700", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>音频 3:15</Text>
      </View>
      <Text style={{ marginTop: 12, color: INK, fontSize: 44, lineHeight: 48, fontWeight: "900" }}>{ENGLISH.phrase}</Text>
      <Text style={{ marginTop: 10, color: INK, fontSize: 22, fontWeight: "800" }}>{ENGLISH.meaning}</Text>
      <Text style={{ marginTop: 4, color: INK, fontSize: 14 }}>{ENGLISH.hook}</Text>
      <View style={{ flex: 1, minHeight: 90, marginTop: 12, justifyContent: "flex-end" }}>
        <View style={{ flexDirection: "row", alignItems: "flex-end", height: 88, gap: 2 }}>
          {WAVEFORM.map((bar, index) => (
            <View key={index} style={{ flex: 1, height: Math.max(4, Math.round(bar * 84)), borderRadius: 2, backgroundColor: index >= 52 ? CREAM : INK }} />
          ))}
        </View>
        <View style={{ position: "absolute", left: `${flagAt}%`, top: 0, bottom: 18, width: 2, backgroundColor: INK }} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
          <Text style={{ color: INK, fontFamily: MONO, fontSize: 11 }}>0:00</Text>
          <Text style={{ color: INK, fontFamily: MONO, fontSize: 11 }}>3:15</Text>
        </View>
      </View>
      <View style={{ marginTop: 10, backgroundColor: CREAM, borderRadius: 16, padding: 14 }}>
        <Text style={{ color: INK, fontFamily: MONO, fontSize: 10, letterSpacing: 1 }}>EXAMPLE</Text>
        <Text style={{ marginTop: 6, color: INK, fontSize: 16, lineHeight: 22, fontWeight: "700" }}>{ENGLISH.example}</Text>
      </View>
    </View>
  );
}

function StudyCover() {
  return (
    <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: AMBER, fontSize: 12, borderWidth: 1, borderColor: "rgba(245,166,35,0.5)", borderRadius: 99, overflow: "hidden", paddingHorizontal: 10, paddingVertical: 4 }}>{STUDY.kicker}</Text>
        <Text style={{ color: CREAM, fontFamily: MONO, fontSize: 12 }}>DAY 03 / 30</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 2, marginTop: 10 }}>
        {Array.from({ length: 30 }, (_, index) => (
          <View key={index} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: index < 2 ? "rgba(243,239,231,0.7)" : index === 2 ? AMBER : "rgba(243,239,231,0.14)" }} />
        ))}
      </View>
      <View style={{ marginTop: 10 }}><SampleMark /></View>
      <Text style={{ marginTop: 8, color: CREAM, fontSize: 28, lineHeight: 34, fontWeight: "800" }}>
        一步 <Text style={{ color: AMBER, fontFamily: MONO }}>decode</Text> 约 <Text style={{ color: AMBER, fontFamily: MONO }}>2N</Text>，要和 <Text style={{ color: AMBER, fontFamily: MONO }}>prefill</Text> 分账
      </Text>
      <Text style={{ marginTop: 8, color: "rgba(243,239,231,0.7)", fontSize: 15 }}>{STUDY.hook}</Text>
      <View style={{ marginTop: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: 16, padding: 14, backgroundColor: "rgba(10,10,12,0.7)" }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: "rgba(243,239,231,0.55)", fontFamily: MONO, fontSize: 10 }}>LEDGER · 一步 DECODE</Text>
          <Text style={{ color: "rgba(243,239,231,0.45)", fontFamily: MONO, fontSize: 10 }}>INFRA 待开</Text>
        </View>
        <Text style={{ color: AMBER, fontFamily: MONO, fontSize: 56, fontWeight: "800", marginTop: 4 }}>F <Text style={{ color: "rgba(243,239,231,0.6)", fontSize: 28 }}>≈</Text> 2N</Text>
        <Text style={{ color: "rgba(243,239,231,0.62)", fontSize: 12 }}>稠密模型 · 一阶估算 · 一次乘加计 2 FLOPs</Text>
      </View>
      <View style={{ marginTop: "auto", gap: 8, paddingTop: 10 }}>
        {STUDY.takeaways.map((item) => (
          <View key={item.n} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingHorizontal: 10, borderRadius: 12, backgroundColor: "rgba(243,239,231,0.07)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" }}>
            <Text style={{ width: 32, height: 32, borderRadius: 8, overflow: "hidden", backgroundColor: AMBER, color: INK, textAlign: "center", lineHeight: 32, fontFamily: MONO, fontWeight: "800" }}>{item.n}</Text>
            <Text style={{ flex: 1, color: CREAM, fontSize: 15, fontWeight: "700" }}>{item.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function DemoCard({
  id,
  height,
  followed,
  onFollow,
  onOpen,
  onAccount,
}: {
  id: DemoId;
  height: number;
  followed: boolean;
  onFollow: () => void;
  onOpen: (node: Measurable | null) => void;
  onAccount: () => void;
}) {
  const nodeRef = useRef<Measurable | null>(null);
  const ink = id !== "demo-study";
  const backgroundColor = id === "demo-info" ? CREAM : id === "demo-english" ? CLAY : "#0F0F11";
  const label = id === "demo-info" ? "Info Bot 样例封面" : id === "demo-english" ? "English Bot 样例封面" : "Study Bot 样例封面";
  return (
    <View style={{ height, backgroundColor }}>
      <Pressable
        ref={(node) => { nodeRef.current = asMeasurable(node); }}
        collapsable={false}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => onOpen(nodeRef.current)}
        style={{ flex: 1 }}
      >
        {id === "demo-info" ? <InfoCover /> : null}
        {id === "demo-english" ? <EnglishCover /> : null}
        {id === "demo-study" ? <StudyCover /> : null}
      </Pressable>
      <AccountChip id={id} ink={ink} followed={followed} onAccount={onAccount} onFollow={onFollow} />
    </View>
  );
}
