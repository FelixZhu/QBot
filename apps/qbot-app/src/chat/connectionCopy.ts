import type { ConnectionView } from "./serverSession.ts";

export function liveBadge(view: ConnectionView): string {
  if (view.phase === "ready") return view.session.upstream === "fixture" ? "测试夹具" : "已连接";
  if (view.phase === "checking") return "正在连接";
  if (view.phase === "error") return "未连接";
  return "未连接";
}

export function liveNote(view: ConnectionView): string {
  if (view.phase === "ready" && view.session.upstream === "fixture") {
    return `服务器声明这是测试夹具，不是真实模型。配置的模型名是 ${view.session.model}，这次没有调用它。`;
  }
  if (view.phase === "ready") return `已连接。模型由服务器指定为 ${view.session.model}。`;
  if (view.phase === "error") return view.message;
  if (view.phase === "checking") return "正在核对连接码。";
  return "这台设备还没有连接。把管理员给你的一次连接码贴在下面，不要把令牌写进对话。";
}
