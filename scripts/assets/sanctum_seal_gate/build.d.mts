export interface SanctumSealGateAsset {
  source: string;
  target: string;
  root: string;
  pieces: string[];
  materials: string[];
}
export const SANCTUM_SEAL_GATE_ASSETS: SanctumSealGateAsset[];
export function sourceFingerprint(root?: string): string;
export function buildAsset(asset: SanctumSealGateAsset, root?: string): Promise<Uint8Array>;
