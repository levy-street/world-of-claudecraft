export interface ForgeHammerAsset {
  source: string;
  target: string;
  nodes: string[];
  materials: string[];
}
export const ASSETS: ForgeHammerAsset[];
export function sourceFingerprint(asset: ForgeHammerAsset, root?: string): string;
export function buildAsset(asset: ForgeHammerAsset, root?: string): Promise<Uint8Array>;
