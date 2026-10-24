export interface DrownedTempleEntranceAsset {
  source: string;
  target: string;
  root: string;
  pieces: string[];
  materials: string[];
}
export const DROWNED_TEMPLE_ENTRANCE_ASSETS: DrownedTempleEntranceAsset[];
export function sourceFingerprint(root?: string): string;
export function buildAsset(asset: DrownedTempleEntranceAsset, root?: string): Promise<Uint8Array>;
