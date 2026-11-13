export interface WickharborHarborAssetSpec {
  source: string;
  target: string;
  inputs: readonly string[];
  requiredNodes: readonly string[];
  materials: readonly string[];
  /** The painted base-colour map each textured material wears, by material name. */
  maps: Readonly<Record<string, string>>;
  maxMapSize: number;
  mapSizes: Readonly<Record<string, number>>;
}
export const WICKHARBOR_HARBOR_ASSET: WickharborHarborAssetSpec;
export function sourceFingerprint(asset?: WickharborHarborAssetSpec, root?: string): string;
export function buildWickharborHarbor(
  asset?: WickharborHarborAssetSpec,
  root?: string,
): Promise<Uint8Array>;
