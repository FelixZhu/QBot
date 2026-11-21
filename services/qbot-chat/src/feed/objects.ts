import { createHmac } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { LIMITS } from "../limits.ts";
import { bundlePath, isUuid } from "./paths.ts";

export const DEFAULT_KEY_PREFIX = "qbot/cards/";

export type ObjectStore = {
  read(artifactId: string, version: number, relPath: string): Promise<Buffer | null>;
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

export function parseOssEndpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  const host = trimmed.replace(/^https:\/\//, "");
  if (host !== trimmed && !trimmed.startsWith("https://")) throw new Error("QBOT_OSS_ENDPOINT must be a hostname or https host");
  if (host.includes("://") || host.includes("/") || host.includes("@") || host.includes(" ") || !HOST.test(host)) {
    throw new Error("QBOT_OSS_ENDPOINT must be a hostname");
  }
  return host;
}

export function normalizePrefix(raw: string): string {
  const prefix = (raw.trim() || DEFAULT_KEY_PREFIX).replace(/^\/+/, "");
  if (!prefix.startsWith("qbot/")) throw new Error("QBOT_OSS_KEY_PREFIX must stay under qbot/");
  if (prefix.includes("..") || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,80}$/.test(prefix)) {
    throw new Error("QBOT_OSS_KEY_PREFIX is not a relative prefix");
  }
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

/** Immutable key. A new artifact version is a new prefix; this never rewrites an older one. */
export function objectKey(prefix: string, artifactId: string, version: number, relPath: string): string | null {
  if (!isUuid(artifactId) || !Number.isInteger(version) || version < 1 || version > 9999) return null;
  const safe = bundlePath(relPath);
  if (!safe) return null;
  const key = `${prefix}${artifactId}/v${version}/${safe}`;
  if (!key.startsWith("qbot/")) return null;
  return key;
}

/** Aliyun OSS signature v1. The secret stays in the HMAC and is not part of the URL. */
export function authorizeOss(input: {
  method: "GET";
  bucket: string;
  key: string;
  endpointHost: string;
  accessKeyId: string;
  accessKeySecret: string;
  date: string;
}): { url: string; headers: Record<string, string> } {
  const contentType = "";
  const resource = `/${input.bucket}/${input.key}`;
  const stringToSign = `${input.method}\n\n${contentType}\n${input.date}\n${resource}`;
  const signature = createHmac("sha1", input.accessKeySecret).update(stringToSign).digest("base64");
  const headers: Record<string, string> = {
    Date: input.date,
    Authorization: `OSS ${input.accessKeyId}:${signature}`,
  };
  const encoded = input.key.split("/").map((part) => encodeURIComponent(part)).join("/");
  return { url: `https://${input.bucket}.${input.endpointHost}/${encoded}`, headers };
}

export function createLocalObjectStore(root: string, prefix = DEFAULT_KEY_PREFIX): ObjectStore {
  const base = path.resolve(root);
  return {
    async read(artifactId, version, relPath) {
      const key = objectKey(prefix, artifactId, version, relPath);
      if (!key) return null;
      const full = path.resolve(base, key);
      const directory = path.resolve(base, prefix, artifactId, `v${version}`) + path.sep;
      if (!full.startsWith(directory)) return null;
      try {
        const info = await stat(full);
        if (!info.isFile() || info.size <= 0 || info.size > LIMITS.artifactBytes) return null;
        return await readFile(full);
      } catch {
        return null;
      }
    },
  };
}

export function createOssObjectStore(config: OssConfig, fetchImpl: typeof fetch = fetch): ObjectStore {
  return {
    async read(artifactId, version, relPath) {
      const key = objectKey(config.keyPrefix, artifactId, version, relPath);
      if (!key) return null;
      const signed = authorizeOss({
        method: "GET",
        bucket: config.bucket,
        key,
        endpointHost: config.endpointHost,
        accessKeyId: config.accessKeyId,
        accessKeySecret: config.accessKeySecret,
        date: new Date().toUTCString(),
      });
      let response: Response;
      try {
        response = await fetchImpl(signed.url, {
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
