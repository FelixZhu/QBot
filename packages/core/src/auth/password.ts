/**
 * 密码哈希工具
 *
 * 使用 bcrypt 进行密码哈希和验证
 * 
 * @note 此模块仅限服务端使用
 */

import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

/**
 * 对密码进行哈希
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * 验证密码
 */
export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

/**
 * 检查密码强度
 * 返回 null 表示通过，否则返回错误消息
 */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) {
    return 'Password must be at least 8 characters long';
  }

  if (password.length > 128) {
    return 'Password must be less than 128 characters';
  }

  // 检查是否包含常见弱密码
  const weakPasswords = ['password', '12345678', 'qwerty', 'admin123'];
  if (weakPasswords.some(weak => password.toLowerCase().includes(weak))) {
    return 'Password is too weak';
  }

  return null;
}
