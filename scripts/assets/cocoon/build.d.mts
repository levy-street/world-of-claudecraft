export interface CocoonAsset {
  source: string;
  target: string;
  nodes: string[];
  materials: string[];
}
export const ASSETS: CocoonAsset[];
export function sourceFingerprint(asset: CocoonAsset, root?: string): string;
export function buildAsset(asset: CocoonAsset, root?: string): Promise<Uint8Array>;
