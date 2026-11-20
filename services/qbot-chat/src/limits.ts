/** Bounds for one personal chat on a 2 GB host. Not an agent memory policy. */
export const LIMITS = {
  bodyBytes: 32 * 1024,
  textChars: 8_000,
  titleChars: 80,
  conversations: 100,
  messagesPerConversation: 2_000,
  historyPage: 200,
  contextMessages: 40,
  contextChars: 24_000,
  outputChars: 32_000,
  upstreamMs: 90_000,
  ratePerMinute: 60,
  tokenMin: 16,
  tokenMax: 256,
} as const;
