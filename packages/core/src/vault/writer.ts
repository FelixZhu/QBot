import * as fs from 'fs/promises';
import * as path from 'path';
import { serializeMarkdownConfig } from './schema/config.js';

export class VaultWriter {
  constructor(private vaultPath: string) {}

  /** Write/update a config file */
  async writeConfig<T>(filePath: string, data: T, content: string = ''): Promise<void> {
    const fullPath = path.join(this.vaultPath, filePath);
    const serialized = serializeMarkdownConfig(data, content);

    // Ensure directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, serialized, 'utf-8');
  }

  /** Write raw content to file */
  async writeFile(filePath: string, content: string): Promise<void> {
    const fullPath = path.join(this.vaultPath, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  /** Delete a file */
  async deleteFile(filePath: string): Promise<void> {
    const fullPath = path.join(this.vaultPath, filePath);
    await fs.unlink(fullPath);
  }
}
