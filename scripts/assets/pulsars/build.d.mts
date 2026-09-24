export interface PulsarAsset {
  source: string;
  target: string;
  nodes: string[];
  materials: string[];
}
export const ASSETS: PulsarAsset[];
export function sourceFingerprint(asset: PulsarAsset, root?: string): string;
export function buildAsset(asset: PulsarAsset, root?: string): Promise<Uint8Array>;
