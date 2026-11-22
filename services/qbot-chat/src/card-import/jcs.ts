import { createHash } from "node:crypto";
import canonicalizeModule from "canonicalize";

// The package is CJS. Node calls the function; the .d.ts default is not seen as callable under NodeNext.
const canonicalize = canonicalizeModule as unknown as (value: unknown) => string | undefined;

/**
 * RFC 8785 JSON Canonicalization Scheme.
 * `canonicalize` sorts object keys by UTF-16 code units and serializes
 * numbers the way ECMAScript JSON.stringify does.
 * Returns undefined for NaN, Infinity, undefined, or a lone surrogate.
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
