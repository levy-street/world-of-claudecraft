export interface WyrmwatchHarborAssetSpec {
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
export const WYRMWATCH_HARBOR_ASSET: WyrmwatchHarborAssetSpec;
export function sourceFingerprint(asset?: WyrmwatchHarborAssetSpec, root?: string): string;
export function buildWyrmwatchHarbor(
  asset?: WyrmwatchHarborAssetSpec,
  root?: string,
): Promise<Uint8Array>;
