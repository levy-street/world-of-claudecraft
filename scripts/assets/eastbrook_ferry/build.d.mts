export interface FerryAssetSpec {
  source: string;
  target: string;
  inputs: readonly string[];
  requiredNodes: readonly string[];
  materials: readonly string[];
  clip: string;
}
export const FERRY_ASSET: FerryAssetSpec;
export function sourceFingerprint(asset?: FerryAssetSpec, root?: string): string;
export function buildFerry(asset?: FerryAssetSpec, root?: string): Promise<Uint8Array>;
