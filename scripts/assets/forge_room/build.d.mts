export interface ForgeKitAsset {
  source: string;
  target: string;
  nodes: string[];
  materials: string[];
}
export const ASSETS: ForgeKitAsset[];
export function sourceFingerprint(asset: ForgeKitAsset, root?: string): string;
export function buildAsset(asset: ForgeKitAsset, root?: string): Promise<Uint8Array>;
