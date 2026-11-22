export type FeedCard = {
  id: string;
  title: string;
  publishedAt: string;
  visibility: "public" | "followers";
  provenance: "manual";
  artifactId: string;
  artifactVersion: number;
  manifestSha256: string;
  coverPath: string;
  bot: { id: string; slug: string; displayName: string; followed: boolean };
};

export type FeedPage = { cards: FeedCard[]; next: string | null };

export type BotProfile = {
  id: string;
  slug: string;
  displayName: string;
  visibility: "public" | "private";
  bio: string;
  followed: boolean;
};

export type Capability = {
  token: string;
  expiresAt: string;
  artifactId: string;
  version: number;
  files: { path: string; contentType: string; sha256: string; role: string }[];
};

export type FeedScope = "following" | "recommended";

export type FeedPresentation =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "cached"; message: string }
  | { kind: "ready" };

const SAFE = new Set(["无法连接服务器", "需要有效的访问令牌", "请求太频繁", "这一版没有带上服务器地址"]);

/** What the feed may show. A failure never invents cards. */
export function presentFeed(input: { phase: "loading" | "ready" | "error"; count: number; cached: boolean; message?: string }): FeedPresentation {
  if (input.phase === "loading" && input.count === 0) return { kind: "loading" };
  if (input.phase === "error" && input.cached && input.count > 0) return { kind: "cached", message: "已保存的内容，可能不是最新" };
  if (input.phase === "error") return { kind: "error", message: SAFE.has(input.message ?? "") ? input.message ?? "无法连接服务器" : "无法连接服务器" };
  if (input.count === 0) return { kind: "empty" };
  return { kind: "ready" };
}

export function formatPublished(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("month")}-${read("day")} ${read("hour")}:${read("minute")}`;
}

/** Phone width uses the window. A fold keeps the column at 480. */
export function feedColumnWidth(windowWidth: number): number {
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) return 0;
  if (windowWidth < 600) return Math.round(windowWidth);
  return Math.min(480, Math.round(windowWidth));
}

/** The token stays in the directory, so a relative CSS or image URL keeps it. */
export function artifactUrl(origin: string, artifactId: string, version: number, token: string, relPath: string): string {
  const encoded = relPath.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `${origin}/v1/artifacts/${artifactId}/v/${version}/${token}/files/${encoded}`;
}

export function createFeedClient(options: { origin: string; token?: string; fetchImpl?: typeof fetch }) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const call = async (path: string, init?: RequestInit): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetchImpl(`${options.origin}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch {
      throw new Error("无法连接服务器");
    }
    const text = await response.text();
    if (!response.ok) throw new Error(messageOf(response.status, text));
    try {
      return text ? JSON.parse(text) as unknown : {};
    } catch {
      throw new Error("无法连接服务器");
    }
  };
  return {
    async feed(scope: FeedScope, cursor?: string | null): Promise<FeedPage> {
      const url = new URL(`${options.origin}/v1/feed`);
      url.searchParams.set("scope", scope);
      url.searchParams.set("limit", "20");
      if (cursor) url.searchParams.set("cursor", cursor);
      const body = await call(`${url.pathname}${url.search}`) as { cards?: unknown; next?: unknown };
      const cards = Array.isArray(body.cards) ? body.cards.map(parseCard) : [];
      return { cards, next: typeof body.next === "string" ? body.next : null };
    },
    async bot(id: string): Promise<BotProfile> {
      return parseBot(await call(`/v1/bots/${id}`));
    },
    async botBySlug(slug: string): Promise<BotProfile> {
      return parseBot(await call(`/v1/bots/by-slug/${encodeURIComponent(slug)}`));
    },
    async setFollow(id: string, followed: boolean): Promise<BotProfile> {
      return parseBot(await call(`/v1/bots/${id}/follow`, { method: followed ? "POST" : "DELETE", body: "{}" }));
    },
    async capability(cardId: string): Promise<Capability> {
      const body = await call(`/v1/cards/${cardId}/capability`, { method: "POST", body: "{}" }) as Partial<Capability>;
      if (!body.token || !body.artifactId || typeof body.version !== "number" || !Array.isArray(body.files)) throw new Error("无法连接服务器");
      return { token: body.token, expiresAt: body.expiresAt ?? "", artifactId: body.artifactId, version: body.version, files: body.files };
    },
  };
}

function parseCard(value: unknown): FeedCard {
  const card = value as Partial<FeedCard>;
  const bot = card.bot;
  if (!card.id || !card.title || !card.publishedAt || !card.artifactId || !card.coverPath || card.provenance !== "manual" || typeof card.artifactVersion !== "number" || !bot?.id || !bot.displayName) {
    throw new Error("无法连接服务器");
  }
  return {
    id: card.id,
    title: card.title,
    publishedAt: card.publishedAt,
    visibility: card.visibility === "followers" ? "followers" : "public",
    provenance: "manual",
    artifactId: card.artifactId,
    artifactVersion: card.artifactVersion,
    manifestSha256: card.manifestSha256 ?? "",
    coverPath: card.coverPath,
    bot: { id: bot.id, slug: bot.slug ?? "", displayName: bot.displayName, followed: Boolean(bot.followed) },
  };
}

function parseBot(value: unknown): BotProfile {
  const bot = value as Partial<BotProfile>;
  if (!bot.id || !bot.displayName || typeof bot.followed !== "boolean") throw new Error("无法连接服务器");
  return {
    id: bot.id,
    slug: bot.slug ?? "",
    displayName: bot.displayName,
    visibility: bot.visibility === "public" ? "public" : "private",
    bio: bot.bio ?? "",
    followed: bot.followed,
  };
}

function messageOf(status: number, text: string): string {
  try {
    const body = JSON.parse(text) as { error?: { message?: string } };
    const message = body.error?.message;
    if (message && SAFE.has(message)) return message;
  } catch {
    // Use the generic line.
  }
  if (status === 401) return "需要有效的访问令牌";
  return "无法连接服务器";
}
