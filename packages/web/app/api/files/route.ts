// packages/web/app/api/files/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { NodeStorage, LocalStore, type ChatMessage } from '@qbot/core';
import type { ConversationMeta } from '@qbot/core';
import { generateId } from '@qbot/core';
import path from 'path';
import os from 'os';

// Singleton local store per request (Node.js environment)
let localStore: LocalStore | null = null;

function getStore(): LocalStore {
  if (!localStore) {
    const baseDir = path.join(os.homedir(), '.qbot');
    const storage = new NodeStorage({ baseDir });
    localStore = new LocalStore({ storage, conversationsDir: 'conversations' });
  }
  return localStore;
}

interface FileActionRequest {
  action: string;
  payload?: unknown;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as FileActionRequest;
    const store = getStore();

    switch (body.action) {
      case 'listConversations': {
        const conversations = await store.listConversations();
        return NextResponse.json({ conversations });
      }

      case 'createConversation': {
        const payload = body.payload as {
          title?: string;
          model?: string;
          provider?: string;
        };
        const now = new Date().toISOString();
        const meta: ConversationMeta = {
          id: generateId(),
          title: payload.title || 'New Chat',
          created: now,
          updated: now,
          model: payload.model || '',
          provider: payload.provider || 'openrouter',
        };
        await store.saveConversation({ meta, messages: [] });
        return NextResponse.json({ conversation: meta });
      }

      case 'getMessages': {
        const payload = body.payload as { conversationId: string };
        const conv = await store.getConversation(payload.conversationId);
        if (!conv) {
          return NextResponse.json(
            { error: 'Conversation not found' },
            { status: 404 }
          );
        }
        return NextResponse.json({ messages: conv.messages });
      }

      case 'deleteConversation': {
        const payload = body.payload as { conversationId: string };
        await store.deleteConversation(payload.conversationId);
        return NextResponse.json({ success: true });
      }

      case 'updateMeta': {
        const payload = body.payload as {
          conversationId: string;
          updates: Partial<ConversationMeta>;
        };
        await store.updateMeta(payload.conversationId, payload.updates);
        return NextResponse.json({ success: true });
      }

      case 'appendMessages': {
        const payload = body.payload as {
          conversationId: string;
          messages: ChatMessage[];
        };
        await store.appendMessages(payload.conversationId, payload.messages);
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${body.action}` },
          { status: 400 }
        );
    }
  } catch (error: any) {
    console.error('File API error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
