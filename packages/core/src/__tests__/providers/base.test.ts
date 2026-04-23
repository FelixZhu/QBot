// packages/core/src/__tests__/providers/base.test.ts

import { describe, it, expect } from 'vitest';
import { BaseProvider } from '../../ai/providers/base.js';
import type { ProviderType, CompletionResult } from '../../ai/types.js';

class MockProvider extends BaseProvider {
  readonly type: ProviderType = 'openai';

  async getModels(): Promise<string[]> {
    return ['gpt-4', 'gpt-3.5-turbo'];
  }

  async complete(): Promise<CompletionResult> {
    return { content: '', model: '', provider: 'openai' };
  }
}

describe('BaseProvider', () => {
  it('should detect when configured', () => {
    const provider = new MockProvider('sk-test');
    expect(provider.isConfigured()).toBe(true);
  });

  it('should detect when not configured', () => {
    const provider = new MockProvider('');
    expect(provider.isConfigured()).toBe(false);
  });

  it('should return default model if set', async () => {
    const provider = new MockProvider('sk-key', undefined, 'gpt-4');
    const model = await provider.getDefaultModel();
    expect(model).toBe('gpt-4');
  });

  it('should return first model if no default', async () => {
    const provider = new MockProvider('sk-key');
    const model = await provider.getDefaultModel();
    expect(model).toBe('gpt-4');
  });

  it('should validate existing model', async () => {
    const provider = new MockProvider('sk-key');
    const isValid = await provider.validateModel('gpt-4');
    expect(isValid).toBe(true);
  });

  it('should invalidate non-existing model', async () => {
    const provider = new MockProvider('sk-key');
    const isValid = await provider.validateModel('non-existent-model');
    expect(isValid).toBe(false);
  });

  it('should return empty string when no models available', async () => {
    class EmptyProvider extends BaseProvider {
      readonly type: ProviderType = 'openai';

      async getModels(): Promise<string[]> {
        return [];
      }

      async complete(): Promise<CompletionResult> {
        return { content: '', model: '', provider: 'openai' };
      }
    }

    const provider = new EmptyProvider('sk-key');
    const model = await provider.getDefaultModel();
    expect(model).toBe('');
  });
});
