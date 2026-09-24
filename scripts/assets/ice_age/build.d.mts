export interface IceAgeAsset {
  source: string;
  target: string;
  nodes: string[];
  materials: string[];
}
export const ASSETS: IceAgeAsset[];
export function sourceFingerprint(asset: IceAgeAsset, root?: string): string;
export function buildAsset(asset: IceAgeAsset, root?: string): Promise<Uint8Array>;
