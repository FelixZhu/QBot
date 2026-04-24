/**
 * 会话数据仓库
 */

import { v4 as uuidv4 } from 'uuid';
import { getDbClient } from '../db/client.js';

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  model: string;
  provider: string;
  system_prompt: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface ConversationWithMessages extends Conversation {
  messages: MessageData[];
}

export interface MessageData {
  id: string;
  conversation_id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name: string | null;
  timestamp: number;
}

export interface CreateConversationInput {
  user_id: string;
  title?: string;
  model?: string;
  provider?: string;
  system_prompt?: string;
}

export interface UpdateConversationInput {
  title?: string;
  model?: string;
  provider?: string;
  system_prompt?: string;
}

export interface ListConversationsOptions {
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}

export class ConversationRepository {
  /**
   * 根据用户 ID 列出会话
   */
  async listByUserId(userId: string, options?: ListConversationsOptions): Promise<Conversation[]> {
    const db = getDbClient();
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    let sql = `SELECT * FROM conversations WHERE user_id = ?`;
    const args: (string | number)[] = [userId];

    if (!options?.includeDeleted) {
      sql += ` AND deleted_at IS NULL`;
    }

    sql += ` ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
    args.push(limit, offset);

    const result = await db.execute({ sql, args });

    return result.rows.map(row => this.rowToConversation(row));
  }

  /**
   * 根据 ID 获取会话
   */
  async getById(id: string, userId?: string): Promise<Conversation | null> {
    const db = getDbClient();

    let sql = 'SELECT * FROM conversations WHERE id = ?';
    const args: string[] = [id];

    if (userId) {
      sql += ' AND user_id = ?';
      args.push(userId);
    }

    const result = await db.execute({ sql, args });

    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToConversation(result.rows[0]);
  }

  /**
   * 获取会话及其消息
   */
  async getWithMessages(id: string, userId: string): Promise<ConversationWithMessages | null> {
    const db = getDbClient();

    // 获取会话
    const convResult = await db.execute({
      sql: 'SELECT * FROM conversations WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      args: [id, userId],
    });

    if (convResult.rows.length === 0) {
      return null;
    }

    const conversation = this.rowToConversation(convResult.rows[0]);

    // 获取消息
    const msgResult = await db.execute({
      sql: 'SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC',
      args: [id],
    });

    const messages = msgResult.rows.map(row => this.rowToMessage(row));

    return {
      ...conversation,
      messages,
    };
  }

  /**
   * 创建会话
   */
  async create(input: CreateConversationInput): Promise<Conversation> {
    const db = getDbClient();
    const now = Date.now();
    const id = uuidv4();

    await db.execute({
      sql: `INSERT INTO conversations (id, user_id, title, model, provider, system_prompt, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.user_id,
        input.title || 'New Chat',
        input.model || '',
        input.provider || 'openrouter',
        input.system_prompt || null,
        now,
        now,
      ],
    });

    return {
      id,
      user_id: input.user_id,
      title: input.title || 'New Chat',
      model: input.model || '',
      provider: input.provider || 'openrouter',
      system_prompt: input.system_prompt || null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
  }

  /**
   * 更新会话
   */
  async update(id: string, userId: string, updates: UpdateConversationInput): Promise<Conversation | null> {
    const db = getDbClient();
    const now = Date.now();

    const setClauses: string[] = ['updated_at = ?'];
    const args: (string | number)[] = [now];

    if (updates.title !== undefined) {
      setClauses.push('title = ?');
      args.push(updates.title);
    }
    if (updates.model !== undefined) {
      setClauses.push('model = ?');
      args.push(updates.model);
    }
    if (updates.provider !== undefined) {
      setClauses.push('provider = ?');
      args.push(updates.provider);
    }
    if (updates.system_prompt !== undefined) {
      setClauses.push('system_prompt = ?');
      args.push(updates.system_prompt);
    }

    args.push(id, userId);

    await db.execute({
      sql: `UPDATE conversations SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`,
      args,
    });

    return this.getById(id, userId);
  }

  /**
   * 更新会话的 updated_at 时间戳
   */
  async touch(id: string): Promise<void> {
    const db = getDbClient();
    await db.execute({
      sql: 'UPDATE conversations SET updated_at = ? WHERE id = ?',
      args: [Date.now(), id],
    });
  }

  /**
   * 软删除会话
   */
  async delete(id: string, userId: string): Promise<void> {
    const db = getDbClient();
    await db.execute({
      sql: 'UPDATE conversations SET deleted_at = ? WHERE id = ? AND user_id = ?',
      args: [Date.now(), id, userId],
    });
  }

  /**
   * 永久删除会话
   */
  async permanentDelete(id: string, userId: string): Promise<void> {
    const db = getDbClient();
    await db.execute({
      sql: 'DELETE FROM conversations WHERE id = ? AND user_id = ?',
      args: [id, userId],
    });
  }

  /**
   * 统计用户的会话数量
   */
  async countByUserId(userId: string, includeDeleted = false): Promise<number> {
    const db = getDbClient();

    let sql = 'SELECT COUNT(*) as count FROM conversations WHERE user_id = ?';
    const args: string[] = [userId];

    if (!includeDeleted) {
      sql += ' AND deleted_at IS NULL';
    }

    const result = await db.execute({ sql, args });
    return result.rows[0].count as number;
  }

  /**
   * 将数据库行转换为 Conversation 对象
   */
  private rowToConversation(row: Record<string, unknown>): Conversation {
    return {
      id: row.id as string,
      user_id: row.user_id as string,
      title: row.title as string,
      model: row.model as string,
      provider: row.provider as string,
      system_prompt: row.system_prompt as string | null,
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
      deleted_at: row.deleted_at as number | null,
    };
  }

  /**
   * 将数据库行转换为 MessageData 对象
   */
  private rowToMessage(row: Record<string, unknown>): MessageData {
    return {
      id: row.id as string,
      conversation_id: row.conversation_id as string,
      role: row.role as 'system' | 'user' | 'assistant' | 'tool',
      content: row.content as string,
      name: row.name as string | null,
      timestamp: row.timestamp as number,
    };
  }
}
