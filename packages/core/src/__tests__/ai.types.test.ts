// packages/core/src/__tests__/ai.types.test.ts
import { describe, it, expect } from 'vitest';
import type { ChatMessage, ProviderConfig, ApiKeysConfig } from '../ai/types.js';

describe('AI Types', () => {
  it('should define valid ChatMessage', () => {
    const msg: ChatMessage = { role: 'user', content: 'hello' };
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hello');
  });

  it('should define valid ProviderConfig', () => {
    const config: ProviderConfig = {
      enabled: true,
      api_key: 'sk-test',
      default: 'gpt-4',
      models: ['gpt-4', 'gpt-3.5-turbo']
    };
    expect(config.enabled).toBe(true);
  });
});
