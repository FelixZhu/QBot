import path from "node:path";
import { LIMITS } from "./limits.ts";
import { normalizePrefix, parseOssEndpoint, type OssConfig } from "./feed/objects.ts";

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
  /**
   * Separate from personalOpen. Unset keeps feed, follow, and card reads on the bearer.
   * Exactly `1` lets the single configured owner read cards and follow or unfollow
   * a public bot. It does not open chat, and chat's flag does not open these routes.
   */
  feedOpen: boolean;
  objectRoot: string | null;
  oss: OssConfig | null;
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const databaseUrl = required(env, "DATABASE_URL");
  const personalOpen = env.QBOT_PERSONAL_OPEN === "1";
  const feedOpen = env.QBOT_FEED_OPEN === "1";
  const objects = objectConfig(env);
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
    feedOpen,
    objectRoot: objects.objectRoot,
    oss: objects.oss,
  };
}

function objectConfig(env: NodeJS.ProcessEnv): { objectRoot: string | null; oss: OssConfig | null } {
  const objectRoot = (env.QBOT_OBJECT_ROOT ?? "").trim();
  const accessKeyId = (env.QBOT_OSS_ACCESS_KEY_ID ?? "").trim();
  const accessKeySecret = (env.QBOT_OSS_ACCESS_KEY_SECRET ?? "").trim();
  const bucket = (env.QBOT_OSS_BUCKET ?? "").trim();
  const endpoint = (env.QBOT_OSS_ENDPOINT ?? "").trim();
  const prefix = (env.QBOT_OSS_KEY_PREFIX ?? "").trim();
  const ossTouched = Boolean(accessKeyId || accessKeySecret || bucket || endpoint || prefix);
  if (objectRoot && ossTouched) throw new Error("Set QBOT_OBJECT_ROOT or the OSS variables, not both");
  if (objectRoot) {
    if (!path.isAbsolute(objectRoot) || objectRoot.includes("\0")) throw new Error("QBOT_OBJECT_ROOT must be an absolute path");
    return { objectRoot, oss: null };
  }
  if (!ossTouched) return { objectRoot: null, oss: null };
  if (!accessKeyId || !accessKeySecret || !bucket || !endpoint) {
    throw new Error("OSS settings must include the endpoint, bucket, and both key parts");
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,62}$/.test(bucket)) throw new Error("QBOT_OSS_BUCKET is not a bucket name");
  return {
    objectRoot: null,
    oss: {
      bucket,
      endpointHost: parseOssEndpoint(endpoint),
      accessKeyId,
      accessKeySecret,
      keyPrefix: normalizePrefix(prefix || "qbot-cards/"),
    },
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
