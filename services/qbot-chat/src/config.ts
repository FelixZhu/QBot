import { LIMITS } from "./limits.ts";

export const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash-1017";
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const PLACEHOLDER_TOKEN = "replace-with-a-long-random-token";
export const PLACEHOLDER_KEY = "replace-with-openrouter-key";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

export type Config = {
  databaseUrl: string;
  migrateUrl: string | null;
  accessToken: string;
  ownerId: string;
  openRouterApiKey: string;
  model: string;
  host: string;
  port: number;
  fixtureUpstream: boolean;
  fixtureUpstreamUrl: string | null;
  /** Explicit private-deploy switch. Unset stays on bearer auth. */
  personalOpen: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const databaseUrl = required(env, "DATABASE_URL");
  const personalOpen = env.QBOT_PERSONAL_OPEN === "1";
  const accessToken = (env.QBOT_ACCESS_TOKEN ?? "").trim();
  if (!personalOpen || accessToken) {
    if (!accessToken || accessToken === PLACEHOLDER_TOKEN || accessToken.length < LIMITS.tokenMin || accessToken.length > LIMITS.tokenMax || /\s/.test(accessToken)) {
      throw new Error("QBOT_ACCESS_TOKEN must be a non-placeholder token of 16 to 256 characters");
    }
  }
  const ownerId = required(env, "QBOT_OWNER_ID");
  if (!UUID.test(ownerId)) throw new Error("QBOT_OWNER_ID must be a UUID");
  const openRouterApiKey = required(env, "OPENROUTER_API_KEY");
  if (openRouterApiKey === PLACEHOLDER_KEY || openRouterApiKey.length < 8) {
    throw new Error("OPENROUTER_API_KEY must be set to a real server-side key, not the example placeholder");
  }
  const model = (env.OPENROUTER_MODEL ?? "").trim() || DEFAULT_MODEL;
  if (!/^[A-Za-z0-9._:@/+-]{1,128}$/.test(model)) throw new Error("OPENROUTER_MODEL is not a model id");
  const host = (env.HOST ?? "127.0.0.1").trim();
  if (!LOOPBACK.has(host)) throw new Error("HOST must be a loopback address. Terminate HTTPS in a local reverse proxy.");
  const port = env.PORT ? Number(env.PORT) : 8787;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT must be an integer from 0 to 65535");
  const fixtureUpstream = env.QBOT_FIXTURE_UPSTREAM === "1";
  const fixtureUpstreamUrl = (env.QBOT_FIXTURE_UPSTREAM_URL ?? "").trim() || null;
  if (fixtureUpstream) {
    if (!fixtureUpstreamUrl || !loopbackHttp(fixtureUpstreamUrl)) {
      throw new Error("QBOT_FIXTURE_UPSTREAM_URL must be an http URL on 127.0.0.1, localhost, or ::1");
    }
  } else if (fixtureUpstreamUrl) {
    throw new Error("QBOT_FIXTURE_UPSTREAM_URL is set without QBOT_FIXTURE_UPSTREAM=1");
  }
  return {
    databaseUrl,
    migrateUrl: (env.DATABASE_MIGRATE_URL ?? "").trim() || null,
    accessToken,
    ownerId,
    openRouterApiKey,
    model,
    host,
    port,
    fixtureUpstream,
    fixtureUpstreamUrl,
    personalOpen,
  };
}

export function assertNode24(): void {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 24 || (major === 24 && (minor ?? 0) < 9)) {
    throw new Error(`qbot-chat requires Node.js >= 24.9 for DeepSeek Harness, this process is ${process.versions.node}`);
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = (env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function loopbackHttp(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" || url.username || url.password) return false;
  return LOOPBACK.has(url.hostname);
}
