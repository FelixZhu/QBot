import { Text, View } from "react-native";
import type { Scheme } from "../theme";
import { contentBand, type CoverSurface } from "./immersive";

/** Published cover words. The native row owns the avatar, follow control, and time. */
export type InfoFace = {
  kind: "info";
  mast: string;
  mark: string;
  chips: string[];
  hero: string;
  title: string;
  deck: string;
  points: { n: string; tag: string; text: string }[];
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
};

const INFO: InfoFace = {
  kind: "info",
  mast: "QBOT BRIEF",
  mark: "手写",
  chips: ["手写", "说明"],
  hero: "3",
  title: "三个入口：今日、对话、知识库",
  deck: "这一张是项目说明，不是新闻。数字只描述这个应用。",
  points: [
    { n: "01", tag: "今日", text: "关注与推荐，按时间从新到旧" },
    { n: "02", tag: "对话", text: "只有 Qbot，会话都在里面" },
    { n: "03", tag: "知识库", text: "仍是原来的库" },
  ],
};

const ENGLISH: EnglishFace = {
  kind: "english",
  mast: "DAILY SPOKEN ENGLISH",
  mark: "手写",
  chips: ["手写", "短语"],
  phrase: "get this over the line",
  meaning: "把快完成的事推过终点线",
  hook: "不是启动，是收尾。",
  exampleLabel: "EXAMPLE",
  example: "Let's get that over the line today, so marketing can schedule spend tonight.",
  note: "没有音频，也没有跟读打分。",
};

export function publishedFace(cardId: string): InfoFace | EnglishFace | null {
  if (cardId === "00000000-0000-4000-8000-0000000000c1") return INFO;
  if (cardId === "00000000-0000-4000-8000-0000000000c2") return ENGLISH;
  return null;
}

type Ink = { ink: string; quiet: string; chip: string; onChip: string; line: string };

function inks(surface: CoverSurface, scheme: Scheme): Ink {
  if (surface === "paper" && scheme === "dark") {
    return { ink: "#EDE8DF", quiet: "#ABA498", chip: "#EDE8DF", onChip: "#171614", line: "rgba(237,232,223,0.28)" };
  }
  return { ink: "#1C1B19", quiet: "#4A463E", chip: "#1C1B19", onChip: surface === "orange" ? "#F3EFE7" : "#F3EFE7", line: "rgba(28,27,25,0.22)" };
}

export function CoverFace({
  cardId,
  surface,
  scheme,
  topInset,
}: {
  cardId: string;
  surface: CoverSurface;
  scheme: Scheme;
  topInset: number;
}) {
  const face = publishedFace(cardId);
  if (!face) return null;
  const band = contentBand({ topInset });
  const color = inks(surface, scheme);
  return (
    <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, paddingTop: band.paddingTop, paddingBottom: band.paddingBottom, paddingHorizontal: 20 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Text style={{ color: color.ink, fontSize: 12, fontWeight: "800", letterSpacing: 1 }}>{face.mast}</Text>
        <Text style={{ color: color.ink, fontSize: 12, fontWeight: "700" }}>{face.mark}</Text>
      </View>
      <View style={{ marginTop: 8, borderTopWidth: 3, borderTopColor: color.ink, paddingTop: 3, borderBottomWidth: 1, borderBottomColor: color.ink }} />
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        {face.chips.map((chip, index) => (
          <Text key={chip} style={{ overflow: "hidden", borderRadius: 12, borderWidth: 1.5, borderColor: color.chip, backgroundColor: index === 0 ? color.chip : "transparent", color: index === 0 ? color.onChip : color.ink, fontSize: 12, fontWeight: "700", paddingHorizontal: 10, paddingVertical: 3 }}>{chip}</Text>
        ))}
      </View>
      {face.kind === "info" ? <InfoBody face={face} color={color} /> : <EnglishBody face={face} color={color} />}
    </View>
  );
}

function InfoBody({ face, color }: { face: InfoFace; color: Ink }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ marginTop: 4, color: color.ink, fontSize: 72, lineHeight: 68, fontWeight: "900" }}>{face.hero}</Text>
      <Text style={{ color: color.ink, fontSize: 28, lineHeight: 36, fontWeight: "800" }}>{face.title}</Text>
      <Text style={{ marginTop: 8, color: color.quiet, fontSize: 15, lineHeight: 22 }}>{face.deck}</Text>
      <View style={{ marginTop: "auto", borderTopWidth: 2, borderTopColor: color.ink }}>
        {face.points.map((point) => (
          <View key={point.n} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, borderBottomColor: color.line }}>
            <Text style={{ width: 24, color: color.ink, fontSize: 12, fontWeight: "700" }}>{point.n}</Text>
            <Text style={{ overflow: "hidden", backgroundColor: color.chip, color: color.onChip, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, fontSize: 12, fontWeight: "700" }}>{point.tag}</Text>
            <Text style={{ flex: 1, color: color.ink, fontSize: 15, lineHeight: 20, fontWeight: "700" }}>{point.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function EnglishBody({ face, color }: { face: EnglishFace; color: Ink }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ marginTop: 12, color: color.ink, fontSize: 40, lineHeight: 44, fontWeight: "800" }}>{face.phrase}</Text>
      <Text style={{ marginTop: 10, color: color.ink, fontSize: 22, lineHeight: 28, fontWeight: "800" }}>{face.meaning}</Text>
      <Text style={{ marginTop: 4, color: color.ink, fontSize: 15, lineHeight: 22, opacity: 0.8 }}>{face.hook}</Text>
      <View style={{ marginTop: "auto", backgroundColor: "#F3EFE7", borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14 }}>
        <Text style={{ color: color.ink, fontSize: 11, fontWeight: "700", letterSpacing: 1 }}>{face.exampleLabel}</Text>
        <Text style={{ marginTop: 6, color: "#1C1B19", fontSize: 17, lineHeight: 24, fontWeight: "700" }}>{face.example}</Text>
      </View>
      <Text style={{ marginTop: 12, color: color.ink, fontSize: 13, lineHeight: 18 }}>{face.note}</Text>
    </View>
  );
}
