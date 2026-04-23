// packages/core/src/ai/providers/anthropic.ts

import Anthropic from '@anthropic-ai/sdk';
import { BaseProvider } from './base.js';
import type { ProviderType, CompletionOptions, CompletionResult, ChatMessage } from '../types.js';

/**
 * Anthropic provider - direct integration with Claude API.
 * Uses Anthropic SDK with different message format than OpenAI.
 * System messages are passed separately from the messages array.
 */
export class AnthropicProvider extends BaseProvider {
  readonly type: ProviderType = 'anthropic';
  private client: Anthropic;

  constructor(apiKey: string, _baseUrl?: string, defaultModel?: string) {
    super(apiKey, undefined, defaultModel || 'claude-3-sonnet-20240229');
    this.client = new Anthropic({ apiKey });
  }

  async getModels(): Promise<string[]> {
    return [
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307'
    ];
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    // Anthropic separates system message from messages array
    const systemMsg = options.messages.find(m => m.role === 'system');
    const messages = options.messages.filter(m => m.role !== 'system');

    if (!options.stream) {
      const response = await this.client.messages.create({
        model: options.model,
        max_tokens: options.max_tokens ?? 4096,
        system: systemMsg?.content ?? '',
        messages: messages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content
        }))
      });

      return {
        content: response.content[0]?.type === 'text' ? response.content[0].text : '',
        model: response.model,
        provider: 'anthropic',
        usage: response.usage ? {
          prompt_tokens: response.usage.input_tokens,
          completion_tokens: response.usage.output_tokens,
          total_tokens: response.usage.input_tokens + response.usage.output_tokens
        } : undefined
      };
    }

    // Streaming mode
    let fullContent = '';
    const stream = await this.client.messages.stream({
      model: options.model,
      max_tokens: options.max_tokens ?? 4096,
      system: systemMsg?.content ?? '',
      messages: messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }))
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullContent += event.delta.text;
        options.onStreamChunk?.(event.delta.text);
      }
    }

    return { content: fullContent, model: options.model, provider: 'anthropic' };
  }
}
