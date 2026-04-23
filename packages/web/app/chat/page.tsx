'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AssistantRuntimeProvider, useAssistantInstructions } from '@assistant-ui/react';
import { useChatRuntime, AssistantChatTransport } from '@assistant-ui/react-ai-sdk';
import { SimpleImageAttachmentAdapter } from '@assistant-ui/react';
import type { UIMessage } from 'ai';
import { SettingsModal } from '@qbot/ui';
import { Settings, Menu, X, Search, ChevronDown, ImageIcon, PanelLeftClose, PanelLeft } from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';
import { Thread } from '@/components/assistant-ui/thread';
import { cn } from '@/lib/utils';

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
        className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
      >
        <span className="max-w-[200px] truncate">{selectedName}</span>
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1 w-80 rounded-lg border bg-popover text-popover-foreground shadow-xl z-50 flex flex-col max-h-[70vh]">
          <div className="p-2 border-b">
            <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-1.5">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                autoFocus
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Loading models...</div>
            ) : filteredModels.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">No models found</div>
            ) : (
              Object.entries(groupedModels).map(([provider, providerModels]) => (
                <div key={provider}>
                  <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50 sticky top-0">
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
                      className={cn(
                        'w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between',
                        model.id === selectedModel && 'bg-primary/10 text-primary'
                      )}
                    >
                      <span className="truncate flex-1">{model.name}</span>
                      {model.modality?.includes('image') && (
                        <ImageIcon className="w-3.5 h-3.5 text-muted-foreground ml-2 flex-shrink-0" />
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
    <div className="border-b">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <Settings className="w-3.5 h-3.5" />
        <span>System Prompt</span>
        {value && (
          <span className="text-xs text-primary">(set)</span>
        )}
      </button>
      {open && (
        <div className="px-4 pb-3">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Enter a system prompt to set the AI's behavior..."
            className="w-full text-sm border rounded-lg px-3 py-2 bg-background resize-none outline-none focus:ring-1 focus:ring-ring"
            rows={3}
          />
        </div>
      )}
    </div>
  );
}

// ============ Chat Thread ============

class QBotChatTransport extends AssistantChatTransport<UIMessage> {
  setBody(body: object) {
    (this as any).body = body;
  }
}

function ChatThread({
  selectedModel,
  systemPrompt,
  conversationId,
}: {
  selectedModel: string;
  systemPrompt: string;
  conversationId: string | null;
}) {
  const transport = useMemo(
    () =>
      new QBotChatTransport({
        api: '/api/chat',
        body: { model: selectedModel, conversationId },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    transport.setBody({ model: selectedModel, conversationId });
  }, [selectedModel, conversationId, transport]);

  const runtime = useChatRuntime({
    transport,
    adapters: {
      attachments: new SimpleImageAttachmentAdapter(),
    },
  });

  useAssistantInstructions(systemPrompt);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
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
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          'transition-all duration-300 ease-in-out border-r flex-shrink-0 overflow-hidden bg-card',
          sidebarOpen ? 'w-64' : 'w-0'
        )}
      >
        <div className="h-full flex flex-col">
          <div className="p-3 border-b">
            <button
              onClick={() => createConversation()}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 py-2.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              New Chat
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {conversations.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No conversations yet</p>
            ) : (
              <div className="space-y-0.5">
                {conversations.map((conv) => (
                  <div
                    key={conv.id}
                    onClick={() => selectConversation(conv.id)}
                    className={cn(
                      'group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors text-sm',
                      conv.id === activeConversationId
                        ? 'bg-accent text-accent-foreground'
                        : 'text-foreground hover:bg-accent/50'
                    )}
                  >
                    <span className="flex-1 truncate">{conv.title}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteConversation(conv.id);
                      }}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-3 border-t">
            <div
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent cursor-pointer transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <span className="text-sm font-medium">
                  {user.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user.name}</p>
                {user.email && (
                  <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                )}
              </div>
              <Settings className="w-4 h-4 text-muted-foreground" />
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b flex items-center px-3 gap-2 bg-card">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 hover:bg-accent rounded-md transition-colors text-muted-foreground hover:text-foreground"
          >
            {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
          </button>
          <h1 className="font-semibold text-sm">QBot</h1>
          <div className="flex-1" />
          <ModelSelector selectedModel={selectedModel} onSelect={setSelectedModel} />
        </header>

        <SystemPromptInput value={systemPrompt} onChange={setSystemPrompt} />

        <ChatThread
          selectedModel={selectedModel}
          systemPrompt={systemPrompt}
          conversationId={activeConversationId}
        />
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
