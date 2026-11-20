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
