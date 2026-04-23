// packages/core/src/ai/providers/openai.ts

import OpenAI from 'openai';
import { BaseProvider } from './base.js';
import type { ProviderType, CompletionOptions, CompletionResult, ChatMessage } from '../types.js';

/**
 * OpenAI provider - direct integration with OpenAI API.
 * Supports GPT-4, GPT-3.5, and O1 series models.
 */
export class OpenAIProvider extends BaseProvider {
  readonly type: ProviderType = 'openai';
  private client: OpenAI;

  constructor(apiKey: string, baseUrl?: string, defaultModel?: string) {
    super(apiKey, baseUrl || 'https://api.openai.com/v1', defaultModel);
    this.client = new OpenAI({ apiKey, baseURL: this.baseUrl });
  }

  async getModels(): Promise<string[]> {
    return ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini'];
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    if (!options.stream) {
      const response = await this.client.chat.completions.create({
        model: options.model,
        messages: options.messages.map(this.formatMessage),
        temperature: options.temperature ?? 0.7,
        max_tokens: options.max_tokens
      });

      return {
        content: response.choices[0]?.message?.content ?? '',
        model: response.model,
        provider: 'openai',
        usage: response.usage ? {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens
        } : undefined
      };
    }

    // Streaming mode
    let fullContent = '';
    const stream = await this.client.chat.completions.create({
      model: options.model,
      messages: options.messages.map(this.formatMessage),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens,
      stream: true
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullContent += delta;
        options.onStreamChunk?.(delta);
      }
    }

    return { content: fullContent, model: options.model, provider: 'openai' };
  }

  private formatMessage(msg: ChatMessage): OpenAI.ChatCompletionMessageParam {
    if (msg.role === 'system') {
      return { role: 'system', content: msg.content };
    }
    if (msg.role === 'assistant') {
      return { role: 'assistant', content: msg.content };
    }
    return { role: 'user', content: msg.content };
  }
}
