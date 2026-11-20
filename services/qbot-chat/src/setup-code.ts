import { randomBytes, randomUUID } from "node:crypto";
import { tokenDigest } from "./auth.ts";
import type { ChatStore } from "./store.ts";

const PREFIX = "qbot1.";
const CODE = /^[A-Za-z0-9_-]{43}$/;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

export function assertPublicOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("QBOT_PUBLIC_ORIGIN 无法解析");
  }
  if (url.username || url.password || url.search || url.hash) throw new Error("QBOT_PUBLIC_ORIGIN 只能是根地址");
  if (url.pathname !== "/" && url.pathname !== "") throw new Error("QBOT_PUBLIC_ORIGIN 只能是根地址");
  const host = url.hostname.toLowerCase();
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && LOOPBACK.has(host)) return url.origin;
  throw new Error("QBOT_PUBLIC_ORIGIN 必须是 HTTPS 根地址");
}

export function encodeSetup(origin: string, code: string): string {
  const payload = Buffer.from(JSON.stringify({ o: origin, c: code }), "utf8").toString("base64url");
  return `${PREFIX}${payload}`;
}

export async function issueSetupCode(store: ChatStore, origin: string, now = Date.now()): Promise<string> {
  const checked = assertPublicOrigin(origin);
  const code = randomBytes(32).toString("base64url");
  await store.createEnrollment(tokenDigest(code), new Date(now + 15 * 60 * 1000));
  return encodeSetup(checked, code);
}

export function newDeviceCredential(): { id: string; token: string; hash: Buffer } {
  const token = randomBytes(32).toString("base64url");
  return { id: randomUUID(), token, hash: tokenDigest(token) };
}

export function codeHash(code: string): Buffer | null {
  if (!CODE.test(code)) return null;
  return tokenDigest(code);
}
