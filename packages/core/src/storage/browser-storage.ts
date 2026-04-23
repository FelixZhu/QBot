// packages/core/src/storage/browser-storage.ts
import type { FileStorage, FileMeta } from './types.js';

const DB_NAME = 'qbot-storage';
const DB_VERSION = 1;
const STORE_NAME = 'files';

interface StoredFile {
  path: string;
  content: string;
  mtime: number;
  size: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'path' });
      }
    };
  });
}

export class BrowserStorage implements FileStorage {
  async isAvailable(): Promise<boolean> {
    try {
      const db = await openDB();
      db.close();
      return true;
    } catch {
      return false;
    }
  }

  async readFile(filePath: string): Promise<string> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(filePath);
      request.onsuccess = () => {
        const result = request.result as StoredFile | undefined;
        db.close();
        if (result) {
          resolve(result.content);
        } else {
          reject(new Error(`File not found: ${filePath}`));
        }
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const data: StoredFile = {
        path: filePath,
        content,
        mtime: Date.now(),
        size: new Blob([content]).size,
      };
      const request = store.put(data);
      request.onsuccess = () => {
        db.close();
        resolve();
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  }

  async deleteFile(filePath: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(filePath);
      request.onsuccess = () => {
        db.close();
        resolve();
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  }

  async listFiles(pattern: string): Promise<string[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        db.close();
        const files = request.result as StoredFile[];
        // Simple glob-like matching: convert * to regex
        const regex = new RegExp('^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
        resolve(files.map((f) => f.path).filter((p) => regex.test(p)));
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  }

  async getMeta(filePath: string): Promise<FileMeta | null> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(filePath);
      request.onsuccess = () => {
        db.close();
        const result = request.result as StoredFile | undefined;
        if (result) {
          resolve({
            path: result.path,
            mtime: result.mtime,
            size: result.size,
          });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  }
}
