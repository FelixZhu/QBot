import { createHash, timingSafeEqual } from "node:crypto";
import { LIMITS } from "./limits.ts";

export function tokenDigest(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export function tokensMatch(provided: string, expected: string): boolean {
  return timingSafeEqual(tokenDigest(provided), tokenDigest(expected));
}

export function readBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = new RegExp(`^Bearer ([!-~]{${LIMITS.tokenMin},${LIMITS.tokenMax}})$`).exec(header);
  return match?.[1] ?? null;
}
