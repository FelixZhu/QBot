"use client";

import { useState, useEffect, useMemo } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useAssistantInstructions,
} from "@assistant-ui/react";
import { QBotAdapter } from "@/lib/adapters";
import { Thread } from "@/components/assistant-ui/thread";

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
  // 使用 useMemo 保持 adapter 引用稳定
  const adapter = useMemo(
    () => new QBotAdapter(selectedModel, conversationId),
    // 仅在 conversationId 变化时创建新实例
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversationId]
  );

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
