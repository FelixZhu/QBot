import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ConversationRepository, MessageRepository } from "@qbot/core/repository";
import { getAuthUser } from "@/lib/auth";

const DEV_USER_ID = "dev-user-1";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id: conversationId } = await params;
    const user = await getAuthUser(request);
    const userId = user?.sub || (process.env.TURSO_DATABASE_URL ? null : DEV_USER_ID);

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 开发模式：返回模拟数据
    if (!process.env.TURSO_DATABASE_URL) {
      return NextResponse.json({
        conversation: {
          id: conversationId,
          title: "Dev Conversation",
          messages: [],
        },
      });
    }

    const convRepo = new ConversationRepository();
    const data = await convRepo.getWithMessages(conversationId, userId);

    if (!data) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // 转换消息格式
    const messages = data.messages.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: new Date(m.timestamp).toISOString(),
    }));

    return NextResponse.json({
      conversation: {
        id: data.id,
        title: data.title,
        messages,
      },
    });
  } catch (error) {
    console.error("Get conversation error:", error);
    return NextResponse.json(
      { error: "Failed to get conversation" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id: conversationId } = await params;
    const user = await getAuthUser(request);
    const userId = user?.sub || (process.env.TURSO_DATABASE_URL ? null : DEV_USER_ID);

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { title, model, provider, system_prompt } = body;

    // 开发模式
    if (!process.env.TURSO_DATABASE_URL) {
      return NextResponse.json({ success: true });
    }

    const repo = new ConversationRepository();
    await repo.update(conversationId, userId, {
      title,
      model,
      provider,
      system_prompt,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update conversation error:", error);
    return NextResponse.json(
      { error: "Failed to update conversation" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id: conversationId } = await params;
    const user = await getAuthUser(request);
    const userId = user?.sub || (process.env.TURSO_DATABASE_URL ? null : DEV_USER_ID);

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 开发模式
    if (!process.env.TURSO_DATABASE_URL) {
      return NextResponse.json({ success: true });
    }

    const repo = new ConversationRepository();
    await repo.delete(conversationId, userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete conversation error:", error);
    return NextResponse.json(
      { error: "Failed to delete conversation" },
      { status: 500 }
    );
  }
}
