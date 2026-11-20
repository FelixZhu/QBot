import { createServerClient, type ServerClient, type ServerSession } from "./serverClient.ts";
import { parseServerOrigin } from "./serverEndpoint.ts";

export const TOKEN_KEY = "qbot.server.token";
export const URL_KEY = "qbot.server.url";
export const CONVERSATION_KEY = "qbot.server.conversation";

export type SecretStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

export type SettingsStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type ReadyConnection = {
  phase: "ready";
  origin: string;
  token: string;
  session: ServerSession;
  conversationId: string;
  client: ServerClient;
};

export type ConnectionView =
  | { phase: "unconfigured" }
  | { phase: "checking" }
  | { phase: "error"; message: string }
  | ReadyConnection;

const SETUP_PREFIX = "qbot1.";
const SETUP_CODE = /^[A-Za-z0-9_-]{43}$/;

/** One paste from the operator. It is not the long-lived owner token. */
export function parseSetupCode(input: string): { origin: string; code: string } {
  const trimmed = input.trim();
  if (!trimmed.startsWith(SETUP_PREFIX)) throw new Error("连接码无法识别");
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBase64Url(trimmed.slice(SETUP_PREFIX.length)));
  } catch {
    throw new Error("连接码无法识别");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("连接码无法识别");
  const record = parsed as { o?: unknown; c?: unknown };
  if (typeof record.o !== "string" || typeof record.c !== "string" || !SETUP_CODE.test(record.c)) {
    throw new Error("连接码无法识别");
  }
  return { origin: parseServerOrigin(record.o), code: record.c };
}

export async function enrollWithSetup(input: {
  secrets: SecretStore;
  settings: SettingsStore;
  setup: string;
  fetchImpl?: typeof fetch;
}): Promise<ReadyConnection> {
  const { origin, code } = parseSetupCode(input.setup);
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${origin}/v1/enroll`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
  } catch {
    throw new Error("无法连接服务器");
  }
  const text = await response.text();
  if (!response.ok) throw new Error(enrollError(response.status, text));
  let body: { token?: unknown };
  try {
    body = JSON.parse(text) as { token?: unknown };
  } catch {
    throw new Error("服务器返回了无法识别的响应");
  }
  if (typeof body.token !== "string" || body.token.length < 16) throw new Error("服务器没有发设备凭据");
  return connectServer({
    secrets: input.secrets,
    settings: input.settings,
    url: origin,
    token: body.token,
    fetchImpl,
  });
}

function decodeBase64Url(value: string): string {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const binary = globalThis.atob(value.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function enrollError(status: number, text: string): string {
  try {
    const body = JSON.parse(text) as { error?: { message?: string } };
    if (typeof body.error?.message === "string" && body.error.message) return body.error.message;
  } catch {
    // Keep a status-only message.
  }
  return `服务器返回 HTTP ${status}`;
}

export async function connectServer(input: {
  secrets: SecretStore;
  settings: SettingsStore;
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<ReadyConnection> {
  const origin = parseServerOrigin(input.url);
  const stored = (await input.secrets.get(TOKEN_KEY)) ?? "";
  const token = input.token.trim() || stored;
  if (token.length < 16) throw new Error("需要访问令牌");
  await input.secrets.set(TOKEN_KEY, token);
  await input.settings.setItem(URL_KEY, origin);
  return openStored(input.settings, origin, token, input.fetchImpl);
}

export async function restoreConnection(input: {
  secrets: SecretStore;
  settings: SettingsStore;
  fetchImpl?: typeof fetch;
}): Promise<ConnectionView> {
  const origin = await input.settings.getItem(URL_KEY);
  const token = await input.secrets.get(TOKEN_KEY);
  if (!origin || !token) return { phase: "unconfigured" };
  try {
    return await openStored(input.settings, origin, token, input.fetchImpl);
  } catch (error) {
    return { phase: "error", message: error instanceof Error ? error.message : "无法连接服务器" };
  }
}

export async function clearConnection(secrets: SecretStore, settings: SettingsStore): Promise<void> {
  await secrets.remove(TOKEN_KEY);
  await settings.removeItem(URL_KEY);
  await settings.removeItem(CONVERSATION_KEY);
}

async function openStored(
  settings: SettingsStore,
  origin: string,
  token: string,
  fetchImpl?: typeof fetch,
): Promise<ReadyConnection> {
  const client = createServerClient({ origin, token, fetchImpl });
  const session = await client.session();
  const conversations = await client.listConversations();
  const saved = await settings.getItem(CONVERSATION_KEY);
  const existing = conversations.find((item) => item.id === saved) ?? conversations[0];
  const conversationId = existing?.id ?? (await client.createConversation()).id;
  await settings.setItem(CONVERSATION_KEY, conversationId);
  return { phase: "ready", origin, token, session, conversationId, client };
}
