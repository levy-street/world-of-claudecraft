export interface HollowCryptEntranceAsset {
  source: string;
  target: string;
  root: string;
  pieces: string[];
  materials: string[];
}
export const HOLLOW_CRYPT_ENTRANCE_ASSETS: HollowCryptEntranceAsset[];
export function sourceFingerprint(root?: string): string;
export function buildAsset(asset: HollowCryptEntranceAsset, root?: string): Promise<Uint8Array>;
