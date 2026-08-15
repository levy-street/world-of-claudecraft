export interface FenbridgeTownSocketContract {
  readonly id: string;
  readonly name: string;
  readonly position: readonly [number, number, number];
  readonly purpose: string;
  readonly positionSpace?: 'draft';
}

export interface FenbridgeTownAssetContract {
  readonly id: string;
  readonly rootName: string;
  readonly outputName: string;
  readonly outputDirectory: string;
  readonly referenceName: string;
  readonly dimensions: Readonly<{ width: number; height: number; depth: number }>;
  readonly triangleTarget: number;
  readonly triangleCeiling: number;
  readonly byteTarget: number;
  readonly byteCeiling: number;
  readonly placementCount: number;
  readonly placementCeiling: number;
  readonly serviceCues: readonly string[];
  readonly sockets: readonly FenbridgeTownSocketContract[];
  readonly interactionMode?: string;
  readonly colliderIntent?: string;
  readonly build: (buckets: unknown) => void;
}

export const FENBRIDGE_TOWN_WAVE_CEILINGS: Readonly<{
  uniqueTriangles: number;
  placementWeightedTriangles: number;
  glbBytes: number;
  supportTextureBytes: number;
  totalMediaBytes: number;
}>;
export const FENBRIDGE_TOWN_ASSET_IDS: readonly string[];
export const FENBRIDGE_TOWN_CONTRACTS: Readonly<Record<string, FenbridgeTownAssetContract>>;
export function createFenbridgeTownAsset(assetId: string): unknown;
