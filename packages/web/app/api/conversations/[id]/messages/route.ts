import { NextRequest, NextResponse } from 'next/server';
import {
  createOSSClient,
  OSSConversationRepository,
  MemoryConversationRepository,
} from '@qbot/core';
import type { ConversationRepository, ChatMessage } from '@qbot/core';

function getRepo(): ConversationRepository {
  const client = createOSSClient();
  if (client) {
    return new OSSConversationRepository(client);
  }
  return new MemoryConversationRepository();
}

function getUserId(req: NextRequest): string {
  return req.headers.get('x-user-id') || 'default-user';
}

// POST /api/conversations/:id/messages - Append messages to a conversation
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = getUserId(req);
    const body = await req.json();
    const { messages }: { messages: ChatMessage[] } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'messages array is required' },
        { status: 400 }
      );
    }

    const repo = getRepo();
    const existing = await repo.getConversation(userId, id);

    if (!existing) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();
    const updated = {
      meta: {
        ...existing.meta,
        updated: now,
      },
      messages: [...existing.messages, ...messages],
    };

    await repo.saveConversation(userId, updated);
    return NextResponse.json({ conversation: updated });
  } catch (error: unknown) {
    console.error('Failed to append messages:', error);
    const message = error instanceof Error ? error.message : 'Failed to append messages';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
