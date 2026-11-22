const TRANSPORT = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|EAI_AGAIN|EHOSTUNREACH|AggregateError|TRANSPORT|socket hang up|Connection error/i;
const CODE = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|EAI_AGAIN|EHOSTUNREACH|TRANSPORT|TIMEOUT/;

/** One log line. Secrets and the prompt are removed. */
export function upstreamLogLine(detail: string, secret = ""): string {
  let text = detail;
  if (secret) text = text.split(secret).join("[redacted]");
  text = text.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]");
  text = text.replace(/\s+/g, " ").trim().slice(0, 300);
  const code = text.match(CODE)?.[0] ?? "unknown";
  return `upstream error code=${code} detail=${text}`;
}

/** Text the phone can show. Transport failures tell the person to send again. */
export function userTextForUpstream(detail: string, sawText: boolean): string {
  if (TRANSPORT.test(detail)) return sawText ? "回复中断了，请再发一次" : "网络暂时连不上模型，请再发一次";
  return "模型上游中断";
}

export function isUserFacingUpstream(message: string): boolean {
  return message === "网络暂时连不上模型，请再发一次"
    || message === "回复中断了，请再发一次"
    || message === "模型上游中断"
    || message === "模型没有返回文字"
    || message === "模型会话不在这台服务器上";
}
