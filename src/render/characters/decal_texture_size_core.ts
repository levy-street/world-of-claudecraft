// The side of the procedural face-decal maps (stubble.ts, makeup.ts) per
// memory profile, and the side of a painted map read back from its buffer.
//
// Each distinct stubble selection keeps an uncompressed RGBA map with a full
// mip chain in every WebGL context that draws it (world, portrait, paperdoll),
// plus the painted bytes in the JS heap, and nothing releases them. On an
// iPhone that counts against the WebContent ceiling, and the full size buys
// nothing in the world there: the map spends size/360 texels per degree of the
// head, and even the closest phone zoom puts under one screen pixel on a
// degree, so a 512 map is still minified and the 1024 level is never sampled.
// The makeup map keeps its size on every profile.

export interface DecalTextureSizes {
  /** Side of the stubble, scruff, buzz and crew map (stubble.ts). */
  readonly stubble: number;
  /** Side of the blush and eyeshadow map (makeup.ts). */
  readonly makeup: number;
}

/** The profile flag the sizes read (a slice of GfxSettings). */
export interface DecalMemoryProfile {
  readonly iosMemoryProfile: boolean;
}

/** Full-size maps: every profile outside the iOS memory profile. */
export const FULL_DECAL_TEXTURE_SIZES: DecalTextureSizes = Object.freeze({
  stubble: 1024,
  makeup: 512,
});

/** Stubble map side on the iOS memory profile. */
export const IOS_STUBBLE_TEXTURE_SIZE = 512;

const IOS_DECAL_TEXTURE_SIZES: DecalTextureSizes = Object.freeze({
  stubble: IOS_STUBBLE_TEXTURE_SIZE,
  makeup: FULL_DECAL_TEXTURE_SIZES.makeup,
});

/** The decal map sides for a memory profile: the stubble map halves on the iOS
 *  memory profile, the makeup map keeps its full size everywhere. */
export function decalTextureSizesFor(profile: DecalMemoryProfile): DecalTextureSizes {
  return profile.iosMemoryProfile ? IOS_DECAL_TEXTURE_SIZES : FULL_DECAL_TEXTURE_SIZES;
}

/** The side of a square RGBA map from its byte length, so a texture always
 *  takes its dimensions from the buffer that was painted. */
export function decalMapSide(byteLength: number): number {
  const side = Math.round(Math.sqrt(byteLength / 4));
  if (side < 1 || side * side * 4 !== byteLength) {
    throw new Error(`decal map buffer of ${byteLength} bytes is not a square RGBA map`);
  }
  return side;
}
