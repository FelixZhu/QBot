import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VaultManager } from '../../vault/manager.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('VaultManager', () => {
  let tempDir: string;
  let vault: VaultManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qbot-test-'));
    vault = new VaultManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should initialize vault directory structure', async () => {
    await vault.init();

    expect(await vault.isInitialized()).toBe(true);

    const expectedDirs = ['config', 'conversations', 'knowledge', 'research', 'templates'];
    for (const dir of expectedDirs) {
      const stat = await fs.stat(vault.resolvePath(dir));
      expect(stat.isDirectory()).toBe(true);
    }
  });

  it('should report uninitialized vault', async () => {
    expect(await vault.isInitialized()).toBe(false);
  });

  it('should resolve paths within vault', () => {
    const resolved = vault.resolvePath('config', 'test.md');
    expect(resolved).toContain('config');
    expect(resolved).toContain('test.md');
  });

  it('should get vault path', () => {
    expect(vault.getPath()).toBe(tempDir);
  });

  it('should have reader and writer instances', () => {
    expect(vault.reader).toBeDefined();
    expect(vault.writer).toBeDefined();
  });
});

describe('VaultReader', () => {
  let tempDir: string;
  let vault: VaultManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qbot-test-'));
    vault = new VaultManager(tempDir);
    await vault.init();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should read config file with YAML frontmatter', async () => {
    interface TestConfig {
      apiKey: string;
      model: string;
    }

    const configData: TestConfig = {
      apiKey: 'test-key-123',
      model: 'gpt-4'
    };

    await vault.writer.writeConfig('config/test.md', configData);
    const readData = await vault.reader.readConfig<TestConfig>('config/test.md');

    expect(readData).toEqual(configData);
  });

  it('should return null for non-existent file', async () => {
    const result = await vault.reader.readConfig('config/nonexistent.md');
    expect(result).toBeNull();
  });

  it('should read raw file content', async () => {
    const content = '# Test Content\n\nThis is test.';
    await vault.writer.writeFile('config/raw.md', content);

    const readContent = await vault.reader.readFile('config/raw.md');
    expect(readContent).toBe(content);
  });

  it('should list files in directory', async () => {
    await vault.writer.writeFile('config/file1.md', 'content1');
    await vault.writer.writeFile('config/file2.md', 'content2');
    await vault.writer.writeFile('config/file3.txt', 'content3');

    const files = await vault.reader.listFiles('config', '.md');
    expect(files).toHaveLength(2);
    expect(files).toContain('file1.md');
    expect(files).toContain('file2.md');
    expect(files).not.toContain('file3.txt');
  });

  it('should check if file exists', async () => {
    await vault.writer.writeFile('config/exists.md', 'content');

    expect(await vault.reader.exists('config/exists.md')).toBe(true);
    expect(await vault.reader.exists('config/notexists.md')).toBe(false);
  });
});

describe('VaultWriter', () => {
  let tempDir: string;
  let vault: VaultManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qbot-test-'));
    vault = new VaultManager(tempDir);
    await vault.init();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should write config file with YAML frontmatter', async () => {
    interface TestConfig {
      name: string;
      count: number;
    }

    const configData: TestConfig = {
      name: 'test',
      count: 42
    };

    await vault.writer.writeConfig('config/test.md', configData);

    const raw = await vault.reader.readFile('config/test.md');
    expect(raw).toContain('---');
    expect(raw).toContain('name: test');
    expect(raw).toContain('count: 42');
  });

  it('should write raw content to file', async () => {
    const content = '# Markdown Content\n\nSome text.';
    await vault.writer.writeFile('config/raw.md', content);

    const readContent = await vault.reader.readFile('config/raw.md');
    expect(readContent).toBe(content);
  });

  it('should create nested directories when writing', async () => {
    await vault.writer.writeFile('config/nested/deep/file.md', 'content');

    const exists = await vault.reader.exists('config/nested/deep/file.md');
    expect(exists).toBe(true);
  });

  it('should delete file', async () => {
    await vault.writer.writeFile('config/todelete.md', 'content');
    expect(await vault.reader.exists('config/todelete.md')).toBe(true);

    await vault.writer.deleteFile('config/todelete.md');
    expect(await vault.reader.exists('config/todelete.md')).toBe(false);
  });
});

describe('Config Schema', () => {
  let tempDir: string;
  let vault: VaultManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qbot-test-'));
    vault = new VaultManager(tempDir);
    await vault.init();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should parse and serialize complex config', async () => {
    interface ComplexConfig {
      apiKey: string;
      enabled: boolean;
      models: string[];
      settings: {
        temperature: number;
        maxTokens: number;
      };
    }

    const configData: ComplexConfig = {
      apiKey: 'sk-test-123',
      enabled: true,
      models: ['gpt-4', 'gpt-3.5-turbo'],
      settings: {
        temperature: 0.7,
        maxTokens: 2000
      }
    };

    await vault.writer.writeConfig('config/complex.md', configData);
    const readData = await vault.reader.readConfig<ComplexConfig>('config/complex.md');

    expect(readData).toEqual(configData);
  });

  it('should preserve markdown content after frontmatter', async () => {
    interface NoteConfig {
      title: string;
      tags: string[];
    }

    const configData: NoteConfig = {
      title: 'My Note',
      tags: ['test', 'example']
    };

    const markdownContent = '\n# Heading\n\nThis is the note content.';

    await vault.writer.writeConfig('config/note.md', configData, markdownContent);
    const raw = await vault.reader.readFile('config/note.md');

    expect(raw).toContain('# Heading');
    expect(raw).toContain('This is the note content.');
  });
});
