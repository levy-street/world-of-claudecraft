export type ItemArtAuditMode =
  | '128-color'
  | '40-color'
  | '28-color'
  | '22-color'
  | '28-grayscale'
  | '64-circle'
  | 'small-multiview'
  | 'identity';

export type ItemArtDefinition = {
  name: string;
  kind: string;
  slot?: string;
  quality?: string;
  heroicOf?: string;
};

export type ItemArtAuditRecord = {
  id: string;
  name: string;
  kind: string;
  slot: string | null;
  quality: string | null;
  group: string;
  aliases: string[];
  path: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  format: string;
  colorspace: string;
  channels: number;
  hasAlpha: boolean;
  opaque: boolean;
};

export type ItemArtAuditSheetEvidence = {
  path: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  format: string;
};

export type ItemArtAuditCatalog = {
  schemaVersion: 1;
  generator: {
    script: 'scripts/item_art_audit.mjs';
    contractVersion: 1;
    rendererFingerprint: string;
  };
  catalogCount: number;
  liveItemCount: number;
  generatedHeroicDefinitions: number;
  heroicDefinitionsWithOwnWebp: number;
  heroicWeaponArtAliases: number;
  groups: Record<string, number>;
  sheetPageCount: number;
  sheetModes: ItemArtAuditMode[];
  machineChecks: {
    expectedDimensions: number[];
    expectedFormat: string;
    expectedColorspace: string;
    requiredOpaque: boolean;
    maximumBytes: number;
    invalid: ItemArtAuditRecord[];
    duplicateHashes: Array<{ sha256: string; ids: string[] }>;
    passed: boolean;
  };
  sheetPaths: string[];
  records: ItemArtAuditRecord[];
};

export type ItemArtAuditBuild = {
  catalog: ItemArtAuditCatalog;
  catalogBytes: Buffer;
  catalogPath: string;
  catalogSha256: string;
  rendererFingerprint: string;
  sheetEvidence: ItemArtAuditSheetEvidence[];
  sheetModeCounts: Record<ItemArtAuditMode, number>;
  sheetSetSha256: string | null;
  shippingCatalogSha256: string;
};

export type ItemArtAuditBuildOptions = {
  repoRoot: string;
  itemDirectory?: string;
  outputDirectory: string;
  renderOutputs?: boolean;
  items: Record<string, ItemArtDefinition>;
  mapping: {
    entries?: readonly { itemId?: unknown }[];
    generatedBatches?: readonly { itemIds?: readonly unknown[] }[];
  };
  expected?: Partial<{
    catalogCount: number;
    liveItemCount: number;
    generatedHeroicDefinitions: number;
    heroicDefinitionsWithOwnWebp: number;
    heroicWeaponArtAliases: number;
    sheetPageCount: number;
    groupCount: number;
  }>;
};

export type RefreshableItemArtAuditVerdict = {
  schemaVersion: number;
  generatedAt?: string;
  auditScope: {
    itemArtFilesReviewed: number;
    liveItemDefinitions: number;
    generatedHeroicDefinitions: number;
    heroicDefinitionsWithOwnWebp: number;
    heroicWeaponArtAliases: number;
    groups: Record<string, number>;
  };
  reviewContract: {
    everyShippingFileReviewedInModes: string[];
    [key: string]: unknown;
  };
  machineChecks: unknown;
  visualVerdict: {
    passCount: number;
    passIds: string[];
    [key: string]: unknown;
  };
  resolvedDuringAudit: Array<{
    finalShipping: Array<{ id: string; path: string; sha256: string; bytes: number }>;
    [key: string]: unknown;
  }>;
  evidence: {
    shippingCatalogSha256: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export declare const ITEM_ART_AUDIT_MODES: readonly ItemArtAuditMode[];
export declare const ITEM_ART_AUDIT_REVIEW_MODES: readonly string[];
export declare const ITEM_ART_AUDIT_RENDERER_FINGERPRINT: string;

export declare function buildItemArtAudit(
  options: ItemArtAuditBuildOptions,
): Promise<ItemArtAuditBuild>;

export declare function assertItemArtAuditPass(build: ItemArtAuditBuild): void;

export declare function evaluateItemArtMachineChecks(
  records: Array<ItemArtAuditRecord & { absolutePath?: string }>,
): ItemArtAuditCatalog['machineChecks'];

export declare function paginateItemArtAuditRecords<T>(records: readonly T[]): T[][];

export declare function renderItemArtAuditPreview(
  pathname: string,
  mode: Exclude<ItemArtAuditMode, 'small-multiview' | 'identity'>,
): Promise<{ buffer: Buffer; width: number; height: number }>;

export declare function updateItemArtAuditVerdict<T extends RefreshableItemArtAuditVerdict>(
  source: T,
  build: ItemArtAuditBuild,
): T & {
  reviewContract: T['reviewContract'] & { everyShippingFileReviewedInModes: string[] };
  machineChecks: {
    passed: boolean;
    requiredDimensions: number[];
    requiredFormat: string;
    requiredColorspace: string;
    requiredOpaque: boolean;
    maximumBytes: number;
    invalidIds: string[];
    duplicateHashGroups: Array<{ sha256: string; ids: string[] }>;
  };
  evidence: {
    catalog: { path: string; sha256: string; bytes: number };
    rendererFingerprint: string;
    sheetCount: number;
    sheetModeCounts: Record<ItemArtAuditMode, number>;
    sheetSetSha256: string;
    sheets: ItemArtAuditSheetEvidence[];
    shippingCatalogSha256: string;
  };
};

export declare function writeItemArtAuditVerdict(
  verdictPath: string,
  build: ItemArtAuditBuild,
): Promise<{ verdict: RefreshableItemArtAuditVerdict; bytes: Buffer; sha256: string }>;
