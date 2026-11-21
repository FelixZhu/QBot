import { createHmac } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { LIMITS } from "../limits.ts";
import { bundlePath, isUuid } from "./paths.ts";

export type ObjectStore = {
  read(artifactId: string, relPath: string): Promise<Buffer | null>;
};

export type OssConfig = {
  bucket: string;
  endpointHost: string;
  accessKeyId: string;
  accessKeySecret: string;
  keyPrefix: string;
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
  const prefix = raw.trim() || "qbot-cards/";
  if (prefix.includes("..") || prefix.startsWith("/") || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,80}$/.test(prefix)) {
    throw new Error("QBOT_OSS_KEY_PREFIX is not a relative prefix");
  }
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

export function objectKey(prefix: string, artifactId: string, relPath: string): string | null {
  if (!isUuid(artifactId)) return null;
  const safe = bundlePath(relPath);
  if (!safe) return null;
  return `${prefix}${artifactId}/${safe}`;
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
  aclPrivate?: boolean;
}): { url: string; headers: Record<string, string> } {
  const canonicalHeaders = input.aclPrivate ? "x-oss-object-acl:private\n" : "";
  const contentType = input.contentType ?? "";
  const resource = `/${input.bucket}/${input.key}`;
  const stringToSign = `${input.method}\n\n${contentType}\n${input.date}\n${canonicalHeaders}${resource}`;
  const signature = createHmac("sha1", input.accessKeySecret).update(stringToSign).digest("base64");
  const headers: Record<string, string> = {
    Date: input.date,
    Authorization: `OSS ${input.accessKeyId}:${signature}`,
  };
  if (contentType) headers["Content-Type"] = contentType;
  if (input.aclPrivate) headers["x-oss-object-acl"] = "private";
  const encoded = input.key.split("/").map((part) => encodeURIComponent(part)).join("/");
  return { url: `https://${input.bucket}.${input.endpointHost}/${encoded}`, headers };
}

export function createLocalObjectStore(root: string): ObjectStore {
  const base = path.resolve(root);
  return {
    async read(artifactId, relPath) {
      const key = objectKey("", artifactId, relPath);
      if (!key) return null;
      const full = path.resolve(base, key);
      const directory = path.resolve(base, artifactId) + path.sep;
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
    async read(artifactId, relPath) {
      const key = objectKey(config.keyPrefix, artifactId, relPath);
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

export function createObjectStore(input: { objectRoot: string | null; oss: OssConfig | null }): ObjectStore {
  if (input.objectRoot) return createLocalObjectStore(input.objectRoot);
  if (input.oss) return createOssObjectStore(input.oss);
  return { async read() { return null; } };
}
