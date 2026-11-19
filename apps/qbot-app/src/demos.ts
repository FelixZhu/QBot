import type { ChatModelAdapter } from "@assistant-ui/react-native";

export type DemoId = "info" | "english" | "study";
export type DemoLine = { role: "user" | "assistant"; text: string };
export type Demo = {
  id: DemoId;
  name: string;
  preview: string;
  note: string;
  messages: DemoLine[];
  suggestions: string[];
};

/** Scripted demos. Not a live bot, not real news, and not a private chat. */
export const DEMOS: Demo[] = [
  {
    id: "info",
    name: "Info Bot",
    preview: "演示：虚构简报，不是实时新闻",
    note: "演示会话，没有接通 Info Bot。下面是虚构示例，不是新闻、引用、日期或价格。",
    messages: [
      { role: "user", text: "演示：给我看一条资讯简报" },
      { role: "assistant", text: "演示回复：这是虚构示例。\n\n1. 示例小镇把周末市集延长到傍晚。\n2. 示例图书馆增加了一个晚间阅览室。\n3. 示例出版社出了一本讲笔记方法的小书。\n\n没有来源，也没有价格。" },
    ],
    suggestions: ["演示：再给一条更短的简报", "演示：把第二条改成一句话"],
  },
  {
    id: "english",
    name: "English Bot",
    preview: "演示：工作邮件句子可以更自然",
    note: "演示会话，没有接通 English Bot。用来练习工作英语，不是你的真实邮件。",
    messages: [
      { role: "user", text: "演示：请改这句工作邮件：I am write to follow up the file." },
      { role: "assistant", text: "演示回复：这句可以更自然。\n\n改写：I am writing to follow up on the file.\n\n更礼貌：Could you let me know if you had a chance to review the file?" },
    ],
    suggestions: ["演示：Send me the file now 这样说礼貌吗", "演示：再给一个更正式的开头"],
  },
  {
    id: "study",
    name: "Study Bot",
    preview: "演示：用一句话说明 AI Agent",
    note: "演示会话，没有接通 Study Bot。只讲概念，不读取资料或私人记录。",
    messages: [
      { role: "user", text: "演示：用一句话说明 AI Agent" },
      { role: "assistant", text: "演示回复：AI Agent 是能按一个目标自己拆步骤、使用工具，并检查结果的程序。普通问答只回答一句，Agent 会继续把事情做完。" },
    ],
    suggestions: ["演示：Agent 和聊天机器人有什么差别", "演示：用生活例子说明工具调用"],
  },
];

export function findDemo(id: DemoId | null): Demo | null {
  return DEMOS.find((demo) => demo.id === id) ?? null;
}

export function filterDemos(query: string): Demo[] {
  const q = query.trim().toLowerCase();
  if (!q) return DEMOS;
  return DEMOS.filter((demo) =>
    demo.name.toLowerCase().includes(q) ||
    demo.preview.toLowerCase().includes(q) ||
    demo.messages.some((line) => line.text.toLowerCase().includes(q)),
  );
}

export function localReply(id: DemoId, text: string): string {
  if (id === "info") {
    return text.includes("一句话")
      ? "演示回复：示例图书馆今晚多开一间阅览室。虚构示例，没有接通 Info Bot。"
      : "演示回复：再补一条虚构简报：示例小镇的周末市集增加了手作摊位。不是实时新闻，没有价格。";
  }
  if (id === "english") {
    return text.toLowerCase().includes("send me")
      ? "演示回复：Send me the file now 偏生硬。更礼貌：Could you send me the file when you have a moment?"
      : "演示回复：更正式的开头可以是：I hope you are well. I am writing to follow up on our last note.";
  }
  return text.includes("差别")
    ? "演示回复：聊天机器人停在一句回答。Agent 会自己选择下一步，并使用工具完成目标。这是概念示例。"
    : "演示回复：生活例子：你说“订一张去示例城的票”，Agent 会查时刻、比较方案，再把结果交给你确认。没有接通 Study Bot。";
}

function textOf(message: { content: unknown }): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (!part || typeof part !== "object") return "";
    const record = part as { type?: string; text?: string };
    return record.type === "text" && typeof record.text === "string" ? record.text : "";
  }).join("");
}

/** Local script only. Yields the full reply; nothing is sent to a model or network. */
export function createDemoAdapter(id: DemoId): ChatModelAdapter {
  return {
    async *run({ messages }) {
      const last = messages[messages.length - 1];
      const reply = localReply(id, last ? textOf(last) : "");
      const mid = Math.max(1, Math.ceil(reply.length / 2));
      yield { content: [{ type: "text", text: reply.slice(0, mid) }] };
      yield { content: [{ type: "text", text: reply }] };
    },
  };
}
