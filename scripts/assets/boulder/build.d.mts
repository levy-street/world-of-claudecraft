export interface BoulderAsset {
  source: string;
  target: string;
  nodes: string[];
  materials: string[];
}
export const ASSETS: BoulderAsset[];
export function sourceFingerprint(asset: BoulderAsset, root?: string): string;
export function buildAsset(asset: BoulderAsset, root?: string): Promise<Uint8Array>;
