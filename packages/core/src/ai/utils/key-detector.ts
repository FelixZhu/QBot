// packages/core/src/ai/utils/key-detector.ts

import type { ProviderType } from '../types';

export interface DetectionResult {
  provider: ProviderType | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  suggestedBaseUrl?: string;
  providerName: string;
}

interface ProviderPattern {
  patterns: RegExp[];
  baseUrl: string;
  name: string;
}

const PROVIDER_PATTERNS: Record<ProviderType, ProviderPattern> = {
  openrouter: {
    patterns: [/^sk-or-v1-/],
    baseUrl: 'https://openrouter.ai/api/v1',
    name: 'OpenRouter'
  },
  anthropic: {
    patterns: [/^sk-ant-/],
    baseUrl: 'https://api.anthropic.com/v1',
    name: 'Anthropic'
  },
  deepseek: {
    patterns: [/^sk-[a-f0-9]{32,}$/],
    baseUrl: 'https://api.deepseek.com/v1',
    name: 'DeepSeek'
  },
  openai: {
    patterns: [/^sk-(?!or-v1-|ant-)[a-zA-Z0-9]{20,}$/],
    baseUrl: 'https://api.openai.com/v1',
    name: 'OpenAI'
  }
};

// Detection priority: more specific patterns first
const DETECTION_PRIORITY: ProviderType[] = ['openrouter', 'anthropic', 'deepseek', 'openai'];

/**
 * Detect provider type from API key format
 */
export function detectAPIKeyProvider(apiKey: string): DetectionResult {
  if (!apiKey || apiKey.length < 10) {
    return { provider: 'unknown', confidence: 'low', providerName: 'Unknown' };
  }

  for (const provider of DETECTION_PRIORITY) {
    const config = PROVIDER_PATTERNS[provider];
    for (const pattern of config.patterns) {
      if (pattern.test(apiKey)) {
        return {
          provider,
          confidence: 'high',
          suggestedBaseUrl: config.baseUrl,
          providerName: config.name
        };
      }
    }
  }

  // Generic sk- prefix - assume OpenAI compatible
  if (apiKey.startsWith('sk-')) {
    return {
      provider: 'openai',
      confidence: 'medium',
      suggestedBaseUrl: 'https://api.openai.com/v1',
      providerName: 'OpenAI (Generic)'
    };
  }

  return { provider: 'unknown', confidence: 'low', providerName: 'Unknown' };
}

/**
 * Get provider display name
 */
export function getProviderName(provider: ProviderType | 'unknown'): string {
  if (provider === 'unknown') return 'Unknown';
  return PROVIDER_PATTERNS[provider]?.name || provider;
}

/**
 * Mask API key for display (show prefix and last 4 chars)
 */
export function maskAPIKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 8) return '***';
  const prefix = apiKey.slice(0, 7);
  const suffix = apiKey.slice(-4);
  return `${prefix}...${suffix}`;
}

/**
 * Get default base URL for provider
 */
export function getDefaultBaseUrl(provider: ProviderType): string {
  return PROVIDER_PATTERNS[provider]?.baseUrl || '';
}
