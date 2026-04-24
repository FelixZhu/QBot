/**
 * 刷新令牌数据仓库
 */

import { v4 as uuidv4 } from 'uuid';
import { getDbClient } from '../db/client.js';

export interface RefreshToken {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: number;
  created_at: number;
  revoked_at: number | null;
}

export class RefreshTokenRepository {
  /**
   * 创建刷新令牌
   */
  async create(userId: string, tokenHash: string, expiresAt: number): Promise<RefreshToken> {
    const db = getDbClient();
    const id = uuidv4();
    const now = Date.now();

    await db.execute({
      sql: `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [id, userId, tokenHash, expiresAt, now],
    });

    return {
      id,
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_at: now,
      revoked_at: null,
    };
  }

  /**
   * 根据令牌哈希查找
   */
  async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    const db = getDbClient();
    const result = await db.execute({
      sql: 'SELECT * FROM refresh_tokens WHERE token_hash = ?',
      args: [tokenHash],
    });

    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToToken(result.rows[0]);
  }

  /**
   * 撤销令牌
   */
  async revoke(tokenHash: string): Promise<void> {
    const db = getDbClient();
    await db.execute({
      sql: 'UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?',
      args: [Date.now(), tokenHash],
    });
  }

  /**
   * 撤销用户的所有令牌
   */
  async revokeAllForUser(userId: string): Promise<void> {
    const db = getDbClient();
    await db.execute({
      sql: 'UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
      args: [Date.now(), userId],
    });
  }

  /**
   * 检查令牌是否有效
   */
  async isValid(tokenHash: string): Promise<boolean> {
    const db = getDbClient();
    const result = await db.execute({
      sql: `SELECT * FROM refresh_tokens 
            WHERE token_hash = ? 
            AND revoked_at IS NULL 
            AND expires_at > ?`,
      args: [tokenHash, Date.now()],
    });

    return result.rows.length > 0;
  }

  /**
   * 清理过期的令牌
   */
  async cleanupExpired(): Promise<number> {
    const db = getDbClient();
    const result = await db.execute({
      sql: 'DELETE FROM refresh_tokens WHERE expires_at < ?',
      args: [Date.now()],
    });

    return result.rowsAffected;
  }

  /**
   * 将数据库行转换为 RefreshToken 对象
   */
  private rowToToken(row: Record<string, unknown>): RefreshToken {
    return {
      id: row.id as string,
      user_id: row.user_id as string,
      token_hash: row.token_hash as string,
      expires_at: row.expires_at as number,
      created_at: row.created_at as number,
      revoked_at: row.revoked_at as number | null,
    };
  }
}
