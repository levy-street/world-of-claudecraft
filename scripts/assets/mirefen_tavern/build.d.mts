export interface MirefenTavernTextureTier {
  suffix: string;
  color: number;
  normal: number;
}
export type MirefenTavernTier = 'full' | 'half' | 'quarter';
export interface MirefenTavernAssetSpec {
  source: string;
  target: string;
  tiers: Record<MirefenTavernTier, MirefenTavernTextureTier>;
  inputs: readonly string[];
  requiredNodes: readonly string[];
  materials: readonly string[];
  painted: readonly string[];
}
export const MIREFEN_TAVERN_ASSET: MirefenTavernAssetSpec;
export const UV_STEPS_PER_REPEAT: number;
export const VERTEX_COLOUR_SCALE: number;
export function tierTarget(tier: MirefenTavernTier, asset?: MirefenTavernAssetSpec): string;
export function sourceFingerprint(asset?: MirefenTavernAssetSpec, root?: string): string;
export function buildMirefenTavern(
  tier?: MirefenTavernTier,
  asset?: MirefenTavernAssetSpec,
  root?: string,
): Promise<Uint8Array>;
