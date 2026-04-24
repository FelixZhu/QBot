// packages/core/src/storage/node-storage.ts
import { promises as fs } from 'fs';
import path from 'path';
import { glob } from 'glob';
import type { FileStorage, FileMeta } from './types.js';

export interface NodeStorageOptions {
  baseDir: string;
}

export class NodeStorage implements FileStorage {
  private baseDir: string;

  constructor(options: NodeStorageOptions) {
    this.baseDir = options.baseDir;
  }

  private resolve(filePath: string): string {
    // Prevent directory traversal
    const resolved = path.resolve(this.baseDir, filePath);
    if (!resolved.startsWith(path.resolve(this.baseDir))) {
      throw new Error('Invalid path: directory traversal detected');
    }
    return resolved;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await fs.access(this.baseDir);
      return true;
    } catch {
      try {
        await fs.mkdir(this.baseDir, { recursive: true });
        return true;
      } catch {
        return false;
      }
    }
  }

  async readFile(filePath: string): Promise<string> {
    const fullPath = this.resolve(filePath);
    return fs.readFile(fullPath, 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const fullPath = this.resolve(filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  async deleteFile(filePath: string): Promise<void> {
    const fullPath = this.resolve(filePath);
    await fs.unlink(fullPath);
  }

  async listFiles(pattern: string): Promise<string[]> {
    const fullPattern = this.resolve(pattern);
    // glob v13 returns Promise<string[]>
    const files = await glob(fullPattern, { cwd: this.baseDir });
    // Ensure we return relative paths
    return files.map((f: string) => f.replace(this.baseDir + '/', '').replace(this.baseDir, ''));
  }

  async getMeta(filePath: string): Promise<FileMeta | null> {
    try {
      const fullPath = this.resolve(filePath);
      const stat = await fs.stat(fullPath);
      return {
        path: filePath,
        mtime: stat.mtime.getTime(),
        size: stat.size,
      };
    } catch {
      return null;
    }
  }
}
