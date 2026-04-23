// packages/core/src/__tests__/conversation/message.test.ts
import { describe, it, expect } from 'vitest';
import { generateId, generateFilename } from '../../conversation/message.js';

describe('Conversation Message Utilities', () => {
  describe('generateId', () => {
    it('should generate a unique ID with correct format', () => {
      const id = generateId();

      expect(id).toMatch(/^conv-\d+-[a-z0-9]{6}$/);
    });

    it('should generate unique IDs on multiple calls', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateId());
      }

      expect(ids.size).toBe(100);
    });
  });

  describe('generateFilename', () => {
    it('should generate filename with date and slugified title', () => {
      const date = new Date('2024-04-22T10:30:00Z');
      const filename = generateFilename(date, 'Test Conversation');

      expect(filename).toBe('2024-04-22-test-conversation.md');
    });

    it('should handle special characters in title', () => {
      const date = new Date('2024-04-22T10:30:00Z');
      const filename = generateFilename(date, 'Test & "Chat" with Special!@#$%Characters');

      expect(filename).toBe('2024-04-22-test-chat-with-special-characters.md');
    });

    it('should truncate long titles to 50 characters', () => {
      const date = new Date('2024-04-22T10:30:00Z');
      const longTitle = 'This is a very long conversation title that should be truncated to fit within the maximum length limit';
      const filename = generateFilename(date, longTitle);

      expect(filename.length).toBeLessThanOrEqual(64); // 10 (date) + 1 (-) + 50 (slug) + 3 (.md)
      expect(filename).toMatch(/^2024-04-22-this-is-a-very-long-conversation-title-that-should/);
    });

    it('should handle numbers in title', () => {
      const date = new Date('2024-04-22T10:30:00Z');
      const filename = generateFilename(date, 'Test 123 Conversation');

      expect(filename).toBe('2024-04-22-test-123-conversation.md');
    });

    it('should handle consecutive spaces and special characters', () => {
      const date = new Date('2024-04-22T10:30:00Z');
      const filename = generateFilename(date, 'Test   Multiple   Spaces');

      expect(filename).toBe('2024-04-22-test-multiple-spaces.md');
    });

    it('should handle title starting with special characters', () => {
      const date = new Date('2024-04-22T10:30:00Z');
      const filename = generateFilename(date, '!!!Test Conversation!!!');

      expect(filename).toBe('2024-04-22-test-conversation.md');
    });

    it('should handle different dates', () => {
      const date1 = new Date('2024-01-15T10:30:00Z');
      const filename1 = generateFilename(date1, 'Test Chat');

      const date2 = new Date('2024-12-31T10:30:00Z');
      const filename2 = generateFilename(date2, 'Test Chat');

      expect(filename1).toBe('2024-01-15-test-chat.md');
      expect(filename2).toBe('2024-12-31-test-chat.md');
    });
  });
});
