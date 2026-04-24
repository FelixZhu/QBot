/**
 * Chat Store - 统一的聊天状态管理
 * 
 * 职责：
 * - 会话列表管理
 * - 消息缓存
 * - 模型选择持久化
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatMessage, ProviderType } from "@qbot/core";
import { conversationApi } from "@/lib/api";

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  provider: ProviderType;
}

interface ChatState {
  // 会话列表
  conversations: ConversationMeta[];
  activeConversationId: string | null;

  // 消息缓存（按会话 ID 索引）
  messagesByConversation: Record<string, ChatMessage[]>;

  // 模型设置
  selectedModel: string;

  // 加载状态
  isLoading: boolean;

  // ============ Actions ============

  // 会话操作
  loadConversations: () => Promise<void>;
  createConversation: (title?: string) => Promise<string>;
  selectConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  updateConversationTitle: (id: string, title: string) => Promise<void>;

  // 消息操作
  getMessages: (conversationId: string) => ChatMessage[];
  setMessages: (conversationId: string, messages: ChatMessage[]) => void;
  appendMessages: (conversationId: string, messages: ChatMessage[]) => Promise<void>;

  // 模型选择
  setSelectedModel: (model: string) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeConversationId: null,
      messagesByConversation: {},
      selectedModel: "anthropic/claude-3.5-sonnet",
      isLoading: false,

      // ============ 会话操作 ============

      loadConversations: async () => {
        set({ isLoading: true });
        try {
          const data = await conversationApi.list();
          const conversations = data.conversations.map((c) => ({
            id: c.id,
            title: c.title,
            createdAt: c.createdAt,
            updatedAt: c.createdAt, // API 返回的是 createdAt，用同样的值
            model: "anthropic/claude-3.5-sonnet",
            provider: "openrouter" as ProviderType,
          }));
          set({ conversations });
        } catch (error) {
          console.error("Failed to load conversations:", error);
        } finally {
          set({ isLoading: false });
        }
      },

      createConversation: async (title) => {
        const data = await conversationApi.create(title || "New Chat");
        const conv: ConversationMeta = {
          id: data.id,
          title: data.title,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          model: get().selectedModel,
          provider: "openrouter",
        };

        set((state) => ({
          conversations: [conv, ...state.conversations],
          activeConversationId: conv.id,
          messagesByConversation: {
            ...state.messagesByConversation,
            [conv.id]: [],
          },
        }));

        return conv.id;
      },

      selectConversation: async (id) => {
        set({ activeConversationId: id });

        try {
          const data = await conversationApi.get(id);
          set((state) => ({
            messagesByConversation: {
              ...state.messagesByConversation,
              [id]: data.conversation.messages,
            },
          }));
        } catch (error) {
          console.error("Failed to load conversation:", error);
        }
      },

      deleteConversation: async (id) => {
        await conversationApi.delete(id);

        set((state) => {
          const { [id]: _, ...remainingMessages } = state.messagesByConversation;
          return {
            conversations: state.conversations.filter((c) => c.id !== id),
            activeConversationId:
              state.activeConversationId === id ? null : state.activeConversationId,
            messagesByConversation: remainingMessages,
          };
        });
      },

      updateConversationTitle: async (id, title) => {
        await conversationApi.update(id, { title });

        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === id ? { ...c, title, updatedAt: new Date().toISOString() } : c
          ),
        }));
      },

      // ============ 消息操作 ============

      getMessages: (conversationId) => {
        return get().messagesByConversation[conversationId] || [];
      },

      setMessages: (conversationId, messages) => {
        set((state) => ({
          messagesByConversation: {
            ...state.messagesByConversation,
            [conversationId]: messages,
          },
        }));
      },

      appendMessages: async (conversationId, messages) => {
        await conversationApi.appendMessages(conversationId, messages);

        set((state) => ({
          messagesByConversation: {
            ...state.messagesByConversation,
            [conversationId]: [
              ...(state.messagesByConversation[conversationId] || []),
              ...messages,
            ],
          },
          conversations: state.conversations.map((c) =>
            c.id === conversationId
              ? { ...c, updatedAt: new Date().toISOString() }
              : c
          ),
        }));
      },

      // ============ 模型选择 ============

      setSelectedModel: (model) => {
        set({ selectedModel: model });
      },
    }),
    {
      name: "qbot-chat-storage",
      partialize: (state) => ({
        selectedModel: state.selectedModel,
      }),
    }
  )
);
