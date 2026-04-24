import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { UserRepository } from "@qbot/core/repository";
import { hashPassword, validatePasswordStrength } from "@qbot/core/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, email, password, name } = body;

    // 验证输入
    if (!username || !email || !password) {
      return NextResponse.json(
        { error: "Username, email, and password are required" },
        { status: 400 }
      );
    }

    // 验证密码强度
    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    // 验证用户名格式
    if (username.length < 3 || username.length > 20) {
      return NextResponse.json(
        { error: "Username must be between 3 and 20 characters" },
        { status: 400 }
      );
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return NextResponse.json(
        { error: "Username can only contain letters, numbers, and underscores" },
        { status: 400 }
      );
    }

    // 检查数据库是否配置
    if (!process.env.TURSO_DATABASE_URL) {
      return NextResponse.json(
        { error: "Database not configured. Registration is disabled." },
        { status: 503 }
      );
    }

    // 检查用户是否已存在
    const userRepo = new UserRepository();
    const existing = await userRepo.findByEmailOrUsername(email, username);

    if (existing) {
      return NextResponse.json(
        { error: existing.email === email ? "Email already registered" : "Username already taken" },
        { status: 409 }
      );
    }

    // 创建用户
    const hashedPassword = await hashPassword(password);
    const user = await userRepo.create({
      username,
      email,
      password_hash: hashedPassword,
      name: name || username,
    });

    return NextResponse.json(
      {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          name: user.name,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Registration failed" },
      { status: 500 }
    );
  }
}
