import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { APIKeysManager } from '@qbot/core';

export async function POST(req: Request) {
  try {
    const { userMessage, assistantMessage, model } = await req.json();

    if (!userMessage || !assistantMessage) {
      return Response.json({ error: 'Missing messages' }, { status: 400 });
    }

    // Get API key
    let apiKey: string | null = null;
    try {
      const manager = new APIKeysManager();
      apiKey = await manager.getProviderKey('openrouter');
    } catch {
      // Vault not available
    }

    if (!apiKey) {
      apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || null;
    }

    if (!apiKey) {
      return Response.json({ error: 'API key not configured' }, { status: 500 });
    }

    const openrouter = createOpenRouter({ apiKey });

    // Use a fast, cheap model for title generation
    const titleModel = openrouter.chat('openai/gpt-4o-mini');

    const result = await generateText({
      model: titleModel,
      system: 'You are a helpful assistant that generates concise titles for conversations. Generate a short, descriptive title (max 50 characters) for the following conversation. Only output the title, nothing else. Use the same language as the conversation.',
      messages: [
        {
          role: 'user',
          content: `User: ${userMessage}\n\nAssistant: ${assistantMessage}\n\nGenerate a short title for this conversation:`,
        },
      ],
      // @ts-expect-error maxTokens may not be in the type definitions
      maxTokens: 50,
    });

    const title = result.text.trim().replace(/["']/g, '').slice(0, 50);

    return Response.json({ title });
  } catch (error: any) {
    console.error('Title generation error:', error);
    return Response.json(
      { error: error.message || 'Failed to generate title' },
      { status: 500 }
    );
  }
}
