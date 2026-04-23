'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useAssistantInstructions,
} from '@assistant-ui/react';
import type { ChatModelAdapter, ChatModelRunResult } from '@assistant-ui/react';
import { SettingsModal } from '@qbot/ui';
import { Settings, Plus, Trash2, Menu, X, Search, ChevronDown, ImageIcon } from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';
import { Thread } from '@/components/assistant-ui/thread';

// Adapter to connect assistant-ui LocalRuntime to our /api/chat endpoint
class QBotAdapter implements ChatModelAdapter {
  private model: string;
  private conversationId: string | null;

  constructor(model: string, conversationId: string | null) {
    this.model = model;
    this.conversationId = conversationId;
  }

  setModel(model: string) {
    this.model = model;
  }

  setConversationId(id: string | null) {
    this.conversationId = id;
  }

  async *run({ messages, abortSignal }: Parameters<ChatModelAdapter['run']>[0]): AsyncGenerator<ChatModelRunResult, void> {
    // Convert assistant-ui ThreadMessage format to simple API format
    const apiMessages = messages.map((msg) => {
      // msg.role can be a string like 'user' or an array like ['user']
      const role = (typeof msg.role === 'string' ? msg.role : msg.role[0]) as 'user' | 'assistant' | 'system';
      // Extract text from content array
      if (msg.content && Array.isArray(msg.content)) {
        const texts = msg.content
          .filter((p: any) => p.type === 'text')
          .map((p: any) => p.text);
        return { role, content: texts.join('') };
      }
      return { role, content: '' };
    });

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);

            if (parsed.type === 'text-delta' && parsed.delta) {
              fullText += parsed.delta;
              yield {
                content: [{ type: 'text' as const, text: fullText }],
              };
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }

    // Final yield with complete status
    yield {
      content: [{ type: 'text' as const, text: fullText }],
      status: { type: 'complete' as const, reason: 'stop' as const },
    };
  }
}

// ============ Model Selector ============

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  modality?: string;
}

function ModelSelector({
  selectedModel,
  onSelect,
}: {
  selectedModel: string;
  onSelect: (modelId: string) => void;
}) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/models')
      .then((r) => r.json())
      .then((data) => setModels(data.models || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredModels = useMemo(() => {
    if (!search.trim()) return models;
    const q = search.toLowerCase();
    return models.filter(
      (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
    );
  }, [models, search]);

  const groupedModels = useMemo(() => {
    const groups: Record<string, ModelInfo[]> = {};
    for (const model of filteredModels) {
      const key = model.provider || 'other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(model);
    }
    return groups;
  }, [filteredModels]);

  const selectedName = models.find((m) => m.id === selectedModel)?.name || selectedModel;

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
      >
        <span className="max-w-[200px] truncate">{selectedName}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl z-50 flex flex-col max-h-[70vh]">
          <div className="p-2 border-b border-gray-200 dark:border-gray-600">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-100 dark:bg-gray-700 rounded-md">
              <Search className="w-3.5 h-3.5 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
                autoFocus
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="p-4 text-center text-sm text-gray-400">Loading models...</div>
            ) : filteredModels.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-400">No models found</div>
            ) : (
              Object.entries(groupedModels).map(([provider, providerModels]) => (
                <div key={provider}>
                  <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 sticky top-0">
                    {provider.toUpperCase()}
                  </div>
                  {providerModels.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => {
                        onSelect(model.id);
                        setIsOpen(false);
                        setSearch('');
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center justify-between ${
                        model.id === selectedModel ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : ''
                      }`}
                    >
                      <span className="truncate flex-1">{model.name}</span>
                      {model.modality?.includes('image') && (
                        <ImageIcon className="w-3.5 h-3.5 text-gray-400 ml-2 flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ System Prompt Input ============

function SystemPromptInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-gray-200 dark:border-gray-700">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
      >
        <Settings className="w-3.5 h-3.5" />
        <span>System Prompt</span>
        {value && (
          <span className="text-xs text-blue-500 dark:text-blue-400">(set)</span>
        )}
      </button>
      {open && (
        <div className="px-4 pb-3">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Enter a system prompt to set the AI's behavior..."
            className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 resize-none outline-none focus:ring-1 focus:ring-blue-500"
            rows={3}
          />
        </div>
      )}
    </div>
  );
}

// ============ Chat Thread ============

function ChatThread({
  selectedModel,
  systemPrompt,
  conversationId,
}: {
  selectedModel: string;
  systemPrompt: string;
  conversationId: string | null;
}) {
  const adapter = useState(() => new QBotAdapter(selectedModel, conversationId))[0];

  useEffect(() => {
    adapter.setModel(selectedModel);
    adapter.setConversationId(conversationId);
  }, [selectedModel, conversationId, adapter]);

  const runtime = useLocalRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadInner systemPrompt={systemPrompt} />
    </AssistantRuntimeProvider>
  );
}

function ThreadInner({ systemPrompt }: { systemPrompt: string }) {
  useAssistantInstructions(systemPrompt);
  return (
    <div className="h-full w-full">
      <Thread />
    </div>
  );
}

// ============ Main Chat Page ============

export default function ChatPage() {
  const [user, setUser] = useState<{ name: string; email?: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState('');
  const router = useRouter();

  const {
    conversations,
    activeConversationId,
    selectedModel,
    createConversation,
    selectConversation,
    deleteConversation,
    setSelectedModel,
    loadConversations,
  } = useChatStore();

  // Check auth and load conversations
  useEffect(() => {
    const userStr = localStorage.getItem('qbot-user');
    if (!userStr) {
      router.push('/login');
      return;
    }
    try {
      const parsed = JSON.parse(userStr);
      setUser(parsed);
      loadConversations();
    } catch {
      router.push('/login');
    }
  }, [router, loadConversations]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem('qbot-user');
    router.push('/login');
  };

  if (!user) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-pulse text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-0'
        } transition-all duration-300 ease-in-out border-r border-gray-200 dark:border-gray-700 flex-shrink-0 overflow-hidden bg-white dark:bg-gray-800`}
      >
        <div className="h-full flex flex-col">
          <div className="p-3 border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={() => createConversation()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="font-medium">New Chat</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {conversations.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No conversations yet</p>
            ) : (
              <div className="space-y-1">
                {conversations.map((conv) => (
                  <div
                    key={conv.id}
                    onClick={() => selectConversation(conv.id)}
                    className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                      conv.id === activeConversationId
                        ? 'bg-gray-100 dark:bg-gray-700'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <span className="flex-1 text-sm truncate">{conv.title}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteConversation(conv.id);
                      }}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-200 dark:hover:bg-gray-600 transition-opacity"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

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
      <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <header className="h-14 flex-shrink-0 border-b border-gray-200 dark:border-gray-700 flex items-center px-4 gap-2 bg-white dark:bg-gray-800">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <h1 className="font-semibold">QBot</h1>
          <div className="flex-1" />
          <ModelSelector selectedModel={selectedModel} onSelect={setSelectedModel} />
        </header>

        <SystemPromptInput value={systemPrompt} onChange={setSystemPrompt} />

        <div className="flex-1 min-h-0 overflow-hidden">
          <ChatThread
            selectedModel={selectedModel}
            systemPrompt={systemPrompt}
            conversationId={activeConversationId}
          />
        </div>
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        user={{ name: user.name, email: user.email || '' }}
        onLogout={handleLogout}
      />
    </div>
  );
}
