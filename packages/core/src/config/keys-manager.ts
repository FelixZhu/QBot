// packages/core/src/config/keys-manager.ts

import * as path from 'path';
import * as os from 'os';
import type { ProviderType, ApiKeysConfig, ProviderConfig } from '../ai/types.js';
import { VaultReader } from '../vault/reader.js';
import { VaultWriter } from '../vault/writer.js';
import { detectAPIKeyProvider, maskAPIKey } from '../ai/utils/key-detector.js';

const CONFIG_PATH = 'config/api-keys.md';

export interface ProviderKeyInfo {
  provider: ProviderType;
  hasKey: boolean;
  keyPreview: string;
  baseUrl?: string;
  models?: string[];
}

export interface APIKeysResponse {
  version: string;
  updated: string;
  providers: Record<ProviderType, ProviderKeyInfo>;
}

export class APIKeysManager {
  private reader: VaultReader;
  private writer: VaultWriter;
  private cache: ApiKeysConfig | null = null;

  constructor(vaultPath?: string) {
    const resolvedPath = vaultPath || path.join(os.homedir(), '.qbot-vault');
    this.reader = new VaultReader(resolvedPath);
    this.writer = new VaultWriter(resolvedPath);
  }

  /**
   * Load API keys config from vault
   */
  async load(): Promise<ApiKeysConfig> {
    if (this.cache) return this.cache;

    const config = await this.reader.readConfig<ApiKeysConfig>(CONFIG_PATH);
    if (!config) {
      // Return default empty config
      return {
        version: '1.0',
        updated: new Date().toISOString()
      };
    }
    this.cache = config;
    return config;
  }

  /**
   * Save API keys config to vault
   */
  async save(config: ApiKeysConfig): Promise<void> {
    config.updated = new Date().toISOString();
    await this.writer.writeConfig(CONFIG_PATH, config);
    this.cache = config;
  }

  /**
   * Set API key for a provider
   */
  async setProviderKey(
    provider: ProviderType,
    apiKey: string,
    baseUrl?: string
  ): Promise<void> {
    const config = await this.load();

    const existing = config[provider] as ProviderConfig | undefined;

    config[provider] = {
      enabled: true,
      api_key: apiKey,
      base_url: baseUrl || existing?.base_url,
      models: existing?.models,
      default: existing?.default
    } as ProviderConfig;

    await this.save(config);
  }

  /**
   * Add API key with auto-detection of provider
   */
  async addAPIKey(apiKey: string, provider?: ProviderType): Promise<{
    success: boolean;
    detectedProvider: ProviderType | 'unknown';
    providerName: string;
    error?: string;
  }> {
    // Auto-detect provider if not specified
    const detection = detectAPIKeyProvider(apiKey);
    const resolvedProvider = provider || detection.provider;

    if (resolvedProvider === 'unknown') {
      return {
        success: false,
        detectedProvider: 'unknown',
        providerName: 'Unknown',
        error: 'Could not detect provider from API key format'
      };
    }

    await this.setProviderKey(
      resolvedProvider,
      apiKey,
      detection.suggestedBaseUrl
    );

    return {
      success: true,
      detectedProvider: resolvedProvider,
      providerName: detection.providerName
    };
  }

  /**
   * Remove API key for a provider
   */
  async removeProviderKey(provider: ProviderType): Promise<void> {
    const config = await this.load();
    const existing = config[provider] as ProviderConfig | undefined;

    if (existing) {
      // Keep config but remove the key
      config[provider] = {
        enabled: false,
        base_url: existing.base_url,
        models: existing.models,
        default: existing.default
      } as ProviderConfig;
      await this.save(config);
    }
  }

  /**
   * Get API key for a provider
   */
  async getProviderKey(provider: ProviderType): Promise<string | null> {
    const config = await this.load();
    const providerConfig = config[provider] as ProviderConfig | undefined;
    return providerConfig?.api_key || null;
  }

  /**
   * Get all provider keys (masked for display)
   */
  async getAllProviderKeys(): Promise<APIKeysResponse> {
    const config = await this.load();
    const providers: Record<ProviderType, ProviderKeyInfo> = {} as Record<ProviderType, ProviderKeyInfo>;

    const providerList: ProviderType[] = ['openrouter', 'openai', 'anthropic', 'deepseek'];

    for (const provider of providerList) {
      const providerConfig = config[provider] as ProviderConfig | undefined;
      const hasKey = !!(providerConfig?.api_key);

      providers[provider] = {
        provider,
        hasKey,
        keyPreview: hasKey ? maskAPIKey(providerConfig.api_key!) : '',
        baseUrl: providerConfig?.base_url,
        models: providerConfig?.models
      };
    }

    return {
      version: config.version || '1.0',
      updated: config.updated || new Date().toISOString(),
      providers
    };
  }

  /**
   * Clear cache (force reload on next access)
   */
  clearCache(): void {
    this.cache = null;
  }
}
