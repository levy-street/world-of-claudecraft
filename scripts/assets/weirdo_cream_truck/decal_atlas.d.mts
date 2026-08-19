export interface DecalRegion {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

export const DECAL_ATLAS_SIZE: number;
export const DECAL_REGIONS: Readonly<{
  banner: DecalRegion;
  portrait: DecalRegion;
  badge: DecalRegion;
}>;

export interface DecalAtlas {
  readonly size: number;
  readonly pixels: Uint8Array;
  readonly webp: Buffer;
}

export function buildDecalAtlas(size?: number): Promise<DecalAtlas>;
