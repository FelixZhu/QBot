// packages/core/src/ai/types.ts

/** Supported AI providers */
export type ProviderType = 'openrouter' | 'openai' | 'anthropic' | 'deepseek';

/** Message role */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** Chat message */
export interface ChatMessage {
  role: MessageRole;
  content: string;
  name?: string;
  /** Unique message ID (for stored messages) */
  id?: string;
  /** Message timestamp (for stored messages) */
  timestamp?: string;
}

/** Model info */
export interface ModelInfo {
  id: string;
  name: string;
  provider: ProviderType;
  contextWindow?: number;
  maxTokens?: number;
}

/** Provider configuration from api-keys.md */
export interface ProviderConfig {
  enabled: boolean;
  api_key?: string;
  base_url?: string;
  default?: string; // default model ID
  models?: string[];
}

/** Complete API keys configuration */
export interface ApiKeysConfig {
  version: string;
  updated: string;
  [providerName: string]: ProviderConfig | string | undefined;
}

/** Stream chunk callback */
export type StreamCallback = (chunk: string) => void;

/** Completion options */
export interface CompletionOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  onStreamChunk?: StreamCallback;
}

/** Completion result */
export interface CompletionResult {
  content: string;
  model: string;
  provider: ProviderType;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
