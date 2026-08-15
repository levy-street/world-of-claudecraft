export const EASTBROOK_SURFACE_ATLAS_REPO_ROOT: string;
export const EASTBROOK_SURFACE_ATLAS_SOURCE_FILES: readonly string[];

export interface EastbrookSurfaceAtlasCellStats {
  index: number;
  row: number;
  column: number;
  sourceLowLuminance: number;
  sourceHighLuminance: number;
}

export interface EastbrookSurfaceAtlasBuild {
  atlas: Buffer;
  preview: Buffer;
  cellStats: EastbrookSurfaceAtlasCellStats[];
}

export function eastbrookSurfaceAtlasFingerprint(repoRoot?: string): string;
export function buildEastbrookSurfaceAtlas(
  sourceBytes: Uint8Array,
): Promise<EastbrookSurfaceAtlasBuild>;
