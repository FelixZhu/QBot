// packages/core/src/conversation/manager.ts
import { VaultManager } from '../vault/manager.js';
import { generateId, generateFilename, type ConversationData, type ConversationMeta } from './message.js';
import type { ChatMessage } from '../ai/types.js';

export class ConversationManager {
  constructor(private vault: VaultManager) {}

  /** Create a new conversation */
  async create(title: string, model: string, provider: string): Promise<ConversationData> {
    const now = new Date().toISOString();
    const meta: ConversationMeta = {
      id: generateId(),
      created: now,
      updated: now,
      title,
      model,
      provider
    };

    const conv: ConversationData = { meta, messages: [] };

    // Save to vault
    const filename = generateFilename(new Date(), title);
    await this.save(conv, filename);

    return conv;
  }

  /** Load a conversation by filename */
  async load(filename: string): Promise<ConversationData | null> {
    const raw = await this.vault.reader.readFile(`conversations/${filename}`);
    if (!raw) return null;

    return this.parseConversation(raw);
  }

  /** List all conversations (returns metadata only) */
  async listAll(): Promise<ConversationMeta[]> {
    const files = await this.vault.reader.listFiles('conversations');
    const metas: ConversationMeta[] = [];

    for (const file of files) {
      const conv = await this.load(file);
      if (conv) metas.push(conv.meta);
    }

    // Sort by creation date descending
    return metas.sort((a, b) =>
      new Date(b.created).getTime() - new Date(a.created).getTime()
    );
  }

  /** Add a message to conversation */
  async addMessage(filename: string, message: ChatMessage): Promise<ConversationData | null> {
    const conv = await this.load(filename);
    if (!conv) return null;

    conv.messages.push(message);
    conv.meta.updated = new Date().toISOString();

    await this.save(conv, filename);
    return conv;
  }

  /** Update conversation summary */
  async updateSummary(filename: string, summary: string): Promise<void> {
    const conv = await this.load(filename);
    if (!conv) return;

    conv.summary = summary;
    await this.save(conv, filename);
  }

  /** Delete a conversation */
  async delete(filename: string): Promise<void> {
    await this.vault.writer.deleteFile(`conversations/${filename}`);
  }

  /** Parse conversation from markdown */
  private parseConversation(raw: string): ConversationData | null {
    try {
      const lines = raw.split('\n');

      // Extract metadata from YAML-like format
      const meta: Partial<ConversationMeta> = {};
      const messages: ChatMessage[] = [];
      let currentRole: string | null = null;
      let currentContent = '';
      let summary = '';
      let inMessages = false;
      let inSummary = false;

      for (const line of lines) {
        if (line.startsWith('- id:')) meta.id = line.substring(5).trim();
        else if (line.startsWith('- title:')) meta.title = line.substring(8).trim();
        else if (line.startsWith('- created:')) meta.created = line.substring(10).trim();
        else if (line.startsWith('- updated:')) meta.updated = line.substring(10).trim();
        else if (line.startsWith('- model:')) meta.model = line.substring(8).trim();
        else if (line.startsWith('- provider:')) meta.provider = line.substring(11).trim();
        else if (line.startsWith('## Messages')) { inMessages = true; continue; }
        else if (line.startsWith('---') && inMessages) { inSummary = true; continue; }
        else if (line.startsWith('## Summary') && inSummary) continue;
        else if (inSummary && !line.startsWith('#')) { summary += line + '\n'; }
        else if (inMessages && line.startsWith('### ')) {
          if (currentRole) {
            messages.push({ role: currentRole as ChatMessage['role'], content: currentContent.trim() });
          }
          currentRole = line.replace('### ', '');
          currentContent = '';
        } else if (inMessages && currentRole) {
          currentContent += line + '\n';
        }
      }

      // Don't forget last message
      if (currentRole) {
        messages.push({ role: currentRole as ChatMessage['role'], content: currentContent.trim() });
      }

      if (!meta.id || !meta.title) return null;

      return {
        meta: meta as ConversationMeta,
        messages,
        summary: summary.trim() || undefined
      };
    } catch {
      return null;
    }
  }

  /** Serialize conversation to markdown */
  private async save(conv: ConversationData, filename: string): Promise<void> {
    const lines: string[] = [
      `# ${conv.meta.title}`,
      '',
      '## Metadata',
      `- id: ${conv.meta.id}`,
      `- title: ${conv.meta.title}`,
      `- created: ${conv.meta.created}`,
      `- updated: ${conv.meta.updated}`,
      `- model: ${conv.meta.model}`,
      `- provider: ${conv.meta.provider}`,
      '',
      '## Messages',
      ''
    ];

    for (const msg of conv.messages) {
      lines.push(`### ${msg.role}`, '');
      lines.push(msg.content, '');
    }

    lines.push('---', '');

    if (conv.summary) {
      lines.push('## Summary', '', conv.summary);
    } else {
      lines.push('## Summary', '', '');
    }

    await this.vault.writer.writeFile(`conversations/${filename}`, lines.join('\n'));
  }
}
