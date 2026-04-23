// packages/core/src/storage/conversation-repository.ts
import type OSS from 'ali-oss';
import matter from 'gray-matter';
import type { ChatMessage } from '../ai/types.js';
import type { ConversationData, ConversationMeta } from '../conversation/message.js';

export interface ConversationRepository {
  listConversations(userId: string): Promise<ConversationMeta[]>;
  getConversation(userId: string, convId: string): Promise<ConversationData | null>;
  saveConversation(userId: string, data: ConversationData): Promise<void>;
  deleteConversation(userId: string, convId: string): Promise<void>;
}

/** Build OSS object key for a conversation file */
function convKey(userId: string, convId: string): string {
  return `users/${userId}/conversations/${convId}.md`;
}

/** Build OSS object key for user index file */
function indexKey(userId: string): string {
  return `users/${userId}/index.md`;
}

/** Serialize conversation to markdown with YAML frontmatter */
function serializeConversation(data: ConversationData): string {
  const frontmatter = {
    id: data.meta.id,
    title: data.meta.title,
    created: data.meta.created,
    updated: data.meta.updated,
    model: data.meta.model,
    provider: data.meta.provider,
  };

  const lines: string[] = [];

  for (const msg of data.messages) {
    lines.push(`## ${capitalize(msg.role)}`, '', msg.content, '');
  }

  const content = lines.join('\n');
  return matter.stringify(content, frontmatter);
}

/** Parse conversation from markdown with YAML frontmatter */
function parseConversation(raw: string, convId: string): ConversationData | null {
  try {
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;

    const meta: ConversationMeta = {
      id: (data.id as string) || convId,
      title: (data.title as string) || 'Untitled',
      created: (data.created as string) || new Date().toISOString(),
      updated: (data.updated as string) || new Date().toISOString(),
      model: (data.model as string) || '',
      provider: (data.provider as string) || 'openrouter',
    };

    const messages: ChatMessage[] = [];
    const lines = parsed.content.split('\n');
    let currentRole: string | null = null;
    let currentContent = '';

    for (const line of lines) {
      const headerMatch = line.match(/^##\s+(.+)$/);
      if (headerMatch) {
        if (currentRole) {
          messages.push({
            role: currentRole as ChatMessage['role'],
            content: currentContent.trim(),
          });
        }
        currentRole = headerMatch[1].toLowerCase();
        currentContent = '';
      } else if (currentRole) {
        currentContent += line + '\n';
      }
    }

    if (currentRole) {
      messages.push({
        role: currentRole as ChatMessage['role'],
        content: currentContent.trim(),
      });
    }

    return { meta, messages };
  } catch {
    return null;
  }
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** OSS-backed conversation repository */
export class OSSConversationRepository implements ConversationRepository {
  constructor(private oss: OSS) {}

  async listConversations(userId: string): Promise<ConversationMeta[]> {
    const prefix = `users/${userId}/conversations/`;
    const result = await this.oss.list({ prefix, 'max-keys': 1000 }, {});
    const objects = result.objects || [];

    const metas: ConversationMeta[] = [];
    for (const obj of objects) {
      const convId = obj.name.replace(prefix, '').replace(/\.md$/, '');
      const conv = await this.getConversation(userId, convId);
      if (conv) {
        metas.push(conv.meta);
      }
    }

    // Sort by updated desc
    return metas.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
  }

  async getConversation(userId: string, convId: string): Promise<ConversationData | null> {
    try {
      const result = await this.oss.get(convKey(userId, convId));
      const raw = result.content.toString('utf-8');
      return parseConversation(raw, convId);
    } catch (error: any) {
      if (error.code === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  }

  async saveConversation(userId: string, data: ConversationData): Promise<void> {
    const raw = serializeConversation(data);
    await this.oss.put(convKey(userId, data.meta.id), Buffer.from(raw, 'utf-8'));
  }

  async deleteConversation(userId: string, convId: string): Promise<void> {
    await this.oss.delete(convKey(userId, convId));
  }
}

/** In-memory fallback repository for when OSS is not configured */
export class MemoryConversationRepository implements ConversationRepository {
  private store = new Map<string, ConversationData>();

  async listConversations(userId: string): Promise<ConversationMeta[]> {
    const metas: ConversationMeta[] = [];
    for (const [key, data] of this.store) {
      if (key.startsWith(`${userId}:`)) {
        metas.push(data.meta);
      }
    }
    return metas.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
  }

  async getConversation(userId: string, convId: string): Promise<ConversationData | null> {
    return this.store.get(`${userId}:${convId}`) || null;
  }

  async saveConversation(userId: string, data: ConversationData): Promise<void> {
    this.store.set(`${userId}:${data.meta.id}`, data);
  }

  async deleteConversation(userId: string, convId: string): Promise<void> {
    this.store.delete(`${userId}:${convId}`);
  }
}
