import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import type { Palette } from "../theme";
import { clipboardAvailable, copyText } from "./copyText";
import { openableHref, parseMarkdown, type Inline } from "./markdown";

const mono = Platform.select({ ios: "Menlo", default: "monospace" });

function InlineRun({ inlines, color, fontSize, lineHeight }: { inlines: Inline[]; color: string; fontSize: number; lineHeight: number }) {
  return (
    <Text selectable style={{ color, fontSize, lineHeight }}>
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

function CodeBlock({ language, code, colors }: { language: string; code: string; colors: Palette }) {
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
      <Text selectable style={{ fontFamily: mono, fontSize: 13, lineHeight: 20, color: colors.text, padding: 10 }}>
        {code}
      </Text>
    </View>
  );
}

export function MarkdownBody({ text, colors }: { text: string; colors: Palette }) {
  const blocks = parseMarkdown(text);
  if (blocks.length === 0) return null;
  return (
    <View>
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === "code") return <CodeBlock key={key} language={block.language} code={block.code} colors={colors} />;
        if (block.type === "heading") {
          const size = block.level === 1 ? 22 : block.level === 2 ? 18 : 16;
          return (
            <View key={key} style={{ marginTop: index === 0 ? 0 : 10 }}>
              <InlineRun inlines={block.inlines} color={colors.text} fontSize={size} lineHeight={size + 8} />
            </View>
          );
        }
        if (block.type === "list") {
          return (
            <View key={key} style={{ marginTop: index === 0 ? 0 : 8, gap: 4 }}>
              {block.items.map((item, itemIndex) => (
                <View key={itemIndex} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                  <Text selectable style={{ width: 22, color: colors.muted, fontSize: 16, lineHeight: 24 }}>
                    {block.ordered ? `${itemIndex + 1}.` : "·"}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <InlineRun inlines={item} color={colors.text} fontSize={16} lineHeight={24} />
                  </View>
                </View>
              ))}
            </View>
          );
        }
        return (
          <View key={key} style={{ marginTop: index === 0 ? 0 : 8 }}>
            <InlineRun inlines={block.inlines} color={colors.text} fontSize={16} lineHeight={24} />
          </View>
        );
      })}
    </View>
  );
}
