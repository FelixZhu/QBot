import { createHash } from "node:crypto";
import canonicalizeModule from "canonicalize";

// `canonicalize` is CJS; Node calls the default export at runtime.
const canonicalize = canonicalizeModule as unknown as (value: unknown) => string | undefined;

/**
 * RFC 8785 JSON Canonicalization Scheme.
 * Sorts object keys by UTF-16 code units and rejects NaN, Infinity, undefined, or lone surrogates.
 */
export function jcs(value: unknown): string {
  let encoded: string | undefined;
  try {
    encoded = canonicalize(value);
  } catch {
    throw new Error("JCS 不能编码这个值");
  }
  if (typeof encoded !== "string") throw new Error("JCS 不能编码这个值");
  return encoded;
}

export function sha256Hex(bytes: Buffer | string): string {
  const data = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
  return createHash("sha256").update(data).digest("hex");
}

export function jcsSha256(value: unknown): string {
  return sha256Hex(jcs(value));
}
