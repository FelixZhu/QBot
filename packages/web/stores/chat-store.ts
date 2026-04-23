// packages/web/stores/chat-store.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import type { ChatMessage, ProviderType } from '@qbot/core';

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  provider: ProviderType;
}

interface ChatState {
  // Conversations
  conversations: ConversationMeta[];
  activeConversationId: string | null;

  // Messages (per conversation)
  messagesByConversation: Record<string, ChatMessage[]>;

  // Model settings
  selectedModel: string;

  // Actions
  createConversation: (title?: string) => string;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  updateConversationTitle: (id: string, title: string) => void;

  // Messages
  getMessages: (conversationId: string) => ChatMessage[];
  addMessage: (conversationId: string, message: ChatMessage) => void;
  setMessages: (conversationId: string, messages: ChatMessage[]) => void;
  clearMessages: (conversationId: string) => void;

  // Model
  setSelectedModel: (model: string) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeConversationId: null,
      messagesByConversation: {},
      selectedModel: 'anthropic/claude-3.5-sonnet',

      // Create a new conversation
      createConversation: (title) => {
        const id = nanoid();
        const now = new Date().toISOString();
        const newConv: ConversationMeta = {
          id,
          title: title || 'New Chat',
          createdAt: now,
          updatedAt: now,
          model: get().selectedModel,
          provider: 'openrouter',
        };
        set((state) => ({
          conversations: [newConv, ...state.conversations],
          activeConversationId: id,
          messagesByConversation: {
            ...state.messagesByConversation,
            [id]: [],
          },
        }));
        return id;
      },

      // Select a conversation
      selectConversation: (id) => {
        set({ activeConversationId: id });
      },

      // Delete a conversation
      deleteConversation: (id) => {
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

      // Update conversation title
      updateConversationTitle: (id, title) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === id ? { ...c, title, updatedAt: new Date().toISOString() } : c
          ),
        }));
      },

      // Get messages for a conversation
      getMessages: (conversationId) => {
        return get().messagesByConversation[conversationId] || [];
      },

      // Add a message to a conversation
      addMessage: (conversationId, message) => {
        set((state) => ({
          messagesByConversation: {
            ...state.messagesByConversation,
            [conversationId]: [
              ...(state.messagesByConversation[conversationId] || []),
              message,
            ],
          },
          conversations: state.conversations.map((c) =>
            c.id === conversationId
              ? { ...c, updatedAt: new Date().toISOString() }
              : c
          ),
        }));
      },

      // Set all messages for a conversation
      setMessages: (conversationId, messages) => {
        set((state) => ({
          messagesByConversation: {
            ...state.messagesByConversation,
            [conversationId]: messages,
          },
        }));
      },

      // Clear messages for a conversation
      clearMessages: (conversationId) => {
        set((state) => ({
          messagesByConversation: {
            ...state.messagesByConversation,
            [conversationId]: [],
          },
        }));
      },

      // Set selected model
      setSelectedModel: (model) => {
        set({ selectedModel: model });
      },
    }),
    {
      name: 'qbot-chat-storage',
      partialize: (state) => ({
        conversations: state.conversations,
        messagesByConversation: state.messagesByConversation,
        selectedModel: state.selectedModel,
      }),
    }
  )
);
