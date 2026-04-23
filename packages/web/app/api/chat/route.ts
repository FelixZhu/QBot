import { streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { frontendTools } from '@assistant-ui/react-ai-sdk';
import { APIKeysManager, type ProviderType } from '@qbot/core';

// Provider base URLs for non-OpenRouter providers
const PROVIDER_BASE_URLS: Record<ProviderType, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
};

// Detect provider from model name
function detectProviderFromModel(model: string): ProviderType {
  if (model.includes('/') && model.startsWith('anthropic/')) return 'openrouter';
  if (model.includes('/') && model.startsWith('openai/')) return 'openrouter';
  if (model.includes('/') && model.startsWith('google/')) return 'openrouter';
  if (model.includes('/') && model.startsWith('meta-llama/')) return 'openrouter';
  if (model.startsWith('gpt-') || model.startsWith('o1-') || model.startsWith('o3-')) return 'openai';
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('deepseek-')) return 'deepseek';
  return 'openrouter';
}

// Get API key for provider
async function getApiKey(provider: ProviderType): Promise<string | null> {
  // Try vault config first
  try {
    const manager = new APIKeysManager();
    const key = await manager.getProviderKey(provider);
    if (key) return key;
  } catch {
    // Vault not available
  }

  // Fall back to environment
  const envKey = process.env[`${provider.toUpperCase()}_API_KEY`];
  if (envKey) return envKey;

  // Special case for OpenRouter
  if (provider === 'openrouter') {
    return process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || null;
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { model, system, tools } = body;

    // Convert assistant-ui message format to AI SDK format
    let messages = body.messages || [];
    messages = messages.map((msg: any) => {
      // Handle assistant-ui format (has parts array)
      if (msg.parts && Array.isArray(msg.parts)) {
        const textPart = msg.parts.find((p: any) => p.type === 'text');
        return {
          role: msg.role,
          content: textPart?.text || '',
        };
      }
      // Already in correct format
      return msg;
    });

    if (!model) {
      return new Response(JSON.stringify({ error: 'Model is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const provider = detectProviderFromModel(model);
    const apiKey = await getApiKey(provider);

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: `API key not configured for ${provider}. Please add your API key in Settings > BYOK.`,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Use OpenRouter provider for OpenRouter models
    if (provider === 'openrouter') {
      const openrouter = createOpenRouter({ apiKey });
      const result = streamText({
        model: openrouter.chat(model),
        system: system || undefined,
        messages,
        tools: tools ? frontendTools(tools) : undefined,
      });
      return result.toUIMessageStreamResponse();
    }

    // For other providers, use OpenAI-compatible client
    const { createOpenAI } = await import('@ai-sdk/openai');
    const baseUrl = PROVIDER_BASE_URLS[provider];
    const providerClient = createOpenAI({ apiKey, baseURL: baseUrl });

    const result = streamText({
      model: providerClient(model),
      system: system || undefined,
      messages,
      tools: tools ? frontendTools(tools) : undefined,
    });

    return result.toUIMessageStreamResponse();
  } catch (error: any) {
    console.error('Chat error:', error);
    return new Response(
      JSON.stringify({
        error: error.message || 'Internal server error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
