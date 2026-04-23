// packages/core/src/vault/schema/conversation.ts
import type { ConversationMeta, ConversationData } from '../../conversation/message.js';

/**
 * Parse conversation metadata from markdown frontmatter
 * This is used when reading conversation files from the vault
 */
export function parseConversationMeta(raw: string): Partial<ConversationMeta> | null {
  try {
    const lines = raw.split('\n');
    const meta: Partial<ConversationMeta> = {};

    for (const line of lines) {
      if (line.startsWith('- id:')) meta.id = line.split(':')[1].trim();
      else if (line.startsWith('- created:')) meta.created = line.split(':', 2)[1].trim();
      else if (line.startsWith('- updated:')) meta.updated = line.split(':', 2)[1].trim();
      else if (line.startsWith('- title:')) meta.title = line.split(':', 2)[1].trim();
      else if (line.startsWith('- model:')) meta.model = line.split(':')[1].trim();
      else if (line.startsWith('- provider:')) meta.provider = line.split(':')[1].trim();
    }

    return meta;
  } catch {
    return null;
  }
}

/**
 * Serialize conversation metadata to markdown format
 */
export function serializeConversationMeta(meta: ConversationMeta): string {
  return [
    '## Metadata',
    `- id: ${meta.id}`,
    `- created: ${meta.created}`,
    `- updated: ${meta.updated}`,
    `- model: ${meta.model}`,
    `- provider: ${meta.provider}`
  ].join('\n');
}
