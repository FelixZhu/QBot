import path from "node:path";
import { LIMITS } from "./limits.ts";
import {
  DEFAULT_KEY_PREFIX,
  normalizePrefix,
  parseEcsMetadataOrigin,
  parseEcsRamRole,
  parseOssEndpoint,
  parsePublicOssOrigin,
  validateOssBucket,
  type OssConfig,
  type PublicOssConfig,
} from "./feed/objects.ts";

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
   * Separate from personalOpen. Unset keeps feed, follow, and card read routes on the bearer.
   * Exactly `1` lets the single configured owner read public cards on a public bot and follow
   * or unfollow a public bot. Card import, publish, rollback, and card delete always require
   * the bearer. It does not open chat, and chat's flag does not open these routes.
   */
  feedOpen: boolean;
  objectRoot: string | null;
  importDir: string;
  oss: OssConfig | null;
  /** Explicit anonymous read of the already-public card objects. Off unless exactly 1. */
  publicOss: PublicOssConfig | null;
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
  const rawImportDir = (env.QBOT_IMPORT_DIR ?? "").trim();
  if (rawImportDir && (!path.isAbsolute(rawImportDir) || rawImportDir.includes("\0"))) {
    throw new Error("QBOT_IMPORT_DIR must be an absolute path");
  }
  const importDir = rawImportDir
    || (objects.objectRoot ? path.join(objects.objectRoot, ".card-imports") : path.join(process.cwd(), "var", "card-imports"));
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
    importDir,
    oss: objects.oss,
    publicOss: objects.publicOss,
  };
}

function objectConfig(env: NodeJS.ProcessEnv): { objectRoot: string | null; oss: OssConfig | null; publicOss: PublicOssConfig | null } {
  const objectRoot = (env.QBOT_OBJECT_ROOT ?? "").trim();
  const accessKeyId = (env.QBOT_OSS_ACCESS_KEY_ID ?? "").trim();
  const accessKeySecret = (env.QBOT_OSS_ACCESS_KEY_SECRET ?? "").trim();
  const ecsRamRole = (env.QBOT_OSS_ECS_RAM_ROLE ?? "").trim();
  const ecsMetadataOrigin = (env.QBOT_OSS_ECS_METADATA_ORIGIN ?? "").trim();
  const bucket = (env.QBOT_OSS_BUCKET ?? "").trim();
  const endpoint = (env.QBOT_OSS_ENDPOINT ?? "").trim();
  const prefix = (env.QBOT_OSS_KEY_PREFIX ?? "").trim();
  const publicOrigin = (env.QBOT_OSS_PUBLIC_ORIGIN ?? "").trim();
  const publicOn = env.QBOT_OSS_PUBLIC === "1";

  const staticKeyTouched = Boolean(accessKeyId || accessKeySecret);
  const ecsRoleTouched = Boolean(ecsRamRole || ecsMetadataOrigin);
  const signedOssTouched = Boolean(staticKeyTouched || ecsRoleTouched || bucket || endpoint);
  const ossTouched = Boolean(signedOssTouched || prefix);

  if (objectRoot && (publicOn || publicOrigin || ossTouched)) {
    throw new Error("Set QBOT_OBJECT_ROOT or the OSS variables, not both");
  }
  if (objectRoot) {
    if (!path.isAbsolute(objectRoot) || objectRoot.includes("\0")) throw new Error("QBOT_OBJECT_ROOT must be an absolute path");
    return { objectRoot, oss: null, publicOss: null };
  }

  let publicOss: PublicOssConfig | null = null;
  if (publicOn || publicOrigin) {
    if (!publicOn || !publicOrigin) throw new Error("QBOT_OSS_PUBLIC=1 and QBOT_OSS_PUBLIC_ORIGIN must be set together");
    const keyPrefix = normalizePrefix(prefix || DEFAULT_KEY_PREFIX);
    if (keyPrefix !== DEFAULT_KEY_PREFIX) throw new Error("QBOT_OSS_PUBLIC only reads qbot/cards/");
    publicOss = { origin: parsePublicOssOrigin(publicOrigin), keyPrefix: DEFAULT_KEY_PREFIX };
    if (!signedOssTouched) {
      return { objectRoot: null, oss: null, publicOss };
    }
  }

  if (!signedOssTouched && !prefix) return { objectRoot: null, oss: null, publicOss: null };

  if (staticKeyTouched && ecsRoleTouched) {
    throw new Error("OSS settings cannot combine QBOT_OSS_ECS_RAM_ROLE with a static access key");
  }
  if (ecsRoleTouched && (!ecsRamRole || !ecsMetadataOrigin)) {
    throw new Error("QBOT_OSS_ECS_RAM_ROLE and QBOT_OSS_ECS_METADATA_ORIGIN must be set together");
  }
  if (!bucket || !endpoint || (!ecsRoleTouched && (!accessKeyId || !accessKeySecret))) {
    throw new Error("OSS settings must include the endpoint, bucket, and either an ECS RAM role or both access key parts");
  }
  const keyPrefix = normalizePrefix(prefix || DEFAULT_KEY_PREFIX);
  if (publicOss && keyPrefix !== DEFAULT_KEY_PREFIX) {
    throw new Error("QBOT_OSS_PUBLIC only reads qbot/cards/");
  }
  const auth = ecsRoleTouched
    ? {
      kind: "ecs-ram-role" as const,
      roleName: parseEcsRamRole(ecsRamRole),
      metadataOrigin: parseEcsMetadataOrigin(ecsMetadataOrigin),
    }
    : {
      kind: "static" as const,
      accessKeyId,
      accessKeySecret,
    };
  return {
    objectRoot: null,
    oss: {
      bucket: validateOssBucket(bucket),
      endpointHost: parseOssEndpoint(endpoint),
      keyPrefix,
      auth,
    },
    publicOss,
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
