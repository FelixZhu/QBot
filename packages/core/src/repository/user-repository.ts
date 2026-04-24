/**
 * 用户数据仓库
 */

import { v4 as uuidv4 } from 'uuid';
import { getDbClient } from '../db/client.js';

export interface User {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  name: string | null;
  avatar_url: string | null;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
}

export interface CreateUserInput {
  username: string;
  email: string;
  password_hash: string;
  name?: string;
}

export class UserRepository {
  /**
   * 根据 ID 查找用户
   */
  async findById(id: string): Promise<User | null> {
    const db = getDbClient();
    const result = await db.execute({
      sql: 'SELECT * FROM users WHERE id = ?',
      args: [id],
    });

    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToUser(result.rows[0]);
  }

  /**
   * 根据用户名查找用户
   */
  async findByUsername(username: string): Promise<User | null> {
    const db = getDbClient();
    const result = await db.execute({
      sql: 'SELECT * FROM users WHERE username = ?',
      args: [username],
    });

    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToUser(result.rows[0]);
  }

  /**
   * 根据邮箱查找用户
   */
  async findByEmail(email: string): Promise<User | null> {
    const db = getDbClient();
    const result = await db.execute({
      sql: 'SELECT * FROM users WHERE email = ?',
      args: [email],
    });

    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToUser(result.rows[0]);
  }

  /**
   * 根据邮箱或用户名查找用户
   */
  async findByEmailOrUsername(email: string, username: string): Promise<User | null> {
    const db = getDbClient();
    const result = await db.execute({
      sql: 'SELECT * FROM users WHERE email = ? OR username = ?',
      args: [email, username],
    });

    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToUser(result.rows[0]);
  }

  /**
   * 创建用户
   */
  async create(input: CreateUserInput): Promise<User> {
    const db = getDbClient();
    const now = Date.now();
    const id = uuidv4();

    await db.execute({
      sql: `INSERT INTO users (id, username, email, password_hash, name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [id, input.username, input.email, input.password_hash, input.name || null, now, now],
    });

    return {
      id,
      username: input.username,
      email: input.email,
      password_hash: input.password_hash,
      name: input.name || null,
      avatar_url: null,
      created_at: now,
      updated_at: now,
      last_login_at: null,
    };
  }

  /**
   * 更新最后登录时间
   */
  async updateLastLogin(id: string): Promise<void> {
    const db = getDbClient();
    const now = Date.now();

    await db.execute({
      sql: 'UPDATE users SET last_login_at = ? WHERE id = ?',
      args: [now, id],
    });
  }

  /**
   * 更新用户信息
   */
  async update(id: string, updates: { name?: string; avatar_url?: string }): Promise<User | null> {
    const db = getDbClient();
    const now = Date.now();

    const setClauses: string[] = ['updated_at = ?'];
    const args: (string | number)[] = [now];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      args.push(updates.name);
    }
    if (updates.avatar_url !== undefined) {
      setClauses.push('avatar_url = ?');
      args.push(updates.avatar_url);
    }

    args.push(id);

    await db.execute({
      sql: `UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`,
      args,
    });

    return this.findById(id);
  }

  /**
   * 删除用户
   */
  async delete(id: string): Promise<void> {
    const db = getDbClient();
    await db.execute({
      sql: 'DELETE FROM users WHERE id = ?',
      args: [id],
    });
  }

  /**
   * 将数据库行转换为 User 对象
   */
  private rowToUser(row: Record<string, unknown>): User {
    return {
      id: row.id as string,
      username: row.username as string,
      email: row.email as string,
      password_hash: row.password_hash as string,
      name: row.name as string | null,
      avatar_url: row.avatar_url as string | null,
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
      last_login_at: row.last_login_at as number | null,
    };
  }
}
