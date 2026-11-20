import type { ConnectionView } from "./serverSession.ts";
import type { ServerSession } from "./serverClient.ts";

export function listSubtitle(view: ConnectionView): string {
  if (view.phase === "unconfigured") return "演示，没有接通真实助手";
  if (view.phase === "checking") return "正在核对服务器。演示会话仍在本机。";
  if (view.phase === "error") return `真实对话没有连上：${view.message.slice(0, 80)}。演示会话仍在本机。`;
  if (view.session.upstream === "fixture") return "服务器声明这是测试夹具，不是真实模型。演示会话仍在本机。";
  return "已连接服务器。演示会话仍在本机。";
}

export function liveRowLabel(view: ConnectionView): string {
  if (view.phase === "unconfigured") return "真实对话，未连接";
  if (view.phase === "checking") return "真实对话，正在连接";
  if (view.phase === "error") return "真实对话，连接失败";
  return view.session.upstream === "fixture" ? "真实对话，测试夹具" : "真实对话，已连接";
}

export function liveBadge(view: ConnectionView): string {
  if (view.phase === "ready") return view.session.upstream === "fixture" ? "测试夹具" : "已连接";
  if (view.phase === "checking") return "正在连接";
  if (view.phase === "error") return "失败";
  return "未连接";
}

export function liveNote(session: ServerSession): string {
  if (session.upstream === "fixture") {
    return `服务器声明这是测试夹具，不是真实模型。配置的模型名是 ${session.model}，这次没有调用它。`;
  }
  return `已连接。模型由服务器指定为 ${session.model}。`;
}
