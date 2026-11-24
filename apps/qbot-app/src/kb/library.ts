import { filterKbFiles, type KbEntry } from "./indexFilter.ts";

export const LIBRARY_HOME_URL = "https://felixzhu.github.io/QBot/";
export const LIBRARY_INDEX_URL = `${LIBRARY_HOME_URL}index.json`;

export type LibraryItem = KbEntry & {
  key: string;
  name: string;
  kind: string;
  doc_type: string;
  type?: string;
  size: number;
  mtime: number;
  dir: string;
  summary: string;
  tags: string[];
  private?: boolean;
};

export type LibraryIndex = {
  base: string;
  files: LibraryItem[];
};

const DIR_LABEL: Record<string, string> = {
  reports: "报告",
  videos: "视频",
  bilibili: "B站视频",
  xiaoyuzhou: "小宇宙播客",
  xhs: "小红书",
  docs: "文档",
};

function isHashSegment(segment: string): boolean {
  return /^[0-9a-f]{8,}$/i.test(segment);
}

export function visibleDirParts(dir?: string): string[] {
  return String(dir ?? "")
    .split("/")
    .filter(Boolean)
    .filter((part) => !isHashSegment(part));
}

export function formatDir(dir?: string): string {
  const parts = visibleDirParts(dir);
  if (parts.length === 0) return dir ? "其他" : "根目录";
  return parts
    .map((part) => (DIR_LABEL[part] ? `${part} · ${DIR_LABEL[part]}` : part))
    .join(" / ");
}

export function topCategory(item: Pick<LibraryItem, "dir">): string {
  const first = visibleDirParts(item.dir)[0];
  if (!first) return "其他";
  return DIR_LABEL[first] ?? first;
}

export function formatFileSize(bytes?: number): string {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatMtime(ts?: number, nowMs = Date.now()): string {
  if (!ts || !Number.isFinite(ts)) return "";
  const date = new Date(ts * 1000);
  const now = new Date(nowMs);
  const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  if (date.getUTCFullYear() === now.getUTCFullYear()) return `${mm}-${dd}`;
  return `${date.getUTCFullYear()}-${mm}-${dd}`;
}

export function safeFileUrl(base: string, key: string): string {
  if (!base || !key) return "";
  const segments = key.split("/");
  if (segments.some((seg) => seg === "." || seg === "..")) return "";
  const encoded = segments.map((seg) => encodeURIComponent(seg)).join("/");
  let probe: URL;
  try {
    probe = new URL(base.trim());
  } catch {
    return "";
  }
  if (probe.protocol !== "http:" && probe.protocol !== "https:") return "";
  if (probe.username || probe.password || probe.search || probe.hash) return "";
  const cleanPath = probe.pathname.replace(/\/+$/, "");
  return `${probe.origin}${cleanPath}/${encoded}`;
}

export function isTextFile(item: Pick<LibraryItem, "key" | "name" | "type">): boolean {
  const name = `${item.name || item.key}`.toLowerCase();
  if (name.endsWith(".md") || name.endsWith(".markdown") || name.endsWith(".txt")) return true;
  return typeof item.type === "string" && item.type.startsWith("text/");
}

export function parseLibraryIndex(raw: unknown): LibraryIndex {
  if (!raw || typeof raw !== "object") throw new Error("索引格式无法识别");
  const record = raw as { base?: unknown; files?: unknown };
  const base = typeof record.base === "string" ? record.base.trim() : "";
  if (!Array.isArray(record.files)) throw new Error("索引缺少文件列表");
  const normalized: LibraryItem[] = [];
  for (const entry of record.files) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Partial<LibraryItem>;
    if (item.private === true) continue;
    if (typeof item.key !== "string" || !item.key) continue;
    const name = typeof item.name === "string" && item.name.trim()
      ? item.name.trim()
      : item.key.split("/").pop() || item.key;
    normalized.push({
      key: item.key,
      name,
      kind: typeof item.kind === "string" && item.kind ? item.kind : "file",
      doc_type: typeof item.doc_type === "string" && item.doc_type ? item.doc_type : "文件",
      type: typeof item.type === "string" ? item.type : undefined,
      size: typeof item.size === "number" && Number.isFinite(item.size) ? item.size : 0,
      mtime: typeof item.mtime === "number" && Number.isFinite(item.mtime) ? item.mtime : 0,
      dir: typeof item.dir === "string" ? item.dir : "",
      summary: typeof item.summary === "string" ? item.summary : "",
      tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag)).filter(Boolean) : [],
      private: false,
    });
  }
  const filtered = filterKbFiles(normalized);
  filtered.sort((a, b) => (b.mtime - a.mtime) || a.name.localeCompare(b.name));
  return { base, files: filtered };
}

export function listCategories(items: readonly LibraryItem[]): string[] {
  const seen = new Set<string>();
  const cats: string[] = [];
  for (const item of items) {
    const cat = topCategory(item);
    if (!seen.has(cat)) {
      seen.add(cat);
      cats.push(cat);
    }
  }
  return ["全部", ...cats];
}

export function filterLibraryItems(items: readonly LibraryItem[], query: string, category: string): LibraryItem[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (category && category !== "全部" && topCategory(item) !== category) return false;
    if (terms.length === 0) return true;
    const haystack = [
      item.name,
      item.summary,
      item.doc_type,
      item.dir,
      formatDir(item.dir),
      ...item.tags,
    ].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export async function fetchLibraryIndex(options?: {
  url?: string;
  fetchImpl?: typeof fetch;
}): Promise<LibraryIndex> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const url = options?.url ?? LIBRARY_INDEX_URL;
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  } catch {
    throw new Error("无法加载知识库索引");
  }
  if (!response.ok) throw new Error(`知识库索引返回 HTTP ${response.status}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("索引格式无法识别");
  }
  return parseLibraryIndex(body);
}
