export const FENBRIDGE_SUPPORT_MAP_SIZE: number;
export const FENBRIDGE_SUPPORT_MAP_GRID: number;
export const FENBRIDGE_SUPPORT_MAP_SOURCE_FILES: readonly string[];

export function fenbridgeSupportMapFingerprint(repoRoot: string): string;
export function buildFenbridgeSupportMaps(): Promise<{
  base: Buffer;
  normal: Buffer;
  roughness: Buffer;
}>;
