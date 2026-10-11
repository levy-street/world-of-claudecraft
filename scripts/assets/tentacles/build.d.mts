export interface TentacleAsset {
  source: string;
  target: string;
  nodes: string[];
  materials: string[];
}
export const ASSETS: TentacleAsset[];
export function sourceFingerprint(asset: TentacleAsset, root?: string): string;
export function buildAsset(asset: TentacleAsset, root?: string): Promise<Uint8Array>;
