export interface FerryAssetSpec {
  source: string;
  target: string;
  inputs: readonly string[];
  requiredNodes: readonly string[];
  materials: readonly string[];
  /** The painted base-colour map each textured material wears, by material name. */
  maps: Readonly<Record<string, string>>;
  maxMapSize: number;
  mapSizes: Readonly<Record<string, number>>;
  clip: string;
}
export const FERRY_ASSET: FerryAssetSpec;
export function sourceFingerprint(asset?: FerryAssetSpec, root?: string): string;
export function buildFerry(asset?: FerryAssetSpec, root?: string): Promise<Uint8Array>;
