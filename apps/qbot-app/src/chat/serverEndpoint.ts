const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "10.0.2.2"]);

/** Set only in the private publish environment. The repository value stays empty. */
export function configuredOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.EXPO_PUBLIC_QBOT_ORIGIN ?? "").trim();
  if (!raw) return null;
  return parseServerOrigin(raw);
}

/** Accept HTTPS, or HTTP only for loopback and the Android emulator host alias. */
export function parseServerOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("地址无法解析");
  }
  if (url.username || url.password) throw new Error("不要把令牌写进地址");
  if (url.search || url.hash) throw new Error("地址不能带查询参数");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/" && path !== "/health" && !path.startsWith("/v1/")) throw new Error("只填写服务器根地址");
  const host = url.hostname.toLowerCase();
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && LOOPBACK.has(host)) return url.origin;
  throw new Error("真实服务器必须使用 HTTPS。只有本机回环或模拟器地址可以用 HTTP");
}
