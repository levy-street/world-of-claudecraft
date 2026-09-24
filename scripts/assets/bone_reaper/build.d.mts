export interface BoneReaperAsset {
  source: string;
  target: string;
  nodes: string[];
  materials: string[];
}
export const ASSETS: BoneReaperAsset[];
export function sourceFingerprint(asset: BoneReaperAsset, root?: string): string;
export function buildAsset(asset: BoneReaperAsset, root?: string): Promise<Uint8Array>;
