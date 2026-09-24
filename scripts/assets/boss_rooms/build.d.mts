export interface BossRoomKitAsset {
  source: string;
  target: string;
  nodes: string[];
  materials: string[];
}
export const ASSETS: BossRoomKitAsset[];
export function sourceFingerprint(asset: BossRoomKitAsset, root?: string): string;
export function buildAsset(asset: BossRoomKitAsset, root?: string): Promise<Uint8Array>;
