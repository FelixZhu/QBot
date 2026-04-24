/**
 * 数据库 Schema 定义
 *
 * 使用 Turso/Libsql (SQLite) 数据库
 */

/**
 * 用户表
 */
export const usersSchema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
`;

/**
 * 会话表
 */
export const conversationsSchema = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New Chat',
  model TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'openrouter',
  system_prompt TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_deleted_at ON conversations(deleted_at);
`;

/**
 * 消息表
 */
export const messagesSchema = `
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  name TEXT,
  timestamp INTEGER NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  metadata TEXT,
  
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_timestamp ON messages(conversation_id, timestamp ASC);
`;

/**
 * 刷新令牌表
 */
export const refreshTokensSchema = `
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);
`;

/**
 * 完整的数据库 Schema（按依赖顺序）
 */
export const fullSchema = `
${usersSchema}

${conversationsSchema}

${messagesSchema}

${refreshTokensSchema}
`;

/**
 * 获取所有 Schema 语句
 */
export function getSchemaStatements(): string[] {
  return [
    // Users
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      avatar_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_login_at INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
    `CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`,
    `CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at)`,

    // Conversations
    `CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'New Chat',
      model TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT 'openrouter',
      system_prompt TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_conversations_deleted_at ON conversations(deleted_at)`,

    // Messages
    `CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
      content TEXT NOT NULL,
      name TEXT,
      timestamp INTEGER NOT NULL,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      metadata TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_conversation_timestamp ON messages(conversation_id, timestamp ASC)`,

    // Refresh Tokens
    `CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at)`,
  ];
}
