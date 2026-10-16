export interface HighwatchManorTextureTier {
  suffix: string;
  color: number;
  normal: number;
}
export type HighwatchManorTier = 'full' | 'half' | 'quarter';
export interface HighwatchManorAssetSpec {
  source: string;
  target: string;
  collision: string;
  collisionId: string;
  tiers: Record<HighwatchManorTier, HighwatchManorTextureTier>;
  inputs: readonly string[];
  requiredNodes: readonly string[];
  materials: readonly string[];
  painted: readonly string[];
}
export const HIGHWATCH_MANOR_ASSET: HighwatchManorAssetSpec;
export const UV_STEPS_PER_REPEAT: number;
export const VERTEX_COLOUR_SCALE: number;
export function tierTarget(tier: HighwatchManorTier, asset?: HighwatchManorAssetSpec): string;
export function sourceFingerprint(asset?: HighwatchManorAssetSpec, root?: string): string;
export function buildHighwatchManor(
  tier?: HighwatchManorTier,
  asset?: HighwatchManorAssetSpec,
  root?: string,
): Promise<Uint8Array>;
export function mergeManorCollision(raw: string, rows: unknown, id?: string): string;
