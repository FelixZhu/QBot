/**
 * JWT 认证工具
 *
 * 使用 jose 库实现 JWT 生成和验证
 * 
 * @note 此模块仅限服务端使用
 */

import { SignJWT, jwtVerify, decodeJwt } from 'jose';

/**
 * JWT 配置
 */
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key-min-32-characters-long'
);
const ALGORITHM = 'HS256';

// Token 有效期
const ACCESS_TOKEN_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';
const REFRESH_TOKEN_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '30d';

/**
 * Access Token payload
 */
export interface AccessTokenPayload {
  sub: string;        // User ID
  username: string;
  type: 'access';
  iat: number;
  exp: number;
}

/**
 * Refresh Token payload
 */
export interface RefreshTokenPayload {
  sub: string;        // User ID
  jti: string;        // Token ID (用于撤销)
  type: 'refresh';
  iat: number;
  exp: number;
}

/**
 * 生成 Access Token
 */
export async function generateAccessToken(
  userId: string,
  username: string
): Promise<string> {
  return new SignJWT({
    sub: userId,
    username,
    type: 'access',
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(JWT_SECRET);
}

/**
 * 生成 Refresh Token
 */
export async function generateRefreshToken(
  userId: string,
  tokenId: string
): Promise<string> {
  return new SignJWT({
    sub: userId,
    jti: tokenId,
    type: 'refresh',
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(JWT_SECRET);
}

/**
 * 生成 Token 对
 */
export async function generateTokenPair(
  userId: string,
  username: string
): Promise<{ accessToken: string; refreshToken: string; refreshTokenId: string }> {
  // 生成 refresh token ID
  const { v4: uuidv4 } = await import('uuid');
  const refreshTokenId = uuidv4();

  const accessToken = await generateAccessToken(userId, username);
  const refreshToken = await generateRefreshToken(userId, refreshTokenId);

  return {
    accessToken,
    refreshToken,
    refreshTokenId,
  };
}

/**
 * 验证 Access Token
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);

    if (payload.type !== 'access') {
      return null;
    }

    return payload as unknown as AccessTokenPayload;
  } catch {
    return null;
  }
}

/**
 * 验证 Refresh Token
 */
export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);

    if (payload.type !== 'refresh') {
      return null;
    }

    return payload as unknown as RefreshTokenPayload;
  } catch {
    return null;
  }
}

/**
 * 解码 Token（不验证签名）
 * 用于调试或获取过期 token 的信息
 */
export function decodeToken(token: string): Record<string, unknown> | null {
  try {
    return decodeJwt(token);
  } catch {
    return null;
  }
}

/**
 * 从 Authorization header 提取 token
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}

/**
 * 计算 token 哈希（用于存储 refresh token）
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
