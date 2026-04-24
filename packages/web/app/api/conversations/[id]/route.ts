import { NextRequest, NextResponse } from 'next/server';
import {
  createOSSClient,
  OSSConversationRepository,
  MemoryConversationRepository,
} from '@qbot/core';
import type { ConversationRepository } from '@qbot/core';

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

// GET /api/conversations/:id - Get a single conversation
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = getUserId(req);
    const repo = getRepo();
    const conversation = await repo.getConversation(userId, id);

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ conversation });
  } catch (error: unknown) {
    console.error('Failed to get conversation:', error);
    const message = error instanceof Error ? error.message : 'Failed to get conversation';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/conversations/:id - Update conversation (title, messages, etc.)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = getUserId(req);
    const body = await req.json();
    const { title, messages, model, provider } = body;

    const repo = getRepo();
    const existing = await repo.getConversation(userId, id);

    if (!existing) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();
    const updated: typeof existing = {
      meta: {
        ...existing.meta,
        ...(title && { title }),
        ...(model && { model }),
        ...(provider && { provider }),
        updated: now,
      },
      messages: messages || existing.messages,
    };

    await repo.saveConversation(userId, updated);
    return NextResponse.json({ conversation: updated });
  } catch (error: unknown) {
    console.error('Failed to update conversation:', error);
    const message = error instanceof Error ? error.message : 'Failed to update conversation';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/conversations/:id - Delete a conversation
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = getUserId(req);
    const repo = getRepo();
    await repo.deleteConversation(userId, id);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Failed to delete conversation:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete conversation';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
