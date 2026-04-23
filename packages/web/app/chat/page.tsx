'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChatView, ModelSelector, useChat } from '@qbot/ui';
import type { ChatMessage, CompletionResult } from '@qbot/core';

const MODELS = [
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'openrouter' },
  { id: 'openai/gpt-4', name: 'GPT-4', provider: 'openrouter' },
  { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek' },
];

export default function ChatPage() {
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const [user, setUser] = useState<{ name: string } | null>(null);
  const router = useRouter();

  useEffect(() => {
    const userStr = localStorage.getItem('qbot-user');
    if (!userStr) {
      router.push('/login');
      return;
    }
    try {
      setUser(JSON.parse(userStr));
    } catch {
      router.push('/login');
    }
  }, [router]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    localStorage.removeItem('qbot-user');
    router.push('/login');
  };

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

  if (!user) {
    return (
      <div className="h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b p-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">QBot Chat</h1>
        <div className="flex items-center gap-4">
          <ModelSelector
            models={MODELS}
            selectedModel={selectedModel}
            onSelect={setSelectedModel}
          />
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">{user.name}</span>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Logout
            </button>
          </div>
        </div>
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
