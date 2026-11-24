import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";
import {
  fetchLibraryIndex,
  filterLibraryItems,
  formatDir,
  formatFileSize,
  formatMtime,
  isTextFile,
  listCategories,
  parseLibraryIndex,
  safeFileUrl,
  type LibraryIndex,
  type LibraryItem,
} from "./kb/library";
import type { Palette, Scheme } from "./theme";

export const HOME_URL = "https://felixzhu.github.io/QBot/";

const CACHE_KEY = "qbot.kb.index.v1";

export function LibraryPane({
  active,
  colors,
  scheme,
  split,
  listWidth,
  onBackReady,
  onExternal,
}: {
  active: boolean;
  colors: Palette;
  scheme: Scheme;
  split: boolean;
  listWidth: number;
  onBackReady: (back: () => boolean) => void;
  onExternal: (url: string) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [index, setIndex] = useState<LibraryIndex>({ base: "", files: [] });
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewPhase, setPreviewPhase] = useState<"idle" | "loading" | "error">("idle");
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    setPhase("loading");
    setError("");
    try {
      const fresh = await fetchLibraryIndex();
      setIndex(fresh);
      setPhase("ready");
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(fresh)).catch(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : "无法加载知识库索引";
      const cached = await readCachedIndex();
      if (cached && cached.files.length > 0) {
        setIndex(cached);
        setPhase("ready");
        setError("已保存的索引，可能不是最新");
        return;
      }
      setError(msg);
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    if (!active || loadedOnce.current) return;
    loadedOnce.current = true;
    void load();
  }, [active, load]);

  const back = useCallback(() => {
    if (!selected) return false;
    setSelected(null);
    return true;
  }, [selected]);

  useEffect(() => {
    onBackReady(back);
  }, [back, onBackReady]);

  useEffect(() => {
    if (!selected || !isTextFile(selected)) {
      setPreviewText(null);
      setPreviewPhase("idle");
      return;
    }
    const url = safeFileUrl(index.base, selected.key);
    if (!url) {
      setPreviewText(null);
      setPreviewPhase("error");
      return;
    }
    let alive = true;
    setPreviewPhase("loading");
    setPreviewText(null);
    void fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (!alive) return;
        setPreviewText(text.slice(0, 60_000));
        setPreviewPhase("idle");
      })
      .catch(() => {
        if (!alive) return;
        setPreviewPhase("error");
      });
    return () => { alive = false; };
  }, [index.base, selected]);

  const categories = useMemo(() => listCategories(index.files), [index.files]);
  const filtered = useMemo(
    () => filterLibraryItems(index.files, query, category),
    [category, index.files, query],
  );

  const showList = split || !selected;
  const showDetail = split || Boolean(selected);

  return (
    <View
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      style={{
        flex: 1,
        backgroundColor: colors.canvas,
        flexDirection: split ? "row" : "column",
      }}
    >
      {showList ? (
        <View
          style={split
            ? { width: listWidth, borderRightWidth: 1, borderRightColor: colors.line, backgroundColor: colors.canvas }
            : { flex: 1, backgroundColor: colors.canvas }}
        >
          <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 22, lineHeight: 28, fontWeight: "700", color: colors.text }}>知识库</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              {phase === "ready" ? (
                <Text style={{ fontSize: 13, color: colors.muted }}>{index.files.length} 项</Text>
              ) : null}
              <Pressable accessibilityRole="button" accessibilityLabel="刷新知识库" onPress={() => void load()} hitSlop={8}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.accentInk }}>刷新</Text>
              </Pressable>
            </View>
          </View>

          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg, paddingHorizontal: 12, height: 40 }}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="搜索名称、摘要、标签"
                placeholderTextColor={colors.muted}
                accessibilityLabel="搜索知识库"
                returnKeyType="search"
                style={{ flex: 1, fontSize: 14, color: colors.text, paddingVertical: 0 }}
              />
              {query.length > 0 ? (
                <Pressable accessibilityRole="button" accessibilityLabel="清空搜索" onPress={() => setQuery("")} hitSlop={8}>
                  <Text style={{ fontSize: 13, color: colors.muted }}>清空</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {categories.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 10, gap: 8 }}
              style={{ flexGrow: 0 }}
            >
              {categories.map((cat) => {
                const current = category === cat;
                return (
                  <Pressable
                    key={cat}
                    accessibilityRole="button"
                    accessibilityState={{ selected: current }}
                    onPress={() => setCategory(cat)}
                    style={{
                      height: 30,
                      paddingHorizontal: 12,
                      borderRadius: 15,
                      backgroundColor: current ? colors.text : colors.bg,
                      borderWidth: 1,
                      borderColor: current ? colors.text : colors.line,
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: current ? "700" : "400", color: current ? colors.bg : colors.text }}>
                      {cat}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          <View style={{ paddingHorizontal: 16, paddingBottom: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted }}>最近更新</Text>
            {error && phase === "ready" ? (
              <Text style={{ fontSize: 12, color: colors.muted }}>{error}</Text>
            ) : null}
          </View>

          {phase === "loading" && index.files.length === 0 ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
              <Text style={{ color: colors.muted, fontSize: 14 }}>正在加载知识库</Text>
            </View>
          ) : phase === "error" && index.files.length === 0 ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
              <Text style={{ color: colors.text, fontSize: 15, textAlign: "center" }}>{error || "无法加载知识库索引"}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="重试"
                onPress={() => void load()}
                style={{ marginTop: 14, minHeight: 40, paddingHorizontal: 18, justifyContent: "center" }}
              >
                <Text style={{ color: colors.accentInk, fontSize: 15, fontWeight: "700" }}>重试</Text>
              </Pressable>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.key}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 10 }}
              ListEmptyComponent={
                <View style={{ paddingVertical: 32, alignItems: "center" }}>
                  <Text style={{ color: colors.muted, fontSize: 14 }}>没有匹配条目</Text>
                </View>
              }
              renderItem={({ item }) => {
                const isSelected = selected?.key === item.key;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={item.name}
                    onPress={() => setSelected(item)}
                    style={({ pressed }) => ({
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: isSelected ? colors.accentInk : colors.line,
                      backgroundColor: isSelected ? colors.selected : pressed ? colors.press : colors.bg,
                      padding: 14,
                    })}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: "700",
                          color: colors.accentInk,
                          backgroundColor: colors.canvas,
                          paddingHorizontal: 7,
                          paddingVertical: 2,
                          borderRadius: 6,
                          overflow: "hidden",
                        }}
                      >
                        {item.doc_type}
                      </Text>
                      <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
                        {formatDir(item.dir)}
                      </Text>
                      <Text style={{ marginLeft: "auto", fontSize: 12, color: colors.muted }}>
                        {formatMtime(item.mtime)}
                      </Text>
                    </View>
                    <Text style={{ marginTop: 6, fontSize: 15, lineHeight: 21, fontWeight: "700", color: colors.text }} numberOfLines={2}>
                      {item.name}
                    </Text>
                    {item.summary ? (
                      <Text style={{ marginTop: 4, fontSize: 13, lineHeight: 19, color: colors.muted }} numberOfLines={2}>
                        {item.summary}
                      </Text>
                    ) : null}
                    <View style={{ marginTop: 8, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                      <Text style={{ fontSize: 12, color: colors.muted }}>{formatFileSize(item.size)}</Text>
                      {item.tags.slice(0, 4).map((tag) => (
                        <Text
                          key={tag}
                          style={{
                            fontSize: 11,
                            color: colors.muted,
                            borderWidth: 1,
                            borderColor: colors.line,
                            borderRadius: 8,
                            paddingHorizontal: 6,
                            paddingVertical: 1,
                          }}
                        >
                          {tag}
                        </Text>
                      ))}
                    </View>
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      ) : null}

      {showDetail ? (
        <View style={{ flex: 1, minWidth: 0, backgroundColor: colors.bg }}>
          {selected ? (
            <LibraryDetail
              item={selected}
              base={index.base}
              colors={colors}
              scheme={scheme}
              showBack={!split}
              previewText={previewText}
              previewPhase={previewPhase}
              onBack={() => setSelected(null)}
              onExternal={onExternal}
            />
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
              <Text style={{ fontSize: 15, color: colors.muted }}>点选一条知识库内容查看详情</Text>
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

function LibraryDetail({
  item,
  base,
  colors,
  scheme,
  showBack,
  previewText,
  previewPhase,
  onBack,
  onExternal,
}: {
  item: LibraryItem;
  base: string;
  colors: Palette;
  scheme: Scheme;
  showBack: boolean;
  previewText: string | null;
  previewPhase: "idle" | "loading" | "error";
  onBack: () => void;
  onExternal: (url: string) => void;
}) {
  const url = safeFileUrl(base, item.key);
  const textLike = isTextFile(item);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ height: 48, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: colors.line }}>
        {showBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回知识库列表"
            onPress={onBack}
            style={{ minWidth: 56, minHeight: 40, justifyContent: "center", paddingHorizontal: 6 }}
          >
            <Text style={{ color: colors.accentInk, fontSize: 15, fontWeight: "700" }}>返回</Text>
          </Pressable>
        ) : null}
        <Text style={{ flex: 1, fontSize: 15, fontWeight: "700", color: colors.text }} numberOfLines={1}>
          {item.name}
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 12 }}>
        <Text style={{ fontSize: 20, lineHeight: 28, fontWeight: "700", color: colors.text }}>{item.name}</Text>
        <Text style={{ fontSize: 13, color: colors.muted }}>
          {item.doc_type} · {formatDir(item.dir)} · {formatFileSize(item.size)} · {formatMtime(item.mtime)}
        </Text>
        {item.summary ? (
          <Text style={{ fontSize: 15, lineHeight: 22, color: colors.text }}>{item.summary}</Text>
        ) : null}
        {item.tags.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {item.tags.map((tag) => (
              <Text
                key={tag}
                style={{
                  fontSize: 12,
                  color: colors.text,
                  backgroundColor: colors.canvas,
                  borderRadius: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  overflow: "hidden",
                }}
              >
                {tag}
              </Text>
            ))}
          </View>
        ) : null}
        {url ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="打开原文件"
            onPress={() => onExternal(url)}
            style={{
              marginTop: 4,
              alignSelf: "flex-start",
              height: 42,
              paddingHorizontal: 20,
              borderRadius: 21,
              backgroundColor: colors.accentInk,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.bg }}>打开原文件</Text>
          </Pressable>
        ) : null}
        {textLike ? (
          <View style={{ marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line }}>
            {previewPhase === "loading" ? (
              <Text style={{ color: colors.muted, fontSize: 14 }}>正在加载正文...</Text>
            ) : previewPhase === "error" ? (
              <Text style={{ color: colors.muted, fontSize: 14 }}>正文未能直接加载，可点上方「打开原文件」。</Text>
            ) : previewText ? (
              <EnrichedMarkdownText
                markdown={previewText}
                flavor="github"
                selectable
                markdownStyle={{
                  paragraph: { color: colors.text, fontSize: 15, lineHeight: 24 },
                  h1: { color: colors.text, fontSize: 21, lineHeight: 28 },
                  h2: { color: colors.text, fontSize: 18, lineHeight: 26 },
                  h3: { color: colors.text, fontSize: 16, lineHeight: 24 },
                  list: { color: colors.text, fontSize: 15, lineHeight: 24 },
                  link: { color: colors.accentInk, underline: true },
                  code: {
                    fontSize: 13,
                    backgroundColor: scheme === "dark" ? "#21201D" : "#EFEAE0",
                    color: colors.text,
                    borderColor: "transparent",
                  },
                  codeBlock: {
                    fontSize: 13,
                    lineHeight: 20,
                    backgroundColor: scheme === "dark" ? "#21201D" : "#EFEAE0",
                    color: colors.text,
                    borderWidth: 0,
                    borderColor: "transparent",
                  },
                }}
                onLinkPress={({ url: linkUrl }) => {
                  if (linkUrl && (linkUrl.startsWith("https://") || linkUrl.startsWith("http://"))) {
                    onExternal(linkUrl);
                  }
                }}
              />
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

async function readCachedIndex(): Promise<LibraryIndex | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return parseLibraryIndex(JSON.parse(raw));
  } catch {
    return null;
  }
}
