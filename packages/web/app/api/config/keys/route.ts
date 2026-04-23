import { NextRequest, NextResponse } from 'next/server';
import { APIKeysManager, type ProviderType } from '@qbot/core';

// GET /api/config/keys - Get all API keys (masked)
export async function GET() {
  try {
    const manager = new APIKeysManager();
    const keys = await manager.getAllProviderKeys();
    return NextResponse.json(keys);
  } catch (error) {
    console.error('Failed to load API keys:', error);
    return NextResponse.json(
      { error: 'Failed to load API keys' },
      { status: 500 }
    );
  }
}

// POST /api/config/keys - Save a new API key
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiKey, provider } = body;

    if (!apiKey || typeof apiKey !== 'string') {
      return NextResponse.json(
        { error: 'API key is required' },
        { status: 400 }
      );
    }

    const manager = new APIKeysManager();
    const result = await manager.addAPIKey(apiKey, provider as ProviderType | undefined);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to save API key' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      detectedProvider: result.detectedProvider,
      providerName: result.providerName
    });
  } catch (error) {
    console.error('Failed to save API key:', error);
    return NextResponse.json(
      { error: 'Failed to save API key' },
      { status: 500 }
    );
  }
}

// DELETE /api/config/keys?provider=xxx - Remove an API key
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider') as ProviderType | null;

    if (!provider) {
      return NextResponse.json(
        { error: 'Provider parameter is required' },
        { status: 400 }
      );
    }

    const manager = new APIKeysManager();
    await manager.removeProviderKey(provider);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete API key:', error);
    return NextResponse.json(
      { error: 'Failed to delete API key' },
      { status: 500 }
    );
  }
}
