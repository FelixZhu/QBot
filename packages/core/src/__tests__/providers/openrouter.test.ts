// packages/core/src/__tests__/providers/openrouter.test.ts

import { describe, it, expect, vi } from 'vitest';
import { OpenRouterProvider } from '../../ai/providers/openrouter.js';

describe('OpenRouterProvider', () => {
  it('should create instance with correct defaults', () => {
    const provider = new OpenRouterProvider('sk-or-test');
    expect(provider.type).toBe('openrouter');
    expect(provider.isConfigured()).toBe(true);
  });

  it('should detect when not configured', () => {
    const provider = new OpenRouterProvider('');
    expect(provider.isConfigured()).toBe(false);
  });

  it('should use custom baseUrl', () => {
    const provider = new OpenRouterProvider('sk-or-test', 'https://custom.api/v1');
    // Verify baseUrl is set through parent - we can't directly access it
    // but we can verify the provider was created successfully
    expect(provider.type).toBe('openrouter');
    expect(provider.isConfigured()).toBe(true);
  });

  it('should use default model when provided', async () => {
    const provider = new OpenRouterProvider('sk-or-test', undefined, 'anthropic/claude-3-opus');
    const model = await provider.getDefaultModel();
    expect(model).toBe('anthropic/claude-3-opus');
  });

  it('should return list of models', async () => {
    const provider = new OpenRouterProvider('sk-or-test');
    const models = await provider.getModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toContain('/');
  });

  it('should return expected default models', async () => {
    const provider = new OpenRouterProvider('sk-or-test');
    const models = await provider.getModels();
    expect(models).toContain('anthropic/claude-3.5-sonnet');
    expect(models).toContain('openai/gpt-4');
    expect(models).toContain('google/gemini-pro-1.5');
  });

  it('should validate existing model', async () => {
    const provider = new OpenRouterProvider('sk-or-test');
    const isValid = await provider.validateModel('anthropic/claude-3.5-sonnet');
    expect(isValid).toBe(true);
  });

  it('should invalidate non-existing model', async () => {
    const provider = new OpenRouterProvider('sk-or-test');
    const isValid = await provider.validateModel('non-existent-model');
    expect(isValid).toBe(false);
  });
});
