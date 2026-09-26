export interface WickharborHarborAssetSpec {
  source: string;
  target: string;
  inputs: readonly string[];
  requiredNodes: readonly string[];
  materials: readonly string[];
}
export const WICKHARBOR_HARBOR_ASSET: WickharborHarborAssetSpec;
export function sourceFingerprint(asset?: WickharborHarborAssetSpec, root?: string): string;
export function buildWickharborHarbor(
  asset?: WickharborHarborAssetSpec,
  root?: string,
): Promise<Uint8Array>;
