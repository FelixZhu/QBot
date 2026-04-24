import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { UserRepository } from "@qbot/core/repository";
import { RefreshTokenRepository } from "@qbot/core/repository";
import { verifyPassword, generateTokenPair, hashToken } from "@qbot/core/auth";

// 开发模式：是否启用假登录
const ENABLE_FAKE_AUTH = !process.env.TURSO_DATABASE_URL;

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      );
    }

    // 开发模式：假登录
    if (ENABLE_FAKE_AUTH) {
      if (username === "admin" && password === "admin") {
        const response = NextResponse.json({
          success: true,
          user: {
            id: "dev-user-1",
            username: "admin",
            name: "Admin User",
            email: "admin@qbot.local",
          },
          accessToken: "dev-access-token",
        });

        // 设置开发模式的 cookie
        response.cookies.set("refresh_token", "dev-refresh-token", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 30 * 24 * 60 * 60,
          path: "/",
        });

        return response;
      }

      return NextResponse.json(
        { error: "Invalid credentials (dev mode: use admin/admin)" },
        { status: 401 }
      );
    }

    // 生产模式：数据库验证
    const userRepo = new UserRepository();
    const user = await userRepo.findByUsername(username);

    if (!user) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    const isValidPassword = await verifyPassword(password, user.password_hash);
    if (!isValidPassword) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    // 生成 Token 对
    const { accessToken, refreshToken, refreshTokenId } = await generateTokenPair(
      user.id,
      user.username
    );

    // 保存 Refresh Token
    const tokenRepo = new RefreshTokenRepository();
    const refreshTokenHash = await hashToken(refreshToken);
    await tokenRepo.create(
      user.id,
      refreshTokenHash,
      Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 天
    );

    // 更新最后登录时间
    await userRepo.updateLastLogin(user.id);

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
      },
      accessToken,
    });

    // 设置 Refresh Token Cookie
    response.cookies.set("refresh_token", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60, // 30 天
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
