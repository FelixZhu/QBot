// packages/core/src/storage/sync.ts
import type { FileStorage } from './types.js';

export interface SyncResult {
  uploaded: string[];
  downloaded: string[];
  conflicts: string[];
  deleted: string[];
}

export interface SyncOptions {
  patterns?: string[];
  conflictResolution?: 'local' | 'remote' | 'newer';
  deleteOrphans?: boolean;
  onProgress?: (action: string, path: string) => void;
}

/**
 * Bidirectional sync between two FileStorage instances.
 * Local is considered the primary source of truth for conflicts.
 */
export async function syncStorage(
  local: FileStorage,
  remote: FileStorage,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const {
    patterns = ['**/*.md'],
    conflictResolution = 'newer',
    deleteOrphans = false,
    onProgress,
  } = options;

  const result: SyncResult = {
    uploaded: [],
    downloaded: [],
    conflicts: [],
    deleted: [],
  };

  // Collect all files from both sides
  const localFiles = new Map<string, { mtime: number; size: number }>();
  const remoteFiles = new Map<string, { mtime: number; size: number }>();

  for (const pattern of patterns) {
    const localList = await local.listFiles(pattern);
    for (const path of localList) {
      const meta = await local.getMeta(path);
      if (meta) localFiles.set(path, { mtime: meta.mtime, size: meta.size });
    }

    const remoteList = await remote.listFiles(pattern);
    for (const path of remoteList) {
      const meta = await remote.getMeta(path);
      if (meta) remoteFiles.set(path, { mtime: meta.mtime, size: meta.size });
    }
  }

  // Determine actions
  const allPaths = new Set([...localFiles.keys(), ...remoteFiles.keys()]);

  for (const path of allPaths) {
    const localMeta = localFiles.get(path);
    const remoteMeta = remoteFiles.get(path);

    if (localMeta && !remoteMeta) {
      // File exists only locally → upload
      const content = await local.readFile(path);
      await remote.writeFile(path, content);
      result.uploaded.push(path);
      onProgress?.('upload', path);
    } else if (!localMeta && remoteMeta) {
      // File exists only remotely → download (or delete if deleteOrphans)
      if (deleteOrphans) {
        await remote.deleteFile(path);
        result.deleted.push(path);
        onProgress?.('delete-remote', path);
      } else {
        const content = await remote.readFile(path);
        await local.writeFile(path, content);
        result.downloaded.push(path);
        onProgress?.('download', path);
      }
    } else if (localMeta && remoteMeta) {
      // File exists on both sides
      if (localMeta.mtime === remoteMeta.mtime && localMeta.size === remoteMeta.size) {
        // Identical, skip
        continue;
      }

      // Conflict resolution
      let useLocal: boolean;
      if (conflictResolution === 'local') {
        useLocal = true;
      } else if (conflictResolution === 'remote') {
        useLocal = false;
      } else {
        // 'newer' — compare mtime
        useLocal = localMeta.mtime >= remoteMeta.mtime;
      }

      if (useLocal) {
        const content = await local.readFile(path);
        await remote.writeFile(path, content);
        result.uploaded.push(path);
        onProgress?.('upload', path);
      } else {
        const content = await remote.readFile(path);
        await local.writeFile(path, content);
        result.downloaded.push(path);
        onProgress?.('download', path);
      }

      if (localMeta.mtime !== remoteMeta.mtime) {
        result.conflicts.push(path);
      }
    }
  }

  return result;
}
