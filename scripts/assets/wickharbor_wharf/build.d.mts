export interface WickharborWharfAssetSpec {
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
export const WICKHARBOR_WHARF_ASSET: WickharborWharfAssetSpec;
export function sourceFingerprint(asset?: WickharborWharfAssetSpec, root?: string): string;
export function buildWickharborWharf(
  asset?: WickharborWharfAssetSpec,
  root?: string,
): Promise<Uint8Array>;
