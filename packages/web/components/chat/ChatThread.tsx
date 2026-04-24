/**
 * ChatThread - 聊天线程组件
 * 
 * 负责：
 * - 连接 assistant-ui LocalRuntime 到 API
 * - 消息完成后自动持久化
 * - 加载历史消息到 Runtime
 */

"use client";

import { useEffect, useMemo, useRef, useCallback } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useAssistantInstructions,
  useThreadRuntime,
} from "@assistant-ui/react";
import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";
import { useChatStore } from "@/stores/chat-store";
import type { ChatMessage } from "@qbot/core";

interface ChatThreadProps {
  selectedModel: string;
  systemPrompt: string;
  conversationId: string | null;
}

export function ChatThread({
  selectedModel,
  systemPrompt,
  conversationId,
}: ChatThreadProps) {
  // 获取持久化方法
  const appendMessages = useChatStore((s) => s.appendMessages);

  // 创建带持久化的适配器
  const createAdapter = useCallback(() => {
    return new PersistedQBotAdapter(selectedModel, conversationId, appendMessages);
  }, [selectedModel, conversationId, appendMessages]);

  // 使用 useMemo 保持 adapter 引用稳定（仅在 conversationId 变化时重建）
  const adapter = useMemo(() => createAdapter(), [createAdapter]);

  // 同步 model 变化
  useEffect(() => {
    adapter.setModel(selectedModel);
  }, [selectedModel, adapter]);

  // 同步 conversationId 变化
  useEffect(() => {
    adapter.setConversationId(conversationId);
  }, [conversationId, adapter]);

  const runtime = useLocalRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadInner systemPrompt={systemPrompt} />
    </AssistantRuntimeProvider>
  );
}

function ThreadInner({ systemPrompt }: { systemPrompt: string }) {
  useAssistantInstructions(systemPrompt);
  return <Thread />;
}

/**
 * 带持久化功能的 QBotAdapter
 * 
 * 在消息完成后自动保存到服务器
 */
class PersistedQBotAdapter implements ChatModelAdapter {
  private model: string;
  private conversationId: string | null;
  private appendMessages: (convId: string, messages: ChatMessage[]) => Promise<void>;

  constructor(
    model: string,
    conversationId: string | null,
    appendMessages: (convId: string, messages: ChatMessage[]) => Promise<void>
  ) {
    this.model = model;
    this.conversationId = conversationId;
    this.appendMessages = appendMessages;
  }

  setModel(model: string) {
    this.model = model;
  }

  setConversationId(id: string | null) {
    this.conversationId = id;
  }

  async *run({
    messages,
    abortSignal,
  }: Parameters<ChatModelAdapter["run"]>[0]): AsyncGenerator<ChatModelRunResult, void> {
    // 转换消息格式
    const apiMessages = messages.map((msg) => {
      const role = msg.role[0] as "user" | "assistant" | "system";

      if (msg.content && Array.isArray(msg.content)) {
        const texts = msg.content
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text);
        return { role, content: texts.join("") };
      }
      return { role, content: "" };
    });

    // 提取最后一条用户消息（用于持久化）
    const lastUserMessage = apiMessages[apiMessages.length - 1];

    // 调用 API
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: apiMessages,
        model: this.model,
        conversationId: this.conversationId,
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let fullText = "";

    // 流式处理响应
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);

            if (parsed.type === "text-delta" && parsed.delta) {
              fullText += parsed.delta;
              yield {
                content: [{ type: "text" as const, text: fullText }],
              };
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }

    // 最终 yield 完成状态
    yield {
      content: [{ type: "text" as const, text: fullText }],
      status: { type: "complete" as const, reason: "stop" as const },
    };

    // 🔑 关键：完成后自动持久化消息
    if (this.conversationId && lastUserMessage && fullText) {
      try {
        await this.appendMessages(this.conversationId, [
          lastUserMessage,
          { role: "assistant", content: fullText },
        ]);
      } catch (error) {
        console.error("Failed to persist messages:", error);
        // 不抛出错误，避免影响用户体验
      }
    }
  }
}
