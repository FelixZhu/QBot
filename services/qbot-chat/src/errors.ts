export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

const SAFE_MESSAGES = new Set([
  "无法连接模型上游",
  "模型上游没有返回事件流",
  "模型上游中断",
  "模型没有返回文字",
  "模型回复超过长度限制",
  "模型上游超时",
  "回复没有写入数据库",
]);

/** Client-visible text. Unknown errors stay generic so keys and prompts are not echoed. */
export function publicErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.replace(/^Error:\s*/, "").trim() : "";
  if (SAFE_MESSAGES.has(message)) return message;
  if (/^模型上游返回 HTTP \d{3}$/.test(message)) return message;
  return "模型上游中断";
}

export function errorBody(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}
