// packages/core/src/storage/local-store.ts
import matter from 'gray-matter';
import type { FileStorage } from './types.js';
import type { ChatMessage } from '../ai/types.js';
import type { ConversationData, ConversationMeta } from '../conversation/message.js';

export interface LocalStoreOptions {
  storage: FileStorage;
  conversationsDir?: string;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Serialize conversation to markdown with YAML frontmatter */
export function serializeConversation(data: ConversationData): string {
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

  return matter.stringify(lines.join('\n'), frontmatter);
}

/** Parse conversation from markdown with YAML frontmatter */
export function parseConversation(raw: string, convId: string): ConversationData | null {
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

/**
 * Local-first conversation store.
 * All data is stored as MD files in the configured directory.
 * Index is built in memory by scanning files.
 */
export class LocalStore {
  private storage: FileStorage;
  private conversationsDir: string;
  private index = new Map<string, ConversationMeta>();
  private indexBuilt = false;

  constructor(options: LocalStoreOptions) {
    this.storage = options.storage;
    this.conversationsDir = options.conversationsDir || 'conversations';
  }

  private convPath(convId: string): string {
    return `${this.conversationsDir}/${convId}.md`;
  }

  /** Build or rebuild the in-memory index */
  async buildIndex(): Promise<void> {
    this.index.clear();
    const files = await this.storage.listFiles(`${this.conversationsDir}/*.md`);

    for (const file of files) {
      const convId = file.replace(`${this.conversationsDir}/`, '').replace(/\.md$/, '');
      const raw = await this.storage.readFile(file);
      const conv = parseConversation(raw, convId);
      if (conv) {
        this.index.set(convId, conv.meta);
      }
    }

    this.indexBuilt = true;
  }

  /** Ensure index is built */
  private async ensureIndex(): Promise<void> {
    if (!this.indexBuilt) {
      await this.buildIndex();
    }
  }

  /** List all conversations (from index) */
  async listConversations(): Promise<ConversationMeta[]> {
    await this.ensureIndex();
    const metas = Array.from(this.index.values());
    return metas.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
  }

  /** Get a single conversation with messages */
  async getConversation(convId: string): Promise<ConversationData | null> {
    await this.ensureIndex();
    try {
      const raw = await this.storage.readFile(this.convPath(convId));
      return parseConversation(raw, convId);
    } catch {
      return null;
    }
  }

  /** Save a conversation */
  async saveConversation(data: ConversationData): Promise<void> {
    const raw = serializeConversation(data);
    await this.storage.writeFile(this.convPath(data.meta.id), raw);
    this.index.set(data.meta.id, data.meta);
  }

  /** Delete a conversation */
  async deleteConversation(convId: string): Promise<void> {
    await this.storage.deleteFile(this.convPath(convId));
    this.index.delete(convId);
  }

  /** Append messages to a conversation */
  async appendMessages(convId: string, messages: ChatMessage[]): Promise<void> {
    const conv = await this.getConversation(convId);
    if (!conv) {
      throw new Error(`Conversation not found: ${convId}`);
    }

    const now = new Date().toISOString();
    const updated: ConversationData = {
      meta: { ...conv.meta, updated: now },
      messages: [...conv.messages, ...messages],
    };

    await this.saveConversation(updated);
  }

  /** Update conversation metadata */
  async updateMeta(convId: string, updates: Partial<ConversationMeta>): Promise<void> {
    const conv = await this.getConversation(convId);
    if (!conv) {
      throw new Error(`Conversation not found: ${convId}`);
    }

    const now = new Date().toISOString();
    const updated: ConversationData = {
      meta: { ...conv.meta, ...updates, updated: now },
      messages: conv.messages,
    };

    await this.saveConversation(updated);
  }
}
