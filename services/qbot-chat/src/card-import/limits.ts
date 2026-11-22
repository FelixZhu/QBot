/** Card-package v1.0 limits from CARD-PACKAGE.md. Not a live ops config. */
export const PACKAGE_LIMITS = {
  zipBytes: 8 * 1024 * 1024,
  totalBytes: 32 * 1024 * 1024,
  fileBytes: 8 * 1024 * 1024,
  fileCount: 32,
  /** Non-manifest entries, plus the manifest itself. */
  zipEntries: 33,
  ratio: 100,
  path: 128,
  elements: 2000,
} as const;

export const TOKEN_LIMITS = {
  min: 16,
  max: 256,
  ratePerMinute: 60,
} as const;

export const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const PLACEHOLDER_TOKEN = "replace-with-a-long-random-token";
