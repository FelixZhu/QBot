// packages/core/src/conversation/message.ts
import type { ChatMessage } from '../ai/types.js';

export interface ConversationMeta {
  id: string;
  created: string; // ISO date
  updated: string;
  title: string;
  model: string;
  provider: string;
}

export interface ConversationData {
  meta: ConversationMeta;
  messages: ChatMessage[];
  summary?: string;
}

/** Generate unique ID */
export function generateId(): string {
  return `conv-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/** Generate filename from date and title */
export function generateFilename(date: Date, title: string): string {
  const dateStr = date.toISOString().split('T')[0];
  let slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 50);
  // Remove leading and trailing hyphens
  slug = slug.replace(/^-+|-+$/g, '');
  return `${dateStr}-${slug}.md`;
}
