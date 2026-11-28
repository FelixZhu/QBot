export type ImportState =
  | "queued"
  | "validating"
  | "staged"
  | "ready"
  | "rejected"
  | "published"
  | "rolled-back";

export type ImportError = {
  code: string;
  message: string;
  path?: string;
};

export type CardImportStatus = {
  importId: string;
  state: ImportState;
  ownerBound: true;
  botSlug: string | null;
  cardKey: string | null;
  contentVersion: number | null;
  manifestDigest: string | null;
  contentDigest: string | null;
  sample: boolean | null;
  publishAllowed: boolean;
  visibility: "hidden" | "public";
  notification: "not-authorized";
  cardId: string | null;
  reason?: string;
  errors?: ImportError[];
};

export type PackageIdentity = {
  agentId: string | null;
  botSlug: string | null;
  cardKey: string | null;
  contentVersion: number | null;
  expectedPreviousVersion: number | null;
  manifestDigest: string | null;
  contentDigest: string | null;
  sample: boolean | null;
  authoringClaim: "human" | "bot" | null;
  cardTitle: string | null;
  cardAuthoredAt: string | null;
  visibilityMode: "manual" | "schedule" | null;
  visibleFrom: string | null;
  visibleUntil: string | null;
};

export type ValidatedPackageFile = {
  path: string;
  role: "cover" | "page" | "asset";
  sha256: string;
  byteLength: number;
  contentType: string;
  bytes: Buffer;
};

export type ValidatedPackage = {
  agentId: string;
  botSlug: string;
  cardKey: string;
  contentVersion: number;
  expectedPreviousVersion: number | null;
  manifestDigest: string;
  contentDigest: string;
  sample: boolean;
  authoringClaim: "human" | "bot";
  cardTitle: string;
  cardAuthoredAt: string;
  visibilityMode: "manual" | "schedule";
  visibleFrom: string;
  visibleUntil: string;
  files: ValidatedPackageFile[];
};

export type ClaimedImportJob = {
  id: string;
  ownerId: string;
  idempotencyKey: string;
  zipSha256: string;
  zipBytes: number;
};
