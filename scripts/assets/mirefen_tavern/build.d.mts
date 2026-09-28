export interface MirefenTavernAssetSpec {
  source: string;
  target: string;
  inputs: readonly string[];
  requiredNodes: readonly string[];
  materials: readonly string[];
}
export const MIREFEN_TAVERN_ASSET: MirefenTavernAssetSpec;
export function sourceFingerprint(asset?: MirefenTavernAssetSpec, root?: string): string;
export function buildMirefenTavern(
  asset?: MirefenTavernAssetSpec,
  root?: string,
): Promise<Uint8Array>;
