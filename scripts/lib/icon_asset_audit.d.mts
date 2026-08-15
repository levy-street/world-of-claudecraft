export type IconAssetKind = 'ability' | 'item' | 'deed';
export type IconAlphaContract = 'opaque' | 'transparent-subject' | 'has-alpha' | 'any';

export interface IconGeometryContract {
  alphaThreshold?: number;
  minPadding?: number;
  maxCenterOffset?: number;
  coverageMin?: number;
  coverageMax?: number;
  alphaBounds?: [number, number, number, number];
  bounds?: [number, number, number, number];
  visiblePixels?: number;
}

export interface IconKindContract {
  width: number;
  height: number;
  maxBytes: number;
  alpha: IconAlphaContract | { mode: IconAlphaContract };
  geometry?: IconGeometryContract;
}

export interface AcceptedIconAsset {
  kind: IconAssetKind;
  id: string;
  runtimeUrl: string;
  source?: {
    path: string;
    [key: string]: unknown;
  };
  acceptedSha256?: string;
  acceptedBytes?: number;
  class?: string;
  abilityClass?: string;
  family?: string;
  itemFamily?: string;
  zone?: string;
  itemZone?: string;
  batch?: string;
  batchId?: string;
  deedBatch?: string;
  metadata?: Record<string, unknown>;
  group?: Record<string, unknown>;
  width?: number;
  height?: number;
  maxBytes?: number;
  alpha?: IconKindContract['alpha'];
  geometry?: IconGeometryContract;
  accepted?: {
    sha256?: string;
    bytes?: number;
    width?: number;
    height?: number;
    maxBytes?: number;
    alpha?: IconKindContract['alpha'];
    geometry?: IconGeometryContract;
  };
  expected?: {
    width?: number;
    height?: number;
    maxBytes?: number;
    alpha?: IconKindContract['alpha'];
    geometry?: IconGeometryContract;
  };
}

export interface AcceptedArtManifest {
  schemaVersion: 1;
  batch?: { id: string; [key: string]: unknown };
  contracts: Record<IconAssetKind, IconKindContract>;
  assets: AcceptedIconAsset[];
  [key: string]: unknown;
}

export interface AlphaMeasurement {
  min: number;
  max: number;
  transparentPixels: number;
  translucentPixels: number;
  opaquePixels: number;
  visiblePixels: number;
  coverage: number;
  threshold: number;
  bounds: [number, number, number, number] | null;
  padding: [number, number, number, number] | null;
  centerOffset: [number, number] | null;
}

export interface IconAuditAsset {
  kind: IconAssetKind;
  id: string;
  group: string;
  runtimeUrl: string;
  sourcePath: string;
  width: number | null;
  height: number | null;
  format: string | null;
  colourspace: string | null;
  bytes: number | null;
  sha256: string | null;
  acceptedBytes: number;
  acceptedSha256: string;
  expected: {
    width: number;
    height: number;
    maxBytes: number;
    alpha: IconAlphaContract;
    geometry: IconGeometryContract;
  };
  hasAlpha: boolean | null;
  alphaMode: 'opaque' | 'transparent-subject' | 'translucent' | null;
  alpha: AlphaMeasurement | null;
  perceptualHash: string | null;
  issues: string[];
}

export interface ExactDuplicateGroup {
  sha256: string;
  assetKeys: string[];
}

export interface PerceptualCandidate {
  left: string;
  right: string;
  hammingDistance: number;
  meanAbsoluteDifference: number;
  structuralSimilarity: number;
  luminanceSimilarity: number;
  edgeSimilarity: number;
  cropFraction: number;
  cropDirection: 'none' | 'left-cropped' | 'right-cropped';
}

export interface ContactSheetRecord {
  path: string;
  kind: IconAssetKind;
  group: string;
  size: number;
  grayscale: boolean;
  page: number;
  pageCount: number;
  assetKeys: string[];
}

export interface IconAssetAuditReport {
  schemaVersion: 1;
  summary: {
    ok: boolean;
    assetCount: number;
    issueCount: number;
    exactDuplicateGroupCount: number;
    perceptualCandidateCount: number;
    contactSheetCount: number;
  };
  assets: IconAuditAsset[];
  exactDuplicates: ExactDuplicateGroup[];
  perceptualCandidates: PerceptualCandidate[];
  contactSheets: ContactSheetRecord[];
}

export declare const ICON_AUDIT_LIMITS: Readonly<{
  maxAssets: number;
  maxSourceBytes: number;
  maxDecodedPixels: number;
  maxContactSheets: number;
  maxSheetPixels: number;
  perceptualHashSize: number;
  perceptualStructureSize: number;
  perceptualCropFractions: readonly number[];
  perceptualLuminanceWeight: number;
  perceptualEdgeWeight: number;
  perceptualMinStructuralSimilarity: number;
}>;

export declare function validateAcceptedArtManifest(value: unknown): AcceptedArtManifest;
export declare function groupManifestAssets(value: unknown): Array<{
  kind: IconAssetKind;
  group: string;
  assets: AcceptedIconAsset[];
}>;
export declare function measureAlpha(
  alphaBytes: Uint8Array,
  width: number,
  height: number,
  threshold?: number,
): AlphaMeasurement;
export declare function perceptualDistance(
  left: {
    hash: string;
    rgb: Uint8Array;
    variants: Array<{
      cropFraction: number;
      luminance: Float32Array;
      edgeMagnitude: Float32Array;
    }>;
  },
  right: {
    hash: string;
    rgb: Uint8Array;
    variants: Array<{
      cropFraction: number;
      luminance: Float32Array;
      edgeMagnitude: Float32Array;
    }>;
  },
): {
  hammingDistance: number;
  meanAbsoluteDifference: number;
  structuralSimilarity: number;
  luminanceSimilarity: number;
  edgeSimilarity: number;
  cropFraction: number;
  cropDirection: 'none' | 'left-cropped' | 'right-cropped';
};
export declare function findExactDuplicates(
  records: ReadonlyArray<Pick<IconAuditAsset, 'kind' | 'id' | 'sha256'>>,
): ExactDuplicateGroup[];
export declare function auditIconAssets(options: {
  manifest: unknown;
  repoRoot: string;
}): Promise<IconAssetAuditReport>;
export declare function renderIconContactSheets(options: {
  manifest: unknown;
  repoRoot: string;
  outputDir: string;
}): Promise<ContactSheetRecord[]>;
export declare function runIconAssetAudit(options: {
  manifestPath: string;
  outputDir: string;
  repoRoot?: string;
  sheets?: boolean;
}): Promise<IconAssetAuditReport>;
