"use client";

import { memo, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Settings, Plus, Trash2, Menu, X } from "lucide-react";
import { useChatStore, type ConversationMeta } from "@/stores/chat-store";
import { authApi } from "@/lib/api";
import {
  ModelSelector,
  SystemPromptInput,
  ChatThread,
} from "@/components/chat";
import { SettingsModal } from "@/components/settings";

// 会话列表项 - 使用 memo 优化
const ConversationItem = memo(function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onDelete,
}: {
  conversation: ConversationMeta;
  isActive: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
        isActive ? "bg-muted" : "hover:bg-muted/50"
      }`}
    >
      <span className="flex-1 text-sm truncate">{conversation.title}</span>
      <button
        onClick={onDelete}
        className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity"
      >
        <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
      </button>
    </div>
  );
});

export default function ChatPage() {
  const [user, setUser] = useState<{ name: string; email?: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState("");
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

  // 检查认证并加载会话
  useEffect(() => {
    if (typeof window === "undefined") return;

    const userStr = localStorage.getItem("qbot-user");
    if (!userStr) {
      router.push("/login");
      return;
    }

    try {
      const parsed = JSON.parse(userStr);
      setUser(parsed);
      loadConversations();
    } catch {
      router.push("/login");
    }
  }, [router, loadConversations]);

  // 登出处理
  const handleLogout = useCallback(async () => {
    await authApi.logout().catch(() => {});
    localStorage.removeItem("qbot-user");
    router.push("/login");
  }, [router]);

  // 创建新会话
  const handleNewChat = useCallback(() => {
    createConversation();
  }, [createConversation]);

  // 切换侧边栏
  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  // 打开设置
  const openSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  // 关闭设置
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  // 设置 systemPrompt
  const handleSystemPromptChange = useCallback((value: string) => {
    setSystemPrompt(value);
  }, []);

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
        className={`${
          sidebarOpen ? "w-64" : "w-0"
        } transition-all duration-300 ease-in-out border-r flex-shrink-0 overflow-hidden bg-card`}
      >
        <div className="h-full flex flex-col">
          {/* New Chat 按钮 */}
          <div className="p-3 border-b">
            <button
              onClick={handleNewChat}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border hover:bg-muted transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="font-medium">New Chat</span>
            </button>
          </div>

          {/* 会话列表 */}
          <div className="flex-1 overflow-y-auto p-2">
            {conversations.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No conversations yet
              </p>
            ) : (
              <div className="space-y-1">
                {conversations.map((conv) => (
                  <ConversationItem
                    key={conv.id}
                    conversation={conv}
                    isActive={conv.id === activeConversationId}
                    onSelect={() => selectConversation(conv.id)}
                    onDelete={(e) => {
                      e.stopPropagation();
                      deleteConversation(conv.id);
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 用户设置入口 */}
          <div className="p-3 border-t">
            <div
              onClick={openSettings}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted cursor-pointer"
            >
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-sm font-medium text-primary">
                  {user.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user.name}</p>
                {user.email && (
                  <p className="text-xs text-muted-foreground truncate">
                    {user.email}
                  </p>
                )}
              </div>
              <Settings className="w-4 h-4 text-muted-foreground" />
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 border-b flex items-center px-4 gap-2 bg-card">
          <button
            onClick={toggleSidebar}
            className="p-2 hover:bg-muted rounded-lg"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <h1 className="font-semibold">QBot</h1>
          <div className="flex-1" />
          <ModelSelector
            selectedModel={selectedModel}
            onSelect={setSelectedModel}
          />
        </header>

        {/* System Prompt Input */}
        <SystemPromptInput value={systemPrompt} onChange={handleSystemPromptChange} />

        {/* Chat Thread */}
        <ChatThread
          selectedModel={selectedModel}
          systemPrompt={systemPrompt}
          conversationId={activeConversationId}
        />
      </main>

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={closeSettings}
        user={{ name: user.name, email: user.email || "" }}
        onLogout={handleLogout}
      />
    </div>
  );
}
