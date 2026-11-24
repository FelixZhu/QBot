import { Text, View } from "react-native";
import { palette, type Scheme } from "../theme";
import { contentBand, type CoverSurface } from "./immersive";

/** Published cover words. The native row owns the avatar, attribution, and time. */
export type InfoFace = {
  kind: "info";
  mast: string;
  mark: string;
  chips: string[];
  hero: string;
  title: string;
  deck: string;
  points: { n: string; tag: string; text: string }[];
  hint: string;
};

export type EnglishFace = {
  kind: "english";
  mast: string;
  mark: string;
  chips: string[];
  phrase: string;
  meaning: string;
  hook: string;
  exampleLabel: string;
  example: string;
  note: string;
  hint: string;
};

const INFO: InfoFace = {
  kind: "info",
  mast: "QBOT BRIEF",
  mark: "今日概览",
  chips: ["今日", "说明"],
  hero: "3",
  title: "三个入口：今日、对话、知识库",
  deck: "每天先看今日重点，随时切去对话追问，资料都沉淀在知识库。",
  points: [
    { n: "01", tag: "今日", text: "关注与推荐，按时间从新到旧" },
    { n: "02", tag: "对话", text: "QBot 默认常驻，多轮上下文" },
    { n: "03", tag: "知识库", text: "公开资料检索与快速阅读" },
  ],
  hint: "轻点阅读详情 ›",
};

const ENGLISH: EnglishFace = {
  kind: "english",
  mast: "DAILY SPOKEN ENGLISH",
  mark: "今日短语",
  chips: ["短语", "商务推进"],
  phrase: "get this over the line",
  meaning: "把快完成的事推过终点线",
  hook: "不是启动，是收尾落地。",
  exampleLabel: "EXAMPLE",
  example: "Let's get that over the line today, so marketing can schedule spend tonight.",
  note: "没有音频，也没有跟读打分。",
  hint: "轻点展开详解 ›",
};

export function publishedFace(cardId: string): InfoFace | EnglishFace | null {
  if (cardId === "00000000-0000-4000-8000-0000000000c1") return INFO;
  if (cardId === "00000000-0000-4000-8000-0000000000c2") return ENGLISH;
  return null;
}

export function CoverFace({
  cardId,
  surface,
  scheme,
  topInset,
  compact = false,
}: {
  cardId: string;
  surface: CoverSurface;
  scheme: Scheme;
  topInset: number;
  compact?: boolean;
}) {
  const face = publishedFace(cardId);
  if (!face) return null;
  const band = compact ? { paddingTop: 20, paddingBottom: 68 } : contentBand({ topInset });
  const colors = palette[scheme];
  return (
    <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}>
      {surface === "orange" ? (
        <View style={{ height: 4, width: "100%", backgroundColor: colors.accent }} />
      ) : null}
      <View style={{ flex: 1, paddingTop: band.paddingTop, paddingBottom: band.paddingBottom, paddingHorizontal: 20 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
          <Text style={{ color: colors.text2, fontSize: 12, lineHeight: 16, fontWeight: "700", letterSpacing: 1 }}>{face.mast}</Text>
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: "700" }}>{face.mark}</Text>
        </View>
        <View style={{ marginTop: 8, borderTopWidth: 2.5, borderTopColor: colors.text, paddingTop: 3, borderBottomWidth: 1, borderBottomColor: colors.text }} />
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          {face.chips.map((chip, index) => {
            const orangeChip = surface === "orange" && index === 0;
            const filledChip = index === 0;
            return (
              <Text
                key={chip}
                style={{
                  overflow: "hidden",
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: orangeChip ? colors.accent : colors.text,
                  backgroundColor: orangeChip ? colors.accent : filledChip ? colors.btnPrimaryBg : "transparent",
                  color: orangeChip ? "#1C1B19" : filledChip ? colors.btnPrimaryFg : colors.text,
                  fontSize: 12,
                  lineHeight: 16,
                  fontWeight: "700",
                  paddingHorizontal: 10,
                  paddingVertical: 3,
                }}
              >
                {chip}
              </Text>
            );
          })}
        </View>
        {face.kind === "info" ? (
          <InfoBody face={face} scheme={scheme} />
        ) : (
          <EnglishBody face={face} scheme={scheme} />
        )}
      </View>
    </View>
  );
}

function InfoBody({ face, scheme }: { face: InfoFace; scheme: Scheme }) {
  const colors = palette[scheme];
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ marginTop: 12, color: colors.text, fontSize: 44, lineHeight: 48, fontWeight: "700" }}>{face.hero}</Text>
      <Text style={{ marginTop: 6, color: colors.text, fontSize: 24, lineHeight: 32, fontWeight: "700" }}>{face.title}</Text>
      <Text style={{ marginTop: 8, color: colors.text2, fontSize: 15, lineHeight: 24 }}>{face.deck}</Text>
      <View style={{ marginTop: "auto", borderTopWidth: 1.5, borderTopColor: colors.text }}>
        {face.points.map((point) => (
          <View key={point.n} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, borderBottomColor: colors.line }}>
            <Text style={{ width: 24, color: colors.accentInk, fontSize: 12, lineHeight: 16, fontWeight: "700" }}>{point.n}</Text>
            <Text style={{ overflow: "hidden", backgroundColor: colors.selected, color: colors.text, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, fontSize: 12, lineHeight: 16, fontWeight: "700" }}>{point.tag}</Text>
            <Text style={{ flex: 1, color: colors.text, fontSize: 15, lineHeight: 22, fontWeight: "700" }} numberOfLines={1}>{point.text}</Text>
          </View>
        ))}
      </View>
      <View style={{ marginTop: 12, flexDirection: "row", justifyContent: "flex-end" }}>
        <Text style={{ color: colors.accentInk, fontSize: 13, lineHeight: 18, fontWeight: "700" }}>{face.hint}</Text>
      </View>
    </View>
  );
}

function EnglishBody({ face, scheme }: { face: EnglishFace; scheme: Scheme }) {
  const colors = palette[scheme];
  return (
    <View style={{ flex: 1 }}>
      <Text
        style={{
          marginTop: 16,
          color: scheme === "dark" ? colors.accentInk : colors.text,
          fontSize: 36,
          lineHeight: 42,
          fontWeight: "700",
        }}
      >
        {face.phrase}
      </Text>
      <Text style={{ marginTop: 10, color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: "700" }}>{face.meaning}</Text>
      <Text style={{ marginTop: 4, color: colors.text2, fontSize: 15, lineHeight: 22 }}>{face.hook}</Text>
      <View
        style={{
          marginTop: "auto",
          backgroundColor: colors.raised,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: colors.line,
          borderLeftWidth: 3.5,
          borderLeftColor: colors.accent,
          paddingHorizontal: 16,
          paddingVertical: 14,
        }}
      >
        <Text style={{ color: colors.accentInk, fontSize: 11, lineHeight: 16, fontWeight: "700", letterSpacing: 1 }}>{face.exampleLabel}</Text>
        <Text style={{ marginTop: 6, color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: "700" }}>{face.example}</Text>
      </View>
      <View style={{ marginTop: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 16 }}>{face.note}</Text>
        <Text style={{ color: colors.accentInk, fontSize: 13, lineHeight: 18, fontWeight: "700" }}>{face.hint}</Text>
      </View>
    </View>
  );
}
