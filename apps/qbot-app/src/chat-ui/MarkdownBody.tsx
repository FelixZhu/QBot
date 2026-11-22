import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import type { Palette } from "../theme";
import { clipboardAvailable, copyText } from "./copyText";
import { openableHref, parseMarkdown, type Inline } from "./markdown";

const mono = Platform.select({ ios: "Menlo", default: "monospace" });

export type ReadingStyle = {
  fontSize: number;
  lineHeight: number;
  fontFamily?: string;
  selectionColor?: string;
};

const DEFAULT_READING: ReadingStyle = { fontSize: 16, lineHeight: 24 };

function InlineRun({ inlines, color, reading }: { inlines: Inline[]; color: string; reading: ReadingStyle }) {
  return (
    <Text selectable selectionColor={reading.selectionColor} style={{ color, fontSize: reading.fontSize, lineHeight: reading.lineHeight, fontFamily: reading.fontFamily }}>
      {inlines.map((part, index) => {
        if (part.type === "strong") {
          return <Text key={index} style={{ fontWeight: "700" }}>{part.text}</Text>;
        }
        if (part.type === "em") {
          return <Text key={index} style={{ fontStyle: "italic" }}>{part.text}</Text>;
        }
        if (part.type === "code") {
          return <Text key={index} style={{ fontFamily: mono }}>{part.text}</Text>;
        }
        if (part.type === "link") {
          const href = openableHref(part.href);
          if (!href) return <Text key={index}>{part.text}</Text>;
          return (
            <Text
              key={index}
              style={{ textDecorationLine: "underline" }}
              onPress={() => { Linking.openURL(href).catch(() => {}); }}
              accessibilityRole="link"
            >
              {part.text || href}
            </Text>
          );
        }
        return <Text key={index}>{part.text}</Text>;
      })}
    </Text>
  );
}

function CodeBlock({ language, code, colors }: { language: string; code: string; colors: Palette & { selection?: string } }) {
  const [copied, setCopied] = useState(false);
  const canCopy = clipboardAvailable();
  useEffect(() => { setCopied(false); }, [code]);
  return (
    <View style={{ marginTop: 8, borderWidth: 1, borderColor: colors.line, borderRadius: 10, backgroundColor: colors.raised, overflow: "hidden" }}>
      <View style={{ minHeight: 32, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.line }}>
        <Text style={{ fontSize: 12, lineHeight: 16, color: colors.muted }}>{language || "代码"}</Text>
        {canCopy ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copied ? "已复制代码" : "复制代码"}
            hitSlop={8}
            onPress={() => {
              copyText(code).then(() => setCopied(true), () => setCopied(false));
            }}
          >
            <Text style={{ fontSize: 12, lineHeight: 16, fontWeight: "600", color: colors.accent }}>{copied ? "已复制" : "复制"}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text selectable selectionColor={colors.selection} style={{ fontFamily: mono, fontSize: 13, lineHeight: 20, color: colors.text, padding: 10 }}>
        {code}
      </Text>
    </View>
  );
}

export function MarkdownBody({ text, colors, reading = DEFAULT_READING }: { text: string; colors: Palette; reading?: ReadingStyle }) {
  const blocks = parseMarkdown(text);
  if (blocks.length === 0) return null;
  const body = reading;
  return (
    <View>
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === "code") return <CodeBlock key={key} language={block.language} code={block.code} colors={{ ...colors, selection: reading.selectionColor }} />;
        if (block.type === "heading") {
          const size = block.level === 1 ? 22 : block.level === 2 ? 20 : 18;
          return (
            <View key={key} style={{ marginTop: index === 0 ? 0 : 14 }}>
              <InlineRun inlines={block.inlines} color={colors.text} reading={{ ...body, fontSize: size, lineHeight: Math.round(size * 1.45) }} />
            </View>
          );
        }
        if (block.type === "list") {
          return (
            <View key={key} style={{ marginTop: index === 0 ? 0 : 10, gap: 8 }}>
              {block.items.map((item, itemIndex) => (
                <View key={itemIndex} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                  <Text selectable selectionColor={body.selectionColor} style={{ width: 18, color: colors.text, fontSize: body.fontSize, lineHeight: body.lineHeight, fontFamily: body.fontFamily }}>
                    {block.ordered ? `${itemIndex + 1}.` : "•"}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <InlineRun inlines={item} color={colors.text} reading={body} />
                  </View>
                </View>
              ))}
            </View>
          );
        }
        return (
          <View key={key} style={{ marginTop: index === 0 ? 0 : 10 }}>
            <InlineRun inlines={block.inlines} color={colors.text} reading={body} />
          </View>
        );
      })}
    </View>
  );
}
