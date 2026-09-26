export interface WyrmwatchHarborAssetSpec {
  source: string;
  target: string;
  inputs: readonly string[];
  requiredNodes: readonly string[];
  materials: readonly string[];
}
export const WYRMWATCH_HARBOR_ASSET: WyrmwatchHarborAssetSpec;
export function sourceFingerprint(asset?: WyrmwatchHarborAssetSpec, root?: string): string;
export function buildWyrmwatchHarbor(
  asset?: WyrmwatchHarborAssetSpec,
  root?: string,
): Promise<Uint8Array>;
