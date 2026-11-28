/** Card-package v1.0 limits from docs/CARD-PACKAGE.md. */
export const PACKAGE_LIMITS = {
  zipBytes: 8 * 1024 * 1024,
  totalBytes: 32 * 1024 * 1024,
  fileBytes: 8 * 1024 * 1024,
  fileCount: 32,
  /** Up to 32 package files plus manifest.json itself. */
  zipEntries: 33,
  ratio: 100,
  path: 128,
  elements: 2000,
  idempotencyKeyMin: 8,
  idempotencyKeyMax: 200,
} as const;

export const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const ZIP_LOCAL_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
export const ZIP_EMPTY_MAGIC = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
