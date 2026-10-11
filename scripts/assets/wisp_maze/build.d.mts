export interface WispMazeKitAsset {
  source: string;
  target: string;
  nodes: string[];
  materials: string[];
}
export const PIECES: string[];
export const ASSET: WispMazeKitAsset;
export function sourceFingerprint(asset?: WispMazeKitAsset, root?: string): string;
export function buildAsset(asset?: WispMazeKitAsset, root?: string): Promise<Uint8Array>;
