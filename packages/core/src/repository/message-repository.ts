/**
 * 消息数据仓库
 */

import { v4 as uuidv4 } from 'uuid';
import { getDbClient } from '../db/client.js';

export interface Message {
  id: string;
  conversation_id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name: string | null;
  timestamp: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  metadata: string | null;
}

export interface CreateMessageInput {
  conversation_id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  timestamp?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  metadata?: string;
}

export class MessageRepository {
  /**
   * 根据会话 ID 列出消息
   */
  async listByConversation(conversationId: string): Promise<Message[]> {
    const db = getDbClient();
    const result = await db.execute({
      sql: 'SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC',
      args: [conversationId],
    });

    return result.rows.map(row => this.rowToMessage(row));
  }

  /**
   * 根据 ID 获取消息
   */
  async getById(id: string): Promise<Message | null> {
    const db = getDbClient();
    const result = await db.execute({
      sql: 'SELECT * FROM messages WHERE id = ?',
      args: [id],
    });

    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToMessage(result.rows[0]);
  }

  /**
   * 创建消息
   */
  async create(input: CreateMessageInput): Promise<Message> {
    const db = getDbClient();
    const id = uuidv4();
    const timestamp = input.timestamp || Date.now();

    await db.execute({
      sql: `INSERT INTO messages (id, conversation_id, role, content, name, timestamp, prompt_tokens, completion_tokens, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.conversation_id,
        input.role,
        input.content,
        input.name || null,
        timestamp,
        input.prompt_tokens || null,
        input.completion_tokens || null,
        input.metadata || null,
      ],
    });

    return {
      id,
      conversation_id: input.conversation_id,
      role: input.role,
      content: input.content,
      name: input.name || null,
      timestamp,
      prompt_tokens: input.prompt_tokens || null,
      completion_tokens: input.completion_tokens || null,
      metadata: input.metadata || null,
    };
  }

  /**
   * 批量插入消息
   */
  async insertMany(conversationId: string, messages: Omit<CreateMessageInput, 'conversation_id'>[]): Promise<Message[]> {
    const db = getDbClient();
    const results: Message[] = [];
    const now = Date.now();

    const statements = messages.map((msg, index) => {
      const id = uuidv4();
      const timestamp = msg.timestamp || now + index;

      results.push({
        id,
        conversation_id: conversationId,
        role: msg.role,
        content: msg.content,
        name: msg.name || null,
        timestamp,
        prompt_tokens: msg.prompt_tokens || null,
        completion_tokens: msg.completion_tokens || null,
        metadata: msg.metadata || null,
      });

      return {
        sql: `INSERT INTO messages (id, conversation_id, role, content, name, timestamp, prompt_tokens, completion_tokens, metadata)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          conversationId,
          msg.role,
          msg.content,
          msg.name || null,
          timestamp,
          msg.prompt_tokens || null,
          msg.completion_tokens || null,
          msg.metadata || null,
        ],
      };
    });

    await db.batch(statements);

    return results;
  }

  /**
   * 删除会话的所有消息
   */
  async deleteByConversation(conversationId: string): Promise<void> {
    const db = getDbClient();
    await db.execute({
      sql: 'DELETE FROM messages WHERE conversation_id = ?',
      args: [conversationId],
    });
  }

  /**
   * 统计会话的消息数量
   */
  async countByConversation(conversationId: string): Promise<number> {
    const db = getDbClient();
    const result = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?',
      args: [conversationId],
    });

    return result.rows[0].count as number;
  }

  /**
   * 获取会话的最新消息
   */
  async getLatest(conversationId: string, limit = 10): Promise<Message[]> {
    const db = getDbClient();
    const result = await db.execute({
      sql: 'SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT ?',
      args: [conversationId, limit],
    });

    return result.rows.map(row => this.rowToMessage(row)).reverse();
  }

  /**
   * 将数据库行转换为 Message 对象
   */
  private rowToMessage(row: Record<string, unknown>): Message {
    return {
      id: row.id as string,
      conversation_id: row.conversation_id as string,
      role: row.role as 'system' | 'user' | 'assistant' | 'tool',
      content: row.content as string,
      name: row.name as string | null,
      timestamp: row.timestamp as number,
      prompt_tokens: row.prompt_tokens as number | null,
      completion_tokens: row.completion_tokens as number | null,
      metadata: row.metadata as string | null,
    };
  }
}
