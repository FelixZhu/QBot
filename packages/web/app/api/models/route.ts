import { NextResponse } from 'next/server';

interface OpenRouterModel {
  id: string;
  name: string;
  context_length?: number;
  pricing?: { prompt: string; completion: string };
  top_provider?: { max_completion_tokens?: number };
  architecture?: { modality: string };
}

// In-memory cache with TTL
let cachedModels: any[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function GET() {
  const now = Date.now();
  if (cachedModels && now - cacheTimestamp < CACHE_TTL) {
    return NextResponse.json({ models: cachedModels });
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) throw new Error('Failed to fetch models');

    const data = await res.json();
    const models: OpenRouterModel[] = data.data || [];

    cachedModels = models
      .filter((m) => m.id && m.name)
      .map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.id.split('/')[0] || 'other',
        contextWindow: m.context_length,
        maxTokens: m.top_provider?.max_completion_tokens,
        modality: m.architecture?.modality || 'text',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    cacheTimestamp = now;
    return NextResponse.json({ models: cachedModels });
  } catch (error) {
    console.error('Failed to fetch OpenRouter models:', error);
    return NextResponse.json(
      { error: 'Failed to fetch models', models: [] },
      { status: 500 }
    );
  }
}
