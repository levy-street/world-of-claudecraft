export interface WickharborWharfAssetSpec {
  source: string;
  target: string;
  inputs: readonly string[];
  requiredNodes: readonly string[];
  materials: readonly string[];
}
export const WICKHARBOR_WHARF_ASSET: WickharborWharfAssetSpec;
export function sourceFingerprint(asset?: WickharborWharfAssetSpec, root?: string): string;
export function buildWickharborWharf(
  asset?: WickharborWharfAssetSpec,
  root?: string,
): Promise<Uint8Array>;
