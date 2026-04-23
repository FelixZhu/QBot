// packages/web/app/api/sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import {
  NodeStorage,
  OSSStorage,
  createOSSClient,
  syncStorage,
} from '@qbot/core';
import path from 'path';
import os from 'os';

export async function POST(req: NextRequest) {
  try {
    // Check if OSS is configured
    const ossClient = createOSSClient();
    if (!ossClient) {
      return NextResponse.json(
        { error: 'OSS not configured. Set OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET.' },
        { status: 400 }
      );
    }

    const userId = req.headers.get('x-user-id') || 'default-user';

    // Local storage
    const baseDir = path.join(os.homedir(), '.qbot');
    const local = new NodeStorage({ baseDir });

    // Remote storage (OSS with user prefix)
    const remote = new OSSStorage({ client: ossClient, prefix: `users/${userId}` });

    // Check availability
    const [localAvailable, remoteAvailable] = await Promise.all([
      local.isAvailable(),
      remote.isAvailable(),
    ]);

    if (!localAvailable) {
      return NextResponse.json(
        { error: 'Local storage not available' },
        { status: 500 }
      );
    }

    if (!remoteAvailable) {
      return NextResponse.json(
        { error: 'Remote storage (OSS) not available' },
        { status: 500 }
      );
    }

    // Perform sync
    const result = await syncStorage(local, remote, {
      patterns: ['**/*.md'],
      conflictResolution: 'newer',
      onProgress: (action, filePath) => {
        console.log(`[Sync] ${action}: ${filePath}`);
      },
    });

    return NextResponse.json({
      success: true,
      uploaded: result.uploaded.length,
      downloaded: result.downloaded.length,
      conflicts: result.conflicts.length,
      deleted: result.deleted.length,
      details: result,
    });
  } catch (error: any) {
    console.error('Sync error:', error);
    return NextResponse.json(
      { error: error.message || 'Sync failed' },
      { status: 500 }
    );
  }
}

// GET /api/sync - Check sync status
export async function GET() {
  const ossClient = createOSSClient();
  return NextResponse.json({
    configured: !!ossClient,
    lastSync: null, // Could be stored in a local state file
  });
}
