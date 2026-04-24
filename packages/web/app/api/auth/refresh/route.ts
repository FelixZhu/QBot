import "server-only";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { RefreshTokenRepository, UserRepository } from "@qbot/core/repository";
import { verifyRefreshToken, generateAccessToken, hashToken } from "@qbot/core/auth";

export async function POST() {
  try {
    const cookieStore = await cookies();
    const refreshToken = cookieStore.get("refresh_token")?.value;

    if (!refreshToken) {
      return NextResponse.json({ error: "No refresh token" }, { status: 401 });
    }

    // 开发模式：返回开发 token
    if (!process.env.TURSO_DATABASE_URL) {
      if (refreshToken === "dev-refresh-token") {
        return NextResponse.json({
          accessToken: "dev-access-token",
        });
      }
      return NextResponse.json({ error: "Invalid refresh token" }, { status: 401 });
    }

    // 验证 refresh token
    const payload = await verifyRefreshToken(refreshToken);
    if (!payload) {
      return NextResponse.json({ error: "Invalid refresh token" }, { status: 401 });
    }

    // 检查 token 是否已被撤销
    const tokenHash = await hashToken(refreshToken);
    const tokenRepo = new RefreshTokenRepository();
    const isValid = await tokenRepo.isValid(tokenHash);

    if (!isValid) {
      return NextResponse.json({ error: "Token has been revoked" }, { status: 401 });
    }

    // 获取用户信息
    const userRepo = new UserRepository();
    const user = await userRepo.findById(payload.sub);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }

    // 生成新的 access token
    const accessToken = await generateAccessToken(user.id, user.username);

    return NextResponse.json({ accessToken });
  } catch (error) {
    console.error("Token refresh error:", error);
    return NextResponse.json({ error: "Token refresh failed" }, { status: 500 });
  }
}
