export interface WildheartBasinEntranceAsset {
  source: string;
  target: string;
  root: string;
  pieces: string[];
  materials: string[];
}
export const WILDHEART_BASIN_ENTRANCE_ASSETS: WildheartBasinEntranceAsset[];
export function sourceFingerprint(root?: string): string;
export function buildAsset(asset: WildheartBasinEntranceAsset, root?: string): Promise<Uint8Array>;
