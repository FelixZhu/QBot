import { createHmac } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { LIMITS } from "../limits.ts";
import { bundlePath, isUuid } from "./paths.ts";

export const DEFAULT_KEY_PREFIX = "qbot/cards/";

export type ObjectStore = {
  read(artifactId: string, version: number, relPath: string): Promise<Buffer | null>;
  write?(artifactId: string, version: number, relPath: string, bytes: Buffer, contentType: string): Promise<boolean>;
};

export type OssAuthConfig =
  | { kind: "static"; accessKeyId: string; accessKeySecret: string }
  | { kind: "ecs-ram-role"; roleName: string; metadataOrigin: string };

export type OssConfig = {
  bucket: string;
  endpointHost: string;
  keyPrefix: string;
  auth: OssAuthConfig;
};

export type OssCredentials = {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken?: string;
};

/** Anonymous read of one fixed HTTPS origin. No access key. The objects are already public. */
export type PublicOssConfig = {
  origin: string;
  keyPrefix: typeof DEFAULT_KEY_PREFIX;
};

const HOST = /^[A-Za-z0-9.-]+(?::\d+)?$/;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,62}$/;
const PREFIX_SEGMENT = /^[A-Za-z0-9._-]+$/;
const RAM_ROLE = /^[A-Za-z0-9._-]{1,64}$/;
const ECS_TOKEN_TTL_SECONDS = "300";
const DEFAULT_STS_REFRESH_MARGIN_MS = 5 * 60_000;

export function parseEcsRamRole(raw: string): string {
  const role = raw.trim();
  if (!role || role === "." || role === ".." || !RAM_ROLE.test(role)) {
    throw new Error("QBOT_OSS_ECS_RAM_ROLE is not a valid RAM role name");
  }
  return role;
}

/** HTTP origin on loopback (tests) or RFC 6598 shared address space (ECS metadata). */
export function parseEcsMetadataOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("QBOT_OSS_ECS_METADATA_ORIGIN must be an http metadata origin");
  }
  if (url.protocol !== "http:" || url.username || url.password || url.search || url.hash) {
    throw new Error("QBOT_OSS_ECS_METADATA_ORIGIN must be an http metadata origin");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("QBOT_OSS_ECS_METADATA_ORIGIN must not include a path");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  const isSharedSpaceV4 = isRfc6598Ipv4(host);
  if (!isLoopback && !isSharedSpaceV4) {
    throw new Error("QBOT_OSS_ECS_METADATA_ORIGIN must target ECS metadata or loopback");
  }
  return url.origin;
}

function isRfc6598Ipv4(host: string): boolean {
  if (isIP(host) !== 4) return false;
  const parts = host.split(".").map(Number);
  return parts.length === 4 && parts[0] === 100 && (parts[1] ?? -1) >= 64 && (parts[1] ?? 256) <= 127;
}

export function validateOssBucket(raw: string): string {
  const bucket = raw.trim();
  if (!BUCKET.test(bucket) || bucket.includes("..") || bucket.endsWith(".") || bucket.endsWith("-")) {
    throw new Error("QBOT_OSS_BUCKET is not a bucket name");
  }
  return bucket;
}

export function parseOssEndpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  const host = trimmed.replace(/^https:\/\//, "");
  if (host !== trimmed && !trimmed.startsWith("https://")) throw new Error("QBOT_OSS_ENDPOINT must be a hostname or https host");
  if (host.includes("://") || host.includes("/") || host.includes("@") || host.includes(" ") || !HOST.test(host)) {
    throw new Error("QBOT_OSS_ENDPOINT must be a hostname");
  }
  const colon = host.indexOf(":");
  const hostname = (colon >= 0 ? host.slice(0, colon) : host).replace(/\.$/, "");
  const portRaw = colon >= 0 ? host.slice(colon + 1) : "";
  if (
    !hostname
    || hostname.includes("..")
    || hostname.startsWith(".")
    || hostname.startsWith("-")
    || hostname.endsWith("-")
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || isIP(hostname) !== 0
  ) {
    throw new Error("QBOT_OSS_ENDPOINT must be a public hostname");
  }
  if (portRaw) {
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("QBOT_OSS_ENDPOINT port is invalid");
    }
  }
  return host;
}

export function normalizePrefix(raw: string): string {
  const trimmed = raw.trim();
  const stripped = (trimmed || DEFAULT_KEY_PREFIX).replace(/^\/+/, "").replace(/\/+$/, "");
  if (!stripped || stripped.length > 80) {
    throw new Error("QBOT_OSS_KEY_PREFIX must stay under qbot/cards/");
  }
  const parts = stripped.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || !PREFIX_SEGMENT.test(part))) {
    throw new Error("QBOT_OSS_KEY_PREFIX is not a relative prefix");
  }
  const normalized = `${parts.join("/")}/`;
  if (!normalized.startsWith(DEFAULT_KEY_PREFIX)) {
    throw new Error("QBOT_OSS_KEY_PREFIX must stay under qbot/cards/");
  }
  return normalized;
}

/** Immutable key. A new artifact version is a new prefix; this never rewrites an older one. */
export function objectKey(prefix: string, artifactId: string, version: number, relPath: string): string | null {
  if (!prefix.trim()) return null;
  if (!isUuid(artifactId) || !Number.isInteger(version) || version < 1 || version > 9999) return null;
  let safePrefix: string;
  try {
    safePrefix = normalizePrefix(prefix);
  } catch {
    return null;
  }
  const safe = bundlePath(relPath);
  if (!safe) return null;
  const key = `${safePrefix}${artifactId}/v${version}/${safe}`;
  if (!key.startsWith(DEFAULT_KEY_PREFIX)) return null;
  return key;
}

/** Aliyun OSS signature v1 (supports static AK and STS security tokens). Secrets stay out of URLs. */
export function authorizeOss(input: {
  method: "GET" | "PUT";
  bucket: string;
  key: string;
  endpointHost: string;
  accessKeyId: string;
  accessKeySecret: string;
  securityToken?: string;
  date: string;
  contentType?: string;
}): { url: string; headers: Record<string, string> } {
  const bucket = validateOssBucket(input.bucket);
  const endpointHost = parseOssEndpoint(input.endpointHost);
  if (
    !input.key.startsWith(DEFAULT_KEY_PREFIX)
    || input.key.includes("..")
    || input.key.includes("//")
    || /[\r\n\0]/.test(input.key)
  ) {
    throw new Error("OSS key must stay under qbot/cards/");
  }
  const contentType = input.contentType ?? "";
  const securityToken = input.securityToken ?? "";
  if (/[\r\n]/.test(contentType) || /[\r\n]/.test(input.date) || /[\r\n]/.test(securityToken) || /[\r\n]/.test(input.accessKeyId)) {
    throw new Error("OSS header values must not contain newlines");
  }
  const canonicalizedHeaders = securityToken ? `x-oss-security-token:${securityToken}\n` : "";
  const resource = `/${bucket}/${input.key}`;
  const stringToSign = `${input.method}\n\n${contentType}\n${input.date}\n${canonicalizedHeaders}${resource}`;
  const signature = createHmac("sha1", input.accessKeySecret).update(stringToSign).digest("base64");
  const headers: Record<string, string> = {
    Date: input.date,
    Authorization: `OSS ${input.accessKeyId}:${signature}`,
    ...(contentType ? { "Content-Type": contentType } : {}),
    ...(securityToken ? { "x-oss-security-token": securityToken } : {}),
  };
  const encoded = input.key.split("/").map((part) => encodeURIComponent(part)).join("/");
  return { url: `https://${bucket}.${endpointHost}/${encoded}`, headers };
}

export type CredentialProvider = {
  get(): Promise<OssCredentials | null>;
  invalidate(): void;
};

/** Fetches and caches short-lived STS credentials from Aliyun ECS instance metadata (IMDSv2 with IMDSv1 fallback). */
export function createEcsRamRoleCredentialProvider(
  config: { roleName: string; metadataOrigin: string },
  options: { fetchImpl?: typeof fetch; now?: () => number; refreshMarginMs?: number } = {},
): CredentialProvider {
  const roleName = parseEcsRamRole(config.roleName);
  const metadataOrigin = parseEcsMetadataOrigin(config.metadataOrigin);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const refreshMarginMs = options.refreshMarginMs ?? DEFAULT_STS_REFRESH_MARGIN_MS;

  let cached: (OssCredentials & { expiresAtMs: number }) | null = null;
  let inflight: Promise<OssCredentials | null> | null = null;

  async function fetchFresh(): Promise<OssCredentials | null> {
    let imdsToken: string | null = null;
    try {
      const tokenRes = await fetchImpl(`${metadataOrigin}/latest/api/token`, {
        method: "PUT",
        headers: { "X-aliyun-ecs-metadata-token-ttl-seconds": ECS_TOKEN_TTL_SECONDS },
        redirect: "manual",
        signal: AbortSignal.timeout(4_000),
      });
      if (tokenRes.status === 200) {
        const text = (await tokenRes.text()).trim();
        if (!text || /[\r\n]/.test(text)) {
          console.error("ecs metadata token invalid");
          return null;
        }
        imdsToken = text;
      } else if (tokenRes.status === 404 || tokenRes.status === 405 || tokenRes.status === 501) {
        await tokenRes.arrayBuffer().catch(() => {});
      } else {
        console.error(`ecs metadata token status=${tokenRes.status}`);
        await tokenRes.arrayBuffer().catch(() => {});
        return null;
      }
    } catch {
      console.error("ecs metadata token failed");
      return null;
    }

    let credRes: Response;
    try {
      credRes = await fetchImpl(
        `${metadataOrigin}/latest/meta-data/ram/security-credentials/${encodeURIComponent(roleName)}`,
        {
          method: "GET",
          headers: imdsToken ? { "X-aliyun-ecs-metadata-token": imdsToken } : undefined,
          redirect: "manual",
          signal: AbortSignal.timeout(4_000),
        },
      );
    } catch {
      console.error("ecs ram credential fetch failed");
      return null;
    }
    if (credRes.status !== 200) {
      console.error(`ecs ram credential status=${credRes.status}`);
      await credRes.arrayBuffer().catch(() => {});
      return null;
    }
    let payload: Record<string, unknown>;
    try {
      const parsed = await credRes.json() as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      payload = parsed as Record<string, unknown>;
    } catch {
      console.error("ecs ram credential json invalid");
      return null;
    }
    if (payload.Code !== "Success") {
      console.error("ecs ram credential not successful");
      return null;
    }
    const accessKeyId = typeof payload.AccessKeyId === "string" ? payload.AccessKeyId.trim() : "";
    const accessKeySecret = typeof payload.AccessKeySecret === "string" ? payload.AccessKeySecret.trim() : "";
    const securityToken = typeof payload.SecurityToken === "string" ? payload.SecurityToken.trim() : "";
    const expirationRaw = typeof payload.Expiration === "string" ? payload.Expiration.trim() : "";
    const expiresAtMs = Date.parse(expirationRaw);
    if (
      !accessKeyId
      || !accessKeySecret
      || !securityToken
      || /[\r\n]/.test(accessKeyId)
      || /[\r\n]/.test(accessKeySecret)
      || /[\r\n]/.test(securityToken)
      || !Number.isFinite(expiresAtMs)
      || expiresAtMs <= now()
    ) {
      console.error("ecs ram credential fields invalid");
      return null;
    }
    cached = { accessKeyId, accessKeySecret, securityToken, expiresAtMs };
    return { accessKeyId, accessKeySecret, securityToken };
  }

  return {
    async get() {
      if (cached && now() < cached.expiresAtMs - refreshMarginMs) {
        return {
          accessKeyId: cached.accessKeyId,
          accessKeySecret: cached.accessKeySecret,
          securityToken: cached.securityToken,
        };
      }
      if (!inflight) {
        inflight = fetchFresh().finally(() => {
          inflight = null;
        });
      }
      return inflight;
    },
    invalidate() {
      cached = null;
    },
  };
}

export function createLocalObjectStore(root: string, prefix = DEFAULT_KEY_PREFIX): ObjectStore {
  const base = path.resolve(root);
  const safePrefix = normalizePrefix(prefix);
  return {
    async read(artifactId, version, relPath) {
      const key = objectKey(safePrefix, artifactId, version, relPath);
      if (!key) return null;
      const full = path.resolve(base, key);
      const directory = path.resolve(base, safePrefix, artifactId, `v${version}`) + path.sep;
      if (!full.startsWith(directory)) return null;
      try {
        const info = await stat(full);
        if (!info.isFile() || info.size <= 0 || info.size > LIMITS.artifactBytes) return null;
        return await readFile(full);
      } catch {
        return null;
      }
    },
    async write(artifactId, version, relPath, bytes) {
      if (bytes.length === 0 || bytes.length > LIMITS.artifactBytes) return false;
      const key = objectKey(safePrefix, artifactId, version, relPath);
      if (!key) return false;
      const full = path.resolve(base, key);
      const directory = path.resolve(base, safePrefix, artifactId, `v${version}`) + path.sep;
      if (!full.startsWith(directory)) return false;
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, bytes, { flag: "wx" });
      return true;
    },
  };
}

export function createOssObjectStore(
  config: OssConfig,
  fetchImpl: typeof fetch = fetch,
  options: { now?: () => number; refreshMarginMs?: number } = {},
): ObjectStore {
  const bucket = validateOssBucket(config.bucket);
  const endpointHost = parseOssEndpoint(config.endpointHost);
  const keyPrefix = normalizePrefix(config.keyPrefix);
  const expectedOrigin = new URL(`https://${bucket}.${endpointHost}`).origin;
  const provider: CredentialProvider = config.auth.kind === "ecs-ram-role"
    ? createEcsRamRoleCredentialProvider(config.auth, {
      fetchImpl,
      now: options.now,
      refreshMarginMs: options.refreshMarginMs,
    })
    : {
      async get() {
        return {
          accessKeyId: config.auth.kind === "static" ? config.auth.accessKeyId : "",
          accessKeySecret: config.auth.kind === "static" ? config.auth.accessKeySecret : "",
        };
      },
      invalidate() {},
    };
  const canRetryOn403 = config.auth.kind === "ecs-ram-role";

  return {
    async read(artifactId, version, relPath) {
      const key = objectKey(keyPrefix, artifactId, version, relPath);
      if (!key || !key.startsWith(keyPrefix) || !key.startsWith(DEFAULT_KEY_PREFIX)) return null;
      for (let attempt = 0; attempt < (canRetryOn403 ? 2 : 1); attempt += 1) {
        const creds = await provider.get();
        if (!creds) return null;
        const signed = authorizeOss({
          method: "GET",
          bucket,
          key,
          endpointHost,
          accessKeyId: creds.accessKeyId,
          accessKeySecret: creds.accessKeySecret,
          securityToken: creds.securityToken,
          date: new Date().toUTCString(),
        });
        const url = new URL(signed.url);
        if (url.origin !== expectedOrigin || !url.pathname.startsWith(`/${keyPrefix}`) || !url.pathname.startsWith(`/${DEFAULT_KEY_PREFIX}`)) {
          return null;
        }
        let response: Response;
        try {
          response = await fetchImpl(url.toString(), {
            method: "GET",
            headers: signed.headers,
            redirect: "manual",
            signal: AbortSignal.timeout(8_000),
          });
        } catch {
          console.error("object read failed");
          return null;
        }
        if (response.status === 403 && canRetryOn403 && attempt === 0) {
          await response.arrayBuffer().catch(() => {});
          provider.invalidate();
          continue;
        }
        if (response.status !== 200) {
          console.error(`object read status=${response.status}`);
          await response.arrayBuffer().catch(() => {});
          return null;
        }
        const length = Number(response.headers.get("content-length") ?? "0");
        if (Number.isFinite(length) && length > LIMITS.artifactBytes) return null;
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length === 0 || bytes.length > LIMITS.artifactBytes) return null;
        return bytes;
      }
      return null;
    },
    async write(artifactId, version, relPath, bytes, contentType) {
      if (bytes.length === 0 || bytes.length > LIMITS.artifactBytes) return false;
      if (!contentType || /[\r\n]/.test(contentType)) return false;
      const key = objectKey(keyPrefix, artifactId, version, relPath);
      if (!key || !key.startsWith(keyPrefix) || !key.startsWith(DEFAULT_KEY_PREFIX)) return false;
      for (let attempt = 0; attempt < (canRetryOn403 ? 2 : 1); attempt += 1) {
        const creds = await provider.get();
        if (!creds) return false;
        const signed = authorizeOss({
          method: "PUT",
          bucket,
          key,
          endpointHost,
          accessKeyId: creds.accessKeyId,
          accessKeySecret: creds.accessKeySecret,
          securityToken: creds.securityToken,
          date: new Date().toUTCString(),
          contentType,
        });
        const url = new URL(signed.url);
        if (url.origin !== expectedOrigin || !url.pathname.startsWith(`/${keyPrefix}`) || !url.pathname.startsWith(`/${DEFAULT_KEY_PREFIX}`)) {
          return false;
        }
        let response: Response;
        try {
          response = await fetchImpl(url.toString(), {
            method: "PUT",
            headers: { ...signed.headers, "Content-Length": String(bytes.length) },
            body: new Uint8Array(bytes),
            redirect: "manual",
            signal: AbortSignal.timeout(15_000),
          });
        } catch {
          console.error("object write failed");
          return false;
        }
        await response.arrayBuffer().catch(() => {});
        if (response.status === 403 && canRetryOn403 && attempt === 0) {
          provider.invalidate();
          continue;
        }
        if (response.status !== 200 && response.status !== 201) {
          console.error(`object write status=${response.status}`);
          return false;
        }
        return true;
      }
      return false;
    },
  };
}

/** HTTPS origin only. No user, path, query, or IP. The value stays in the private env. */
export function parsePublicOssOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("QBOT_OSS_PUBLIC_ORIGIN must be an https origin");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("QBOT_OSS_PUBLIC_ORIGIN must be an https origin");
  }
  if (url.pathname !== "/" && url.pathname !== "") throw new Error("QBOT_OSS_PUBLIC_ORIGIN must not include a path");
  const host = url.hostname.replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || isIP(host) !== 0) {
    throw new Error("QBOT_OSS_PUBLIC_ORIGIN must be a public https hostname");
  }
  return url.origin;
}

export function createPublicOssObjectStore(config: PublicOssConfig, fetchImpl: typeof fetch = fetch): ObjectStore {
  return {
    async read(artifactId, version, relPath) {
      const key = objectKey(config.keyPrefix, artifactId, version, relPath);
      if (!key || !key.startsWith(DEFAULT_KEY_PREFIX)) return null;
      const url = new URL(`${config.origin}/${key.split("/").map((part) => encodeURIComponent(part)).join("/")}`);
      if (url.origin !== config.origin || !url.pathname.startsWith(`/${DEFAULT_KEY_PREFIX}`)) return null;
      let response: Response;
      try {
        response = await fetchImpl(url.toString(), {
          method: "GET",
          redirect: "manual",
          signal: AbortSignal.timeout(8_000),
        });
      } catch {
        console.error("object read failed");
        return null;
      }
      if (response.status !== 200) {
        console.error(`object read status=${response.status}`);
        await response.arrayBuffer().catch(() => {});
        return null;
      }
      const length = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(length) && length > LIMITS.artifactBytes) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > LIMITS.artifactBytes) return null;
      return bytes;
    },
  };
}

export function createObjectStore(
  input: { objectRoot: string | null; oss: OssConfig | null; publicOss: PublicOssConfig | null },
  fetchImpl: typeof fetch = fetch,
): ObjectStore {
  if (input.objectRoot) return createLocalObjectStore(input.objectRoot);
  if (input.publicOss && input.oss) {
    const reader = createPublicOssObjectStore(input.publicOss, fetchImpl);
    const writer = createOssObjectStore(input.oss, fetchImpl);
    return {
      read: reader.read,
      write: writer.write,
    };
  }
  if (input.publicOss) return createPublicOssObjectStore(input.publicOss, fetchImpl);
  if (input.oss) return createOssObjectStore(input.oss, fetchImpl);
  return { async read() { return null; } };
}
