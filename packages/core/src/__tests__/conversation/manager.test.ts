// packages/core/src/__tests__/conversation/manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConversationManager } from '../../conversation/manager.js';
import { VaultManager } from '../../vault/manager.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('ConversationManager', () => {
  let tempDir: string;
  let vault: VaultManager;
  let convManager: ConversationManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qbot-test-'));
    vault = new VaultManager(tempDir);
    await vault.init();
    convManager = new ConversationManager(vault);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should create a new conversation', async () => {
    const conv = await convManager.create('Test Chat', 'gpt-4', 'openai');

    expect(conv.meta.id).toBeTruthy();
    expect(conv.meta.id).toMatch(/^conv-\d+-[a-z0-9]+$/);
    expect(conv.meta.title).toBe('Test Chat');
    expect(conv.meta.model).toBe('gpt-4');
    expect(conv.meta.provider).toBe('openai');
    expect(conv.meta.created).toBeTruthy();
    expect(conv.meta.updated).toBeTruthy();
    expect(conv.messages).toHaveLength(0);
  });

  it('should save conversation to file', async () => {
    await convManager.create('Test Chat', 'gpt-4', 'openai');

    const files = await vault.reader.listFiles('conversations');
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}-test-chat\.md$/);
  });

  it('should load a conversation by filename', async () => {
    const conv = await convManager.create('Test Chat', 'gpt-4', 'openai');
    const files = await vault.reader.listFiles('conversations');
    const filename = files[0];

    const loaded = await convManager.load(filename!);

    expect(loaded).toBeTruthy();
    expect(loaded?.meta.id).toBe(conv.meta.id);
    expect(loaded?.meta.title).toBe('Test Chat');
    expect(loaded?.meta.model).toBe('gpt-4');
    expect(loaded?.meta.provider).toBe('openai');
  });

  it('should return null for non-existent conversation', async () => {
    const loaded = await convManager.load('non-existent.md');
    expect(loaded).toBeNull();
  });

  it('should add messages to conversation', async () => {
    await convManager.create('Test Chat', 'gpt-4', 'openai');
    const files = await vault.reader.listFiles('conversations');
    const filename = files[0];

    await convManager.addMessage(filename!, { role: 'user', content: 'Hello!' });
    await convManager.addMessage(filename!, { role: 'assistant', content: 'Hi there!' });

    const loaded = await convManager.load(filename!);
    expect(loaded?.messages).toHaveLength(2);
    expect(loaded?.messages[0]).toEqual({ role: 'user', content: 'Hello!' });
    expect(loaded?.messages[1]).toEqual({ role: 'assistant', content: 'Hi there!' });
  });

  it('should update conversation timestamp when adding message', async () => {
    await convManager.create('Test Chat', 'gpt-4', 'openai');
    const files = await vault.reader.listFiles('conversations');
    const filename = files[0];

    const beforeUpdate = await convManager.load(filename!);
    const originalUpdated = beforeUpdate?.meta.updated;

    // Wait a bit to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 10));

    await convManager.addMessage(filename!, { role: 'user', content: 'Hello!' });

    const afterUpdate = await convManager.load(filename!);
    expect(new Date(afterUpdate?.meta.updated!).getTime()).toBeGreaterThanOrEqual(
      new Date(originalUpdated!).getTime()
    );
  });

  it('should list all conversations sorted by creation date', async () => {
    // Create conversations with small delays to ensure different timestamps
    await convManager.create('First Chat', 'gpt-4', 'openai');
    await new Promise(resolve => setTimeout(resolve, 10));
    await convManager.create('Second Chat', 'claude-3', 'anthropic');
    await new Promise(resolve => setTimeout(resolve, 10));
    await convManager.create('Third Chat', 'deepseek-chat', 'deepseek');

    const list = await convManager.listAll();

    expect(list).toHaveLength(3);
    // Should be sorted by creation date descending (newest first)
    expect(list[0].title).toBe('Third Chat');
    expect(list[1].title).toBe('Second Chat');
    expect(list[2].title).toBe('First Chat');
  });

  it('should return empty list when no conversations exist', async () => {
    const list = await convManager.listAll();
    expect(list).toHaveLength(0);
  });

  it('should update conversation summary', async () => {
    await convManager.create('Test Chat', 'gpt-4', 'openai');
    const files = await vault.reader.listFiles('conversations');
    const filename = files[0];

    await convManager.updateSummary(filename!, 'This is a summary of the conversation.');

    const loaded = await convManager.load(filename!);
    expect(loaded?.summary).toBe('This is a summary of the conversation.');
  });

  it('should delete a conversation', async () => {
    await convManager.create('Test Chat', 'gpt-4', 'openai');
    const files = await vault.reader.listFiles('conversations');
    expect(files).toHaveLength(1);

    await convManager.delete(files[0]!);

    const filesAfterDelete = await vault.reader.listFiles('conversations');
    expect(filesAfterDelete).toHaveLength(0);
  });

  it('should handle multiple messages with different roles', async () => {
    await convManager.create('Multi-message Chat', 'gpt-4', 'openai');
    const files = await vault.reader.listFiles('conversations');
    const filename = files[0];

    await convManager.addMessage(filename!, { role: 'system', content: 'You are a helpful assistant.' });
    await convManager.addMessage(filename!, { role: 'user', content: 'What is AI?' });
    await convManager.addMessage(filename!, { role: 'assistant', content: 'AI stands for Artificial Intelligence.' });
    await convManager.addMessage(filename!, { role: 'user', content: 'Thanks!' });
    await convManager.addMessage(filename!, { role: 'assistant', content: 'You are welcome!' });

    const loaded = await convManager.load(filename!);
    expect(loaded?.messages).toHaveLength(5);
    expect(loaded?.messages[0].role).toBe('system');
    expect(loaded?.messages[1].role).toBe('user');
    expect(loaded?.messages[2].role).toBe('assistant');
    expect(loaded?.messages[3].role).toBe('user');
    expect(loaded?.messages[4].role).toBe('assistant');
  });

  it('should handle special characters in title', async () => {
    const conv = await convManager.create('Test & Chat with "quotes"', 'gpt-4', 'openai');

    expect(conv.meta.title).toBe('Test & Chat with "quotes"');

    const files = await vault.reader.listFiles('conversations');
    const loaded = await convManager.load(files[0]!);

    expect(loaded?.meta.title).toBe('Test & Chat with "quotes"');
  });

  it('should handle multi-line message content', async () => {
    await convManager.create('Test Chat', 'gpt-4', 'openai');
    const files = await vault.reader.listFiles('conversations');
    const filename = files[0];

    const multiLineContent = `This is a message
with multiple
lines of text.

It even has blank lines.`;

    await convManager.addMessage(filename!, { role: 'user', content: multiLineContent });

    const loaded = await convManager.load(filename!);
    expect(loaded?.messages[0].content).toBe(multiLineContent);
  });

  it('should generate unique IDs', async () => {
    const conv1 = await convManager.create('Chat 1', 'gpt-4', 'openai');
    const conv2 = await convManager.create('Chat 2', 'gpt-4', 'openai');

    expect(conv1.meta.id).not.toBe(conv2.meta.id);
  });

  it('should persist conversation across operations', async () => {
    // Create
    const conv = await convManager.create('Persistence Test', 'gpt-4', 'openai');
    const files = await vault.reader.listFiles('conversations');
    const filename = files[0]!;

    // Add messages
    await convManager.addMessage(filename, { role: 'user', content: 'Question 1' });
    await convManager.addMessage(filename, { role: 'assistant', content: 'Answer 1' });

    // Update summary
    await convManager.updateSummary(filename, 'A test conversation');

    // Load and verify all data persisted
    const loaded = await convManager.load(filename);

    expect(loaded?.meta.id).toBe(conv.meta.id);
    expect(loaded?.meta.title).toBe('Persistence Test');
    expect(loaded?.messages).toHaveLength(2);
    expect(loaded?.summary).toBe('A test conversation');
  });
});
