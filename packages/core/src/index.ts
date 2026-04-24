// packages/core/src/index.ts

// AI types and client
export * from './ai/types.js';
export { AIClient } from './ai/client.js';

// AI Providers
export { createProvider } from './ai/providers/index.js';
export { BaseProvider } from './ai/providers/base.js';
export { OpenRouterProvider } from './ai/providers/openrouter.js';
export { OpenAIProvider } from './ai/providers/openai.js';
export { AnthropicProvider } from './ai/providers/anthropic.js';
export { DeepSeekProvider } from './ai/providers/deepseek.js';

// Vault
export { VaultManager } from './vault/manager.js';
export { VaultReader } from './vault/reader.js';
export { VaultWriter } from './vault/writer.js';

// Config
export { APIKeysManager } from './config/keys-manager.js';
export type { ProviderKeyInfo, APIKeysResponse } from './config/keys-manager.js';

// AI Utils
export { detectAPIKeyProvider, getProviderName, maskAPIKey, getDefaultBaseUrl } from './ai/utils/key-detector.js';
export type { DetectionResult } from './ai/utils/key-detector.js';

// Conversation
export { ConversationManager } from './conversation/manager.js';
export { generateId, generateFilename } from './conversation/message.js';
export type { ConversationData, ConversationMeta } from './conversation/message.js';

// Storage - File abstraction layer
export type { FileStorage, FileMeta } from './storage/types.js';
export { NodeStorage } from './storage/node-storage.js';
export { BrowserStorage } from './storage/browser-storage.js';
export { OSSStorage } from './storage/oss-storage.js';
export { syncStorage } from './storage/sync.js';
export type { SyncOptions, SyncResult } from './storage/sync.js';

// Storage - Local-first conversation store
export { LocalStore, serializeConversation, parseConversation } from './storage/local-store.js';

// Storage - Legacy OSS client (for BYOK sync)
export { createOSSClient, getOSSClient } from './storage/oss-client.js';
export type { OSSConfig } from './storage/oss-client.js';

// 注意：数据库、认证和 Repository 模块仅限服务端使用
// 请从以下路径直接导入：
// - 数据库: @qbot/core/db
// - 认证: @qbot/core/auth
// - Repository: @qbot/core/repository
