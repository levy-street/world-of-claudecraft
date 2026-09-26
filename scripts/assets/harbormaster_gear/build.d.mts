export interface HarbormasterGearAssetSpec {
  source: string;
  target: string;
  bone: string;
  root: string;
  parts: readonly string[];
  materials: readonly string[];
  inputs: readonly string[];
}
export const HARBORMASTER_GEAR_ASSETS: readonly HarbormasterGearAssetSpec[];
export function sourceFingerprint(asset: HarbormasterGearAssetSpec, root?: string): string;
export function buildHarbormasterGear(
  asset: HarbormasterGearAssetSpec,
  root?: string,
): Promise<Uint8Array>;
