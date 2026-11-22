export type ImportError = {
  code: string;
  message: string;
  path?: string;
};

export type VersionCheck = "unavailable";

export type DryRunResponse = {
  state: "validated" | "rejected";
  errors: ImportError[];
  botSlug: string | null;
  cardKey: string | null;
  contentVersion: number | null;
  expectedPreviousVersion: number | null;
  contentDigest: string | null;
  manifestDigest: string | null;
  sample: boolean | null;
  commitAllowed: false;
  publishAllowed: false;
  visibility: "hidden";
  notification: "not-authorized";
  implemented: {
    dryRun: true;
    stage: false;
    commit: false;
    publish: false;
  };
  versionCheck: VersionCheck;
};

/**
 * Read-only lookup of bots this owner may use.
 * There is no committed-version table in this slice, so callers do not ask for one.
 */
export type OwnerCatalog = {
  botAllowed(ownerId: string, slug: string): Promise<boolean>;
};

export const IMPLEMENTED = {
  dryRun: true,
  stage: false,
  commit: false,
  publish: false,
} as const;

export function emptyDryRun(errors: ImportError[]): DryRunResponse {
  return {
    state: errors.length === 0 ? "validated" : "rejected",
    errors,
    botSlug: null,
    cardKey: null,
    contentVersion: null,
    expectedPreviousVersion: null,
    contentDigest: null,
    manifestDigest: null,
    sample: null,
    commitAllowed: false,
    publishAllowed: false,
    visibility: "hidden",
    notification: "not-authorized",
    implemented: IMPLEMENTED,
    versionCheck: "unavailable",
  };
}
