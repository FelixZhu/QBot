import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ConversationRepository } from "@qbot/core/repository";
import { getAuthUser } from "@/lib/auth";

// 开发模式：使用固定的用户 ID
const DEV_USER_ID = "dev-user-1";

export async function GET(request: NextRequest) {
  try {
    // 获取用户（可选，开发模式允许无认证）
    const user = await getAuthUser(request);
    const userId = user?.sub || (process.env.TURSO_DATABASE_URL ? null : DEV_USER_ID);

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 开发模式：返回空列表
    if (!process.env.TURSO_DATABASE_URL) {
      return NextResponse.json({ conversations: [] });
    }

    const repo = new ConversationRepository();
    const conversations = await repo.listByUserId(userId);

    // 转换为 API 格式
    return NextResponse.json({
      conversations: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: new Date(c.created_at).toISOString(),
      })),
    });
  } catch (error) {
    console.error("List conversations error:", error);
    return NextResponse.json(
      { error: "Failed to list conversations" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // 获取用户
    const user = await getAuthUser(request);
    const userId = user?.sub || (process.env.TURSO_DATABASE_URL ? null : DEV_USER_ID);

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { title, model, provider, system_prompt } = body;

    // 开发模式：返回模拟数据
    if (!process.env.TURSO_DATABASE_URL) {
      const id = `dev-conv-${Date.now()}`;
      return NextResponse.json({
        id,
        title: title || "New Chat",
      });
    }

    const repo = new ConversationRepository();
    const conversation = await repo.create({
      user_id: userId,
      title: title || "New Chat",
      model: model || "",
      provider: provider || "openrouter",
      system_prompt,
    });

    return NextResponse.json(
      {
        id: conversation.id,
        title: conversation.title,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create conversation error:", error);
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 }
    );
  }
}
