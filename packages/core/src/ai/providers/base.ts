// packages/core/src/ai/providers/base.ts

import type { ProviderType, CompletionOptions, CompletionResult } from '../types.js';

/**
 * Base class for all AI providers.
 * Each provider must implement the complete() method.
 */
export abstract class BaseProvider {
  abstract readonly type: ProviderType;

  constructor(
    protected apiKey: string,
    protected baseUrl?: string,
    protected defaultModel?: string
  ) {}

  /** Get available models for this provider */
  abstract getModels(): Promise<string[]>;

  /** Complete a chat request */
  abstract complete(options: CompletionOptions): Promise<CompletionResult>;

  /** Check if this provider is configured and ready */
  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  /** Get the default model or first available */
  async getDefaultModel(): Promise<string> {
    if (this.defaultModel) return this.defaultModel;
    const models = await this.getModels();
    return models[0] || '';
  }

  /** Validate model exists */
  async validateModel(modelId: string): Promise<boolean> {
    const models = await this.getModels();
    return models.includes(modelId);
  }
}
