'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { ModelSelector, SettingsModal } from '@qbot/ui';
import { Settings, Plus, Trash2, Menu, X, Send } from 'lucide-react';
import { useChatStore, type ConversationMeta } from '@/stores/chat-store';
import type { ChatMessage } from '@qbot/core';

const MODELS = [
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'openrouter' },
  { id: 'openai/gpt-4', name: 'GPT-4', provider: 'openrouter' },
  { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek' },
];

// Helper to extract text from UIMessage
const getMessageText = (msg: UIMessage): string => {
  const textPart = msg.parts.find((p) => p.type === 'text');
  return textPart && 'text' in textPart ? textPart.text : '';
};

// Helper to create UIMessage from text
const createUIMessage = (role: 'user' | 'assistant', content: string): UIMessage => ({
  id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  role,
  parts: [{ type: 'text', text: content }],
});

// Conversation Item Component
const ConversationItem = ({
  conversation,
  isActive,
  onSelect,
  onDelete,
}: {
  conversation: ConversationMeta;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) => (
  <div
    onClick={onSelect}
    className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
      isActive
        ? 'bg-gray-100 dark:bg-gray-700'
        : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
    }`}
  >
    <span className="flex-1 text-sm truncate">{conversation.title}</span>
    <button
      onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
      className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-200 dark:hover:bg-gray-600 transition-opacity"
    >
      <Trash2 className="w-3.5 h-3.5 text-gray-400" />
    </button>
  </div>
);

export default function ChatPage() {
  const [user, setUser] = useState<{ name: string; email?: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [input, setInput] = useState('');
  const router = useRouter();

  const {
    conversations,
    activeConversationId,
    selectedModel,
    createConversation,
    selectConversation,
    deleteConversation,
    updateConversationTitle,
    getMessages,
    setMessages,
    setSelectedModel,
  } = useChatStore();

  // Use Vercel AI SDK's useChat hook
  const chat = useChat();
  const { messages, sendMessage, status, setMessages: setChatMessages } = chat;
  const isLoading = status === 'streaming' || status === 'submitted';

  // Sync chat messages to store when they change
  useEffect(() => {
    if (activeConversationId && messages.length > 0) {
      const storeMessages: ChatMessage[] = messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: getMessageText(m),
      }));
      setMessages(activeConversationId, storeMessages);
    }
  }, [messages, activeConversationId, setMessages]);

  // Check auth
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

  // Load messages when selecting conversation
  useEffect(() => {
    if (activeConversationId) {
      const storedMessages = getMessages(activeConversationId);
      setChatMessages(storedMessages.map((m, i) => createUIMessage(m.role as 'user' | 'assistant', m.content)));
    } else {
      setChatMessages([]);
    }
  }, [activeConversationId, getMessages, setChatMessages]);

  // Handle new chat
  const handleNewChat = useCallback(() => {
    createConversation();
    setChatMessages([]);
    setInput('');
  }, [createConversation, setChatMessages]);

  // Handle logout
  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    localStorage.removeItem('qbot-user');
    router.push('/login');
  };

  // Handle send message
  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const messageContent = input;
    setInput('');

    // Create conversation if needed
    let convId = activeConversationId;
    if (!convId) {
      convId = createConversation(messageContent.slice(0, 30));
      selectConversation(convId);
    }

    // Send message via API
    try {
      const currentMsgs = getMessages(convId);
      const allMessages = [...currentMsgs, { role: 'user' as const, content: messageContent }];

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: allMessages, model: selectedModel }),
      });

      if (!response.ok) throw new Error('Chat request failed');

      // Handle streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          assistantContent += decoder.decode(value, { stream: true });
        }
      }

      // Update messages in store
      setMessages(convId, [
        ...allMessages,
        { role: 'assistant', content: assistantContent },
      ]);

      // Update title if first message
      if (currentMsgs.length === 0) {
        updateConversationTitle(convId, messageContent.slice(0, 30) + (messageContent.length > 30 ? '...' : ''));
      }
    } catch (error) {
      console.error('Chat error:', error);
    }
  }, [
    input,
    isLoading,
    activeConversationId,
    createConversation,
    selectConversation,
    getMessages,
    setMessages,
    selectedModel,
    updateConversationTitle,
  ]);

  // Handle form submit
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSend();
  };

  if (!user) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-pulse text-gray-400">Loading...</div>
      </div>
    );
  }

  // Get current messages from store
  const currentMessages = activeConversationId ? getMessages(activeConversationId) : [];

  return (
    <div className="h-screen flex bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <aside
        className={`
          ${sidebarOpen ? 'w-64' : 'w-0'}
          transition-all duration-300 ease-in-out
          border-r border-gray-200 dark:border-gray-700
          flex-shrink-0 overflow-hidden
          bg-white dark:bg-gray-800
        `}
      >
        <div className="h-full flex flex-col">
          {/* Sidebar Header */}
          <div className="p-3 border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={handleNewChat}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="font-medium">New Chat</span>
            </button>
          </div>

          {/* Conversations List */}
          <div className="flex-1 overflow-y-auto p-2">
            {conversations.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No conversations yet</p>
            ) : (
              <div className="space-y-1">
                {conversations.map((conv) => (
                  <ConversationItem
                    key={conv.id}
                    conversation={conv}
                    isActive={conv.id === activeConversationId}
                    onSelect={() => selectConversation(conv.id)}
                    onDelete={() => deleteConversation(conv.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Sidebar Footer */}
          <div className="p-3 border-t border-gray-200 dark:border-gray-700">
            <div
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
            >
              <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                  {user.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user.name}</p>
                {user.email && (
                  <p className="text-xs text-gray-500 truncate">{user.email}</p>
                )}
              </div>
              <Settings className="w-4 h-4 text-gray-400" />
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 border-b border-gray-200 dark:border-gray-700 flex items-center px-4 gap-2 bg-white dark:bg-gray-800">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <h1 className="font-semibold">QBot</h1>
          <div className="flex-1" />
          <ModelSelector
            models={MODELS}
            selectedModel={selectedModel}
            onSelect={setSelectedModel}
          />
        </header>

        {/* Chat Area */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4">
            {currentMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center mb-4">
                  <span className="text-2xl">🤖</span>
                </div>
                <h2 className="text-xl font-semibold mb-2">How can I help you today?</h2>
                <p className="text-gray-500 dark:text-gray-400 max-w-md">
                  I'm your AI assistant. Ask me anything and I'll do my best to help.
                </p>
              </div>
            ) : (
              <div className="max-w-3xl mx-auto space-y-4">
                {currentMessages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : ''}`}
                  >
                    {m.role === 'assistant' && (
                      <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-sm">🤖</span>
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                        m.role === 'user'
                          ? 'bg-blue-500 text-white'
                          : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700'
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    </div>
                    {m.role === 'user' && (
                      <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm">{user.name.charAt(0).toUpperCase()}</span>
                      </div>
                    )}
                  </div>
                ))}
                {isLoading && (
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-sm">🤖</span>
                    </div>
                    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl px-4 py-3">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Input Area */}
          <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
            <form onSubmit={onSubmit} className="max-w-3xl mx-auto">
              <div className="flex gap-2 bg-gray-100 dark:bg-gray-700 rounded-2xl px-4 py-3">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Message QBot..."
                  className="flex-1 bg-transparent outline-none text-base placeholder:text-gray-400"
                  disabled={isLoading}
                />
                <button
                  type="submit"
                  disabled={isLoading || !input.trim()}
                  className="px-4 py-1.5 rounded-xl bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-300 disabled:dark:bg-gray-600 disabled:text-gray-500 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        user={{ name: user.name, email: user.email || '' }}
        onLogout={handleLogout}
      />
    </div>
  );
}
