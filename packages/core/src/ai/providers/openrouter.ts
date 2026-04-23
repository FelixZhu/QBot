// packages/core/src/ai/providers/openrouter.ts

import OpenAI from 'openai';
import { BaseProvider } from './base.js';
import type {
  ProviderType,
  CompletionOptions,
  CompletionResult,
  ChatMessage
} from '../types.js';

/**
 * OpenRouter provider - aggregates multiple AI models through a single API key.
 * Uses OpenAI-compatible API, so we can leverage the OpenAI SDK.
 *
 * Model format: `provider/model-name` (e.g., `anthropic/claude-3.5-sonnet`)
 */
export class OpenRouterProvider extends BaseProvider {
  readonly type: ProviderType = 'openrouter';
  private client: OpenAI;

  constructor(apiKey: string, baseUrl?: string, defaultModel?: string) {
    super(apiKey, baseUrl || 'https://openrouter.ai/api/v1', defaultModel);
    this.client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
      dangerouslyAllowBrowser: false
    });
  }

  async getModels(): Promise<string[]> {
    // Return common OpenRouter models by default
    // In production, fetch from /api/v1/models
    return [
      'anthropic/claude-3.5-sonnet',
      'anthropic/claude-3-opus',
      'openai/gpt-4',
      'openai/gpt-4-turbo',
      'google/gemini-pro-1.5',
      'meta-llama/llama-3.1-405b-instruct'
    ];
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
        provider: 'openrouter',
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

    return {
      content: fullContent,
      model: options.model,
      provider: 'openrouter'
    };
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
