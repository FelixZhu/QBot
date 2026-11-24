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

export type OssConfig = {
  bucket: string;
  endpointHost: string;
  accessKeyId: string;
  accessKeySecret: string;
  keyPrefix: string;
};

/** Anonymous read of one fixed HTTPS origin. No access key. The objects are already public. */
export type PublicOssConfig = {
  origin: string;
  keyPrefix: typeof DEFAULT_KEY_PREFIX;
};

const HOST = /^[A-Za-z0-9.-]+(?::\d+)?$/;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,62}$/;
const PREFIX_SEGMENT = /^[A-Za-z0-9._-]+$/;

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

/** Aliyun OSS signature v1. The secret stays in the HMAC and is not part of the URL. */
export function authorizeOss(input: {
  method: "GET" | "PUT";
  bucket: string;
  key: string;
  endpointHost: string;
  accessKeyId: string;
  accessKeySecret: string;
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
  if (/[\r\n]/.test(contentType) || /[\r\n]/.test(input.date)) {
    throw new Error("OSS header values must not contain newlines");
  }
  const resource = `/${bucket}/${input.key}`;
  const stringToSign = `${input.method}\n\n${contentType}\n${input.date}\n${resource}`;
  const signature = createHmac("sha1", input.accessKeySecret).update(stringToSign).digest("base64");
  const headers: Record<string, string> = {
    Date: input.date,
    Authorization: `OSS ${input.accessKeyId}:${signature}`,
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
  const encoded = input.key.split("/").map((part) => encodeURIComponent(part)).join("/");
  return { url: `https://${bucket}.${endpointHost}/${encoded}`, headers };
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

export function createOssObjectStore(config: OssConfig, fetchImpl: typeof fetch = fetch): ObjectStore {
  const bucket = validateOssBucket(config.bucket);
  const endpointHost = parseOssEndpoint(config.endpointHost);
  const keyPrefix = normalizePrefix(config.keyPrefix);
  const expectedOrigin = new URL(`https://${bucket}.${endpointHost}`).origin;
  return {
    async read(artifactId, version, relPath) {
      const key = objectKey(keyPrefix, artifactId, version, relPath);
      if (!key || !key.startsWith(keyPrefix) || !key.startsWith(DEFAULT_KEY_PREFIX)) return null;
      const signed = authorizeOss({
        method: "GET",
        bucket,
        key,
        endpointHost,
        accessKeyId: config.accessKeyId,
        accessKeySecret: config.accessKeySecret,
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
    async write(artifactId, version, relPath, bytes, contentType) {
      if (bytes.length === 0 || bytes.length > LIMITS.artifactBytes) return false;
      if (!contentType || /[\r\n]/.test(contentType)) return false;
      const key = objectKey(keyPrefix, artifactId, version, relPath);
      if (!key || !key.startsWith(keyPrefix) || !key.startsWith(DEFAULT_KEY_PREFIX)) return false;
      const signed = authorizeOss({
        method: "PUT",
        bucket,
        key,
        endpointHost,
        accessKeyId: config.accessKeyId,
        accessKeySecret: config.accessKeySecret,
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
      if (response.status !== 200 && response.status !== 201) {
        console.error(`object write status=${response.status}`);
        return false;
      }
      return true;
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

export function createObjectStore(input: { objectRoot: string | null; oss: OssConfig | null; publicOss: PublicOssConfig | null }): ObjectStore {
  if (input.objectRoot) return createLocalObjectStore(input.objectRoot);
  if (input.publicOss) return createPublicOssObjectStore(input.publicOss);
  if (input.oss) return createOssObjectStore(input.oss);
  return { async read() { return null; } };
}
