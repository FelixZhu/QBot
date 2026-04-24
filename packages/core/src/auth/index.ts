/**
 * 认证模块
 *
 * @note 此模块仅限服务端使用
 */

export { generateAccessToken, generateRefreshToken, generateTokenPair, verifyAccessToken, verifyRefreshToken, decodeToken, extractBearerToken, hashToken } from './jwt.js';
export type { AccessTokenPayload, RefreshTokenPayload } from './jwt.js';
export { hashPassword, verifyPassword, validatePasswordStrength } from './password.js';
