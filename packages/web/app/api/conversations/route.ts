import { NextRequest, NextResponse } from 'next/server';
import {
  createOSSClient,
  OSSConversationRepository,
  MemoryConversationRepository,
  generateId,
  type ConversationData,
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
  // TODO: Replace with real auth when available
  // For now, use a header or fallback to a default user
  return req.headers.get('x-user-id') || 'default-user';
}

// GET /api/conversations - List all conversations
export async function GET(req: NextRequest) {
  try {
    const userId = getUserId(req);
    const repo = getRepo();
    const conversations = await repo.listConversations(userId);
    return NextResponse.json({ conversations });
  } catch (error: any) {
    console.error('Failed to list conversations:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to list conversations' },
      { status: 500 }
    );
  }
}

// POST /api/conversations - Create a new conversation
export async function POST(req: NextRequest) {
  try {
    const userId = getUserId(req);
    const body = await req.json();
    const { title, model, provider } = body;

    const now = new Date().toISOString();
    const data: ConversationData = {
      meta: {
        id: generateId(),
        title: title || 'New Chat',
        created: now,
        updated: now,
        model: model || '',
        provider: provider || 'openrouter',
      },
      messages: [],
    };

    const repo = getRepo();
    await repo.saveConversation(userId, data);

    return NextResponse.json({ conversation: data });
  } catch (error: any) {
    console.error('Failed to create conversation:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create conversation' },
      { status: 500 }
    );
  }
}
