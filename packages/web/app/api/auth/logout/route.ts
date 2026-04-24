import "server-only";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { RefreshTokenRepository } from "@qbot/core/repository";
import { hashToken } from "@qbot/core/auth";

export async function POST() {
  try {
    const cookieStore = await cookies();
    const refreshToken = cookieStore.get("refresh_token")?.value;

    // 撤销 refresh token
    if (refreshToken && process.env.TURSO_DATABASE_URL) {
      try {
        const tokenHash = await hashToken(refreshToken);
        const tokenRepo = new RefreshTokenRepository();
        await tokenRepo.revoke(tokenHash);
      } catch {
        // 忽略错误，继续登出流程
      }
    }

    const response = NextResponse.json({ success: true });

    // 清除 cookie
    response.cookies.set("refresh_token", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json({ error: "Logout failed" }, { status: 500 });
  }
}
