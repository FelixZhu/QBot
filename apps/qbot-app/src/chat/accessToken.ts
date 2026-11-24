import { createServerClient } from "./serverClient.ts";
import { TOKEN_KEY, type SecretStore } from "./serverSession.ts";

export const UNAUTHORIZED_MESSAGE = "需要有效的访问令牌";
const TOKEN_PATTERN = /^[!-~]{16,256}$/;

export function isUnauthorizedMessage(message?: string | null): boolean {
  return (message ?? "").trim() === UNAUTHORIZED_MESSAGE;
}

export function normalizeToken(raw: string): string {
  const token = raw.trim();
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error("口令长度需在 16–256 个可见字符之间");
  }
  return token;
}

export async function loadSavedToken(secrets: SecretStore): Promise<string> {
  try {
    const saved = (await secrets.get(TOKEN_KEY))?.trim() ?? "";
    return TOKEN_PATTERN.test(saved) ? saved : "";
  } catch {
    return "";
  }
}

export async function verifyAndSaveToken(input: {
  origin: string;
  rawToken: string;
  secrets: SecretStore;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const token = normalizeToken(input.rawToken);
  const client = createServerClient({ origin: input.origin, token, fetchImpl: input.fetchImpl });
  await client.session();
  await input.secrets.set(TOKEN_KEY, token);
  return token;
}

export async function clearSavedToken(secrets: SecretStore): Promise<void> {
  try {
    await secrets.remove(TOKEN_KEY);
  } catch {
    // Ignore secure store errors on removal so the in-memory token still clears.
  }
}

export type CacheStorageLike = {
  getAllKeys(): Promise<readonly string[]>;
  multiRemove(keys: readonly string[]): Promise<void>;
};

const CACHE_PREFIXES = ["qbot.feed.cache.v1.", "qbot.chat.thread.", "qbot.chat.lastThread"] as const;

export async function clearClientCaches(storage: CacheStorageLike): Promise<void> {
  try {
    const keys = await storage.getAllKeys();
    const doomed = keys.filter((key) => CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)));
    if (doomed.length > 0) await storage.multiRemove(doomed);
  } catch {
    // Cache cleanup is best-effort.
  }
}
