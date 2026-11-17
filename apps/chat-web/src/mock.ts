import type { BackendReply, ChatBackend, ChatTurn } from "./backend";

export type MockMode = "stream" | "whole";

const CANNED: { match: RegExp; text: string }[] = [
  {
    match: /护照|签证/,
    text: [
      "**护照 2026-12-24 到期**，还有 37 天。",
      "",
      "续签要准备：",
      "1. 旧护照原件",
      "2. 身份证正反面",
      "3. 近 6 个月的白底照片",
      "",
      "来源：知识库里的护照扫描件。要我周五提醒你预约吗？",
    ].join("\n"),
  },
  {
    match: /周报|本周|总结/,
    text: [
      "**本周小结**（演示数据）",
      "",
      "| 事项 | 状态 | 下一步 |",
      "| --- | --- | --- |",
      "| AI Infra 学习 | 第 3/30 天 | 今晚读 KV Cache |",
      "| 每日英语 | 连续 5 天 | 明早 7:57 推送 |",
      "",
      "要我把它整理成一页发你吗？",
    ].join("\n"),
  },
  {
    match: /日报|AI|资讯|新闻/,
    text: [
      "**今天的 AI 日报有 3 条值得看：**",
      "",
      "- 开源推理框架集体提速，端侧模型进入 3B 时代",
      "- 两篇 MoE 路由论文，结论相近，值得对照读",
      "- 一家 AI 芯片公司提交 IPO 招股书",
      "",
      "完整日报在「主动服务」里。",
    ].join("\n"),
  },
  {
    match: /出差|上海|美国|航班|酒店/,
    text: [
      "**下周三去上海**，08:30 虹桥落地，酒店在静安。",
      "",
      "> 当天下午 3 点有个会，地址我已经放进日程了。",
      "",
      "需要我把行程整理成一页发你吗？",
    ].join("\n"),
  },
];

const FALLBACK = [
  "收到。这是一条**模拟回复**，真实回复要等后端接好之后才有。",
  "",
  "现在可以先看看：",
  "- 回复的排版（粗体、列表、`代码`、表格）",
  "- 等待时的「正在想」状态",
  "- 等待中继续发消息，会排在后面依次回复",
].join("\n");

function pick(history: readonly ChatTurn[]): string {
  const last = [...history].reverse().find((t) => t.role === "user")?.text ?? "";
  return CANNED.find((c) => c.match.test(last))?.text ?? FALLBACK;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    }, { once: true });
  });
}

/** Mock backend: 1–3 s delay (or a fixed one for testing), then a canned Chinese reply. */
export class MockBackend implements ChatBackend {
  constructor(
    public mode: MockMode,
    private fixedDelayMs?: number,
  ) {}

  get label() {
    return this.mode === "stream" ? "模拟 · 流式" : "模拟 · 整段";
  }

  private delay() {
    return this.fixedDelayMs ?? 1000 + Math.random() * 2000;
  }

  reply(history: readonly ChatTurn[], signal: AbortSignal): BackendReply {
    const text = pick(history);
    if (this.mode === "whole") {
      return { kind: "whole", text: sleep(this.delay(), signal).then(() => text) };
    }
    const delay = this.delay();
    async function* chunks() {
      await sleep(Math.min(delay, 1200), signal);
      for (let i = 0; i < text.length; ) {
        const n = 2 + Math.floor(Math.random() * 4);
        yield text.slice(i, i + n);
        i += n;
        await sleep(30, signal);
      }
    }
    return { kind: "stream", chunks: chunks() };
  }
}
