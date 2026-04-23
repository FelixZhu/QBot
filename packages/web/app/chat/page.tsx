'use client';

import { useState, useCallback } from 'react';
import { ChatView, ModelSelector, useChat } from '@qbot/ui';
import type { ChatMessage, CompletionResult } from '@qbot/core';

const MODELS = [
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'openrouter' },
  { id: 'openai/gpt-4', name: 'GPT-4', provider: 'openrouter' },
  { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek' },
];

export default function ChatPage() {
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);

  const chatFn = useCallback(async (messages: ChatMessage[]): Promise<CompletionResult> => {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, model: selectedModel })
    });

    if (!response.ok) {
      throw new Error('Chat request failed');
    }

    return response.json();
  }, [selectedModel]);

  const { messages, isLoading, sendMessage, error } = useChat(chatFn);

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b p-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">QBot Chat</h1>
        <ModelSelector
          models={MODELS}
          selectedModel={selectedModel}
          onSelect={setSelectedModel}
        />
      </header>
      <main className="flex-1 overflow-hidden">
        <ChatView
          messages={messages}
          onSendMessage={sendMessage}
          isLoading={isLoading}
        />
      </main>
      {error && (
        <div className="bg-red-100 text-red-700 p-2 text-center">
          {error.message}
        </div>
      )}
    </div>
  );
}
