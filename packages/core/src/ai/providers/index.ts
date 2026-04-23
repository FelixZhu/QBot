// packages/core/src/ai/providers/index.ts

import { BaseProvider } from './base.js';
import { OpenRouterProvider } from './openrouter.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { DeepSeekProvider } from './deepseek.js';
import type { ProviderType, ProviderConfig } from '../types.js';

/**
 * Provider constructor type
 */
type ProviderConstructor = new (apiKey: string, baseUrl?: string, defaultModel?: string) => BaseProvider;

/**
 * Provider constructor registry
 * Maps provider types to their respective constructors
 */
const providerConstructors: Record<ProviderType, ProviderConstructor> = {
  openrouter: OpenRouterProvider as ProviderConstructor,
  openai: OpenAIProvider as ProviderConstructor,
  anthropic: AnthropicProvider as ProviderConstructor,
  deepseek: DeepSeekProvider as ProviderConstructor
};

/**
 * Factory function to create a provider instance
 * @param type - The provider type
 * @param config - Provider configuration
 * @returns Provider instance
 */
export function createProvider(
  type: ProviderType,
  config: ProviderConfig
): BaseProvider {
  const Constructor = providerConstructors[type];
  if (!Constructor) {
    throw new Error(`Unknown provider type: ${type}`);
  }

  if (!config.api_key) {
    throw new Error(`API key is required for provider: ${type}`);
  }

  return new Constructor(
    config.api_key,
    config.base_url,
    config.default
  );
}

// Export all providers
export {
  BaseProvider,
  OpenRouterProvider,
  OpenAIProvider,
  AnthropicProvider,
  DeepSeekProvider
};
