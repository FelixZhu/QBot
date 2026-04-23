// packages/core/src/ai/providers/deepseek.ts

import { OpenAIProvider } from './openai.js';
import type { ProviderType } from '../types.js';

/**
 * DeepSeek provider - OpenAI-compatible API.
 * Extends OpenAIProvider with DeepSeek-specific configuration.
 */
export class DeepSeekProvider extends OpenAIProvider {
  readonly type: ProviderType = 'deepseek';

  constructor(apiKey: string, baseUrl?: string, defaultModel?: string) {
    super(
      apiKey,
      baseUrl || 'https://api.deepseek.com/v1',
      defaultModel || 'deepseek-chat'
    );
  }

  async getModels(): Promise<string[]> {
    return ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'];
  }
}
