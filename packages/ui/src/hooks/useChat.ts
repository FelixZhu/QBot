import { useState, useCallback } from 'react';
import type { ChatMessage, CompletionResult } from '@qbot/core';

export interface UseChatOptions {
  initialMessages?: ChatMessage[];
  onMessage?: (result: CompletionResult) => void;
  onError?: (error: Error) => void;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
  error: Error | null;
}

export function useChat(
  chatFn: (messages: ChatMessage[]) => Promise<CompletionResult>,
  options: UseChatOptions = {}
): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>(options.initialMessages || []);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const sendMessage = useCallback(async (content: string) => {
    const userMessage: ChatMessage = { role: 'user', content };
    const newMessages = [...messages, userMessage];

    setMessages(newMessages);
    setIsLoading(true);
    setError(null);

    try {
      const result = await chatFn(newMessages);
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: result.content
      };

      setMessages([...newMessages, assistantMessage]);
      options.onMessage?.(result);
    } catch (err) {
      const error = err as Error;
      setError(error);
      options.onError?.(error);
    } finally {
      setIsLoading(false);
    }
  }, [messages, chatFn, options]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    sendMessage,
    clearMessages,
    error
  };
}
