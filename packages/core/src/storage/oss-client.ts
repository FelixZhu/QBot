// packages/core/src/storage/oss-client.ts
import OSS from 'ali-oss';

export interface OSSConfig {
  region: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  endpoint?: string;
  secure?: boolean;
}

export function createOSSClient(config?: OSSConfig): OSS | null {
  const region = config?.region || process.env.OSS_REGION;
  const bucket = config?.bucket || process.env.OSS_BUCKET;
  const accessKeyId = config?.accessKeyId || process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = config?.accessKeySecret || process.env.OSS_ACCESS_KEY_SECRET;
  const endpoint = config?.endpoint || process.env.OSS_ENDPOINT;

  if (!region || !bucket || !accessKeyId || !accessKeySecret) {
    return null;
  }

  const clientConfig: OSS.Options = {
    region,
    bucket,
    accessKeyId,
    accessKeySecret,
    secure: config?.secure ?? process.env.OSS_SECURE !== 'false',
  };

  if (endpoint) {
    clientConfig.endpoint = endpoint;
  }

  return new OSS(clientConfig);
}

export function getOSSClient(): OSS {
  const client = createOSSClient();
  if (!client) {
    throw new Error(
      'OSS not configured. Please set OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET environment variables.'
    );
  }
  return client;
}
