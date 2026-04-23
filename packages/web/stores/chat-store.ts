// packages/web/stores/chat-store.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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
  // Conversations (indexed from local storage)
  conversations: ConversationMeta[];
  activeConversationId: string | null;

  // Messages (per conversation, cached in memory)
  messagesByConversation: Record<string, ChatMessage[]>;

  // Model settings
  selectedModel: string;

  // Loading state
  isLoading: boolean;

  // Actions
  loadConversations: () => Promise<void>;
  createConversation: (title?: string) => Promise<string>;
  selectConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  updateConversationTitle: (id: string, title: string) => Promise<void>;

  // Messages
  getMessages: (conversationId: string) => ChatMessage[];
  addMessage: (conversationId: string, message: ChatMessage) => void;
  setMessages: (conversationId: string, messages: ChatMessage[]) => void;
  clearMessages: (conversationId: string) => void;
  appendMessages: (conversationId: string, messages: ChatMessage[]) => Promise<void>;

  // Model
  setSelectedModel: (model: string) => void;

  // Sync
  syncStatus: 'idle' | 'syncing' | 'error';
  lastSyncAt: number | null;
  triggerSync: () => Promise<void>;
}

// Helper to call the local file API
async function fileApi<T>(action: string, payload?: unknown): Promise<T> {
  const res = await fetch('/api/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeConversationId: null,
      messagesByConversation: {},
      selectedModel: 'anthropic/claude-3.5-sonnet',
      isLoading: false,
      syncStatus: 'idle',
      lastSyncAt: null,

      // Load all conversations from local storage
      loadConversations: async () => {
        set({ isLoading: true });
        try {
          const data = await fileApi<{ conversations: ConversationMeta[] }>('listConversations');
          set({ conversations: data.conversations });
        } catch (error) {
          console.error('Failed to load conversations:', error);
        } finally {
          set({ isLoading: false });
        }
      },

      // Create a new conversation
      createConversation: async (title) => {
        const data = await fileApi<{ conversation: ConversationMeta }>('createConversation', {
          title: title || 'New Chat',
          model: get().selectedModel,
          provider: 'openrouter',
        });
        const conv = data.conversation;
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

      // Select a conversation and load its messages
      selectConversation: async (id) => {
        set({ activeConversationId: id });
        try {
          const data = await fileApi<{ messages: ChatMessage[] }>('getMessages', { conversationId: id });
          set((state) => ({
            messagesByConversation: {
              ...state.messagesByConversation,
              [id]: data.messages,
            },
          }));
        } catch (error) {
          console.error('Failed to load conversation:', error);
        }
      },

      // Delete a conversation
      deleteConversation: async (id) => {
        await fileApi('deleteConversation', { conversationId: id });
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
      updateConversationTitle: async (id, title) => {
        await fileApi('updateMeta', { conversationId: id, updates: { title } });
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === id ? { ...c, title, updatedAt: new Date().toISOString() } : c
          ),
        }));
      },

      // Get messages from local cache
      getMessages: (conversationId) => {
        return get().messagesByConversation[conversationId] || [];
      },

      // Add a single message to local cache
      addMessage: (conversationId, message) => {
        set((state) => ({
          messagesByConversation: {
            ...state.messagesByConversation,
            [conversationId]: [
              ...(state.messagesByConversation[conversationId] || []),
              message,
            ],
          },
        }));
      },

      // Set all messages for a conversation (local cache)
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

      // Append messages to local storage and update cache
      appendMessages: async (conversationId, messages) => {
        await fileApi('appendMessages', { conversationId, messages });
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

      // Set selected model
      setSelectedModel: (model) => {
        set({ selectedModel: model });
      },

      // Trigger sync to remote (OSS)
      triggerSync: async () => {
        set({ syncStatus: 'syncing' });
        try {
          await fetch('/api/sync', { method: 'POST' });
          set({ syncStatus: 'idle', lastSyncAt: Date.now() });
        } catch (error) {
          console.error('Sync failed:', error);
          set({ syncStatus: 'error' });
        }
      },
    }),
    {
      name: 'qbot-chat-storage',
      partialize: (state) => ({
        selectedModel: state.selectedModel,
        lastSyncAt: state.lastSyncAt,
      }),
    }
  )
);
