import * as fs from 'fs/promises';
import * as path from 'path';
import { VaultReader } from './reader.js';
import { VaultWriter } from './writer.js';

export class VaultManager {
  readonly reader: VaultReader;
  readonly writer: VaultWriter;

  constructor(private vaultPath: string) {
    this.reader = new VaultReader(vaultPath);
    this.writer = new VaultWriter(vaultPath);
  }

  /** Get the vault root path */
  getPath(): string {
    return this.vaultPath;
  }

  /** Initialize vault directory structure */
  async init(): Promise<void> {
    const dirs = [
      'config',
      'conversations',
      'knowledge',
      'research',
      'templates'
    ];

    for (const dir of dirs) {
      await fs.mkdir(path.join(this.vaultPath, dir), { recursive: true });
    }
  }

  /** Check if vault is initialized */
  async isInitialized(): Promise<boolean> {
    try {
      await fs.access(path.join(this.vaultPath, 'config'));
      return true;
    } catch {
      return false;
    }
  }

  /** Resolve absolute path within vault */
  resolvePath(...segments: string[]): string {
    return path.join(this.vaultPath, ...segments);
  }
}
