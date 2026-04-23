// packages/core/src/storage/oss-storage.ts
import type OSS from 'ali-oss';
import type { FileStorage, FileMeta } from './types.js';

export interface OSSStorageOptions {
  client: OSS;
  prefix?: string;
}

export class OSSStorage implements FileStorage {
  private client: OSS;
  private prefix: string;

  constructor(options: OSSStorageOptions) {
    this.client = options.client;
    this.prefix = options.prefix || '';
    if (this.prefix && !this.prefix.endsWith('/')) {
      this.prefix += '/';
    }
  }

  private ossKey(filePath: string): string {
    return this.prefix + filePath;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.getBucketInfo('');
      return true;
    } catch {
      return false;
    }
  }

  async readFile(filePath: string): Promise<string> {
    const result = await this.client.get(this.ossKey(filePath));
    return result.content.toString('utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await this.client.put(this.ossKey(filePath), Buffer.from(content, 'utf-8'));
  }

  async deleteFile(filePath: string): Promise<void> {
    await this.client.delete(this.ossKey(filePath));
  }

  async listFiles(pattern: string): Promise<string[]> {
    // Convert glob pattern to OSS prefix
    const prefix = this.prefix + pattern.replace(/\*.*$/, '');
    const result = await this.client.list({ prefix, 'max-keys': 1000 }, {});
    const objects = result.objects || [];

    // Simple glob-like filtering
    const regex = new RegExp('^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
    return objects
      .map((obj) => obj.name.replace(this.prefix, ''))
      .filter((p) => regex.test(p));
  }

  async getMeta(filePath: string): Promise<FileMeta | null> {
    try {
      const result = await this.client.head(this.ossKey(filePath));
      const headers = result.res.headers as Record<string, string>;
      return {
        path: filePath,
        mtime: new Date(headers['last-modified'] || Date.now()).getTime(),
        size: Number(headers['content-length'] || 0),
      };
    } catch (error: any) {
      if (error.code === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  }
}
