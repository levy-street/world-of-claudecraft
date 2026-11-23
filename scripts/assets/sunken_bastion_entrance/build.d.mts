export interface SunkenBastionEntranceAsset {
  source: string;
  target: string;
  root: string;
  pieces: string[];
  materials: string[];
}
export const SUNKEN_BASTION_ENTRANCE_ASSETS: SunkenBastionEntranceAsset[];
export function sourceFingerprint(root?: string): string;
export function buildAsset(asset: SunkenBastionEntranceAsset, root?: string): Promise<Uint8Array>;
