// packages/core/src/storage/types.ts

export interface FileMeta {
  path: string;
  mtime: number;
  size: number;
}

export interface FileStorage {
  /** Read file content */
  readFile(path: string): Promise<string>;

  /** Write file content */
  writeFile(path: string, content: string): Promise<void>;

  /** Delete file */
  deleteFile(path: string): Promise<void>;

  /** List files matching pattern */
  listFiles(pattern: string): Promise<string[]>;

  /** Get file metadata */
  getMeta(path: string): Promise<FileMeta | null>;

  /** Check if storage is available */
  isAvailable(): Promise<boolean>;
}

export interface SyncResult {
  uploaded: string[];
  downloaded: string[];
  conflicts: string[];
  deleted: string[];
}
