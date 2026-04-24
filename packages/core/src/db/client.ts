/**
 * Turso/Libsql 数据库客户端
 *
 * 支持本地开发和远端 Turso 数据库连接
 * 
 * @note 此模块仅限服务端使用
 */

import { createClient, type Client, type InValue } from '@libsql/client';

let client: Client | null = null;

/**
 * 获取数据库客户端实例（单例）
 */
export function getDbClient(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (!url) {
      throw new Error('TURSO_DATABASE_URL environment variable is not set');
    }

    client = createClient({
      url,
      authToken,
    });
  }

  return client;
}

/**
 * 获取边缘运行时数据库客户端（每次创建新实例）
 * 用于 Vercel Edge Functions / Cloudflare Workers
 */
export function getEdgeDbClient(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error('TURSO_DATABASE_URL environment variable is not set');
  }

  return createClient({
    url,
    authToken,
  });
}

/**
 * 关闭数据库连接
 */
export function closeDbClient(): void {
  if (client) {
    client.close();
    client = null;
  }
}

/**
 * 执行批量操作（事务）
 */
export async function batch(statements: Array<{ sql: string; args?: InValue[] }>): Promise<void> {
  const db = getDbClient();
  await db.batch(statements);
}

// 导出类型
export type { Client } from '@libsql/client';
export type { InValue } from '@libsql/client';
