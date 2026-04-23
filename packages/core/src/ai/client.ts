// packages/core/src/ai/client.ts

import { VaultManager } from '../vault/manager.js';
import { createProvider } from './providers/index.js';
import type {
  ProviderType,
  CompletionOptions,
  CompletionResult,
  ApiKeysConfig,
  ProviderConfig,
  ChatMessage
} from './types.js';

/**
 * Unified AI client that manages multiple providers.
 * Reads API keys from vault config and provides a simple interface for chat completions.
 */
export class AIClient {
  private vault: VaultManager;
  private providers: Map<string, ReturnType<typeof createProvider>> = new Map();

  constructor(vault: VaultManager) {
    this.vault = vault;
  }

  /**
   * Load API keys from vault and initialize providers.
   * Reads from config/api-keys.md and creates provider instances for each enabled provider.
   */
  async initFromVault(): Promise<void> {
    const config = await this.vault.reader.readConfig<ApiKeysConfig>('config/api-keys.md');
    if (!config) return;

    for (const [key, value] of Object.entries(config)) {
      if (key === 'version' || key === 'updated') continue;
      const providerConfig = value as ProviderConfig;
      if (providerConfig && providerConfig.enabled && providerConfig.api_key) {
        try {
          const provider = createProvider(key as ProviderType, providerConfig);
          this.providers.set(key, provider);
        } catch {
          // Skip invalid providers
        }
      }
    }
  }

  /**
   * Get list of initialized providers.
   * @returns Array of provider names that are configured and ready to use
   */
  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Send a chat completion request.
   * @param options - Chat options including provider, model, messages, and streaming settings
   * @returns Completion result with content and metadata
   */
  async chat(options: {
    provider?: ProviderType;
    model?: string;
    messages: ChatMessage[];
    stream?: boolean;
    onChunk?: (chunk: string) => void;
  }): Promise<CompletionResult> {
    // Determine which provider to use
    const providerType = options.provider ?? this.getDefaultProvider();
    const provider = this.providers.get(providerType);

    if (!provider) {
      throw new Error(`Provider '${providerType}' is not configured. Please add your API key.`);
    }

    // Determine model
    const model = options.model ?? await provider.getDefaultModel();

    return provider.complete({
      model,
      messages: options.messages,
      stream: options.stream ?? false,
      onStreamChunk: options.onChunk
    });
  }

  /**
   * Get default provider (prefer openrouter for its model variety).
   * Falls back to other providers in order of preference.
   * @returns The default provider type
   * @throws If no providers are configured
   */
  private getDefaultProvider(): ProviderType {
    if (this.providers.has('openrouter')) return 'openrouter';
    if (this.providers.has('openai')) return 'openai';
    if (this.providers.has('anthropic')) return 'anthropic';
    if (this.providers.has('deepseek')) return 'deepseek';
    throw new Error('No AI provider configured. Please set up your API keys.');
  }

  /**
   * Get available models for a provider.
   * @param providerType - Optional provider type, defaults to the default provider
   * @returns Array of model IDs available for the provider
   */
  async getModels(providerType?: ProviderType): Promise<string[]> {
    const type = providerType ?? this.getDefaultProvider();
    const provider = this.providers.get(type);
    if (!provider) return [];
    return provider.getModels();
  }
}
