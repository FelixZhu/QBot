import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ConversationRepository, MessageRepository } from "@qbot/core/repository";
import type { ChatMessage } from "@qbot/core";
import { getAuthUser } from "@/lib/auth";

const DEV_USER_ID = "dev-user-1";

interface Params {
  params: Promise<{ id: string }>;
}

// POST /api/conversations/:id/messages - Append messages to a conversation
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id: conversationId } = await params;
    const user = await getAuthUser(request);
    const userId = user?.sub || (process.env.TURSO_DATABASE_URL ? null : DEV_USER_ID);

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { messages }: { messages: ChatMessage[] } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "messages array is required" },
        { status: 400 }
      );
    }

    // 开发模式
    if (!process.env.TURSO_DATABASE_URL) {
      return NextResponse.json({ success: true });
    }

    // 验证会话存在且属于用户
    const convRepo = new ConversationRepository();
    const conversation = await convRepo.getById(conversationId, userId);

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // 插入消息
    const msgRepo = new MessageRepository();
    await msgRepo.insertMany(
      conversationId,
      messages.map((m) => ({
        role: m.role,
        content: m.content,
        name: m.name,
        timestamp: m.timestamp ? new Date(m.timestamp).getTime() : undefined,
      }))
    );

    // 更新会话的 updated_at
    await convRepo.touch(conversationId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to append messages:", error);
    return NextResponse.json(
      { error: "Failed to append messages" },
      { status: 500 }
    );
  }
}
