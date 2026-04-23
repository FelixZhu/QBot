import * as fs from 'fs/promises';
import * as path from 'path';
import { parseMarkdownConfig } from './schema/config.js';

export class VaultReader {
  constructor(private vaultPath: string) {}

  /** Read and parse a config file (api-keys.md, preferences.md) */
  async readConfig<T>(filePath: string): Promise<T | null> {
    try {
      const fullPath = path.join(this.vaultPath, filePath);
      const raw = await fs.readFile(fullPath, 'utf-8');
      const parsed = parseMarkdownConfig<T>(raw);
      return parsed.data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /** Read raw markdown content */
  async readFile(filePath: string): Promise<string | null> {
    try {
      const fullPath = path.join(this.vaultPath, filePath);
      return await fs.readFile(fullPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /** List files in a directory */
  async listFiles(dirPath: string, extension = '.md'): Promise<string[]> {
    const fullPath = path.join(this.vaultPath, dirPath);
    const files = await fs.readdir(fullPath);
    return files.filter(f => f.endsWith(extension));
  }

  /** Check if file exists */
  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.vaultPath, filePath));
      return true;
    } catch {
      return false;
    }
  }
}
