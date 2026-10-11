// The Drowned Temple moon's live state, shared between the sky and lagoon
// shaders (temple_sky_lagoon.ts reads these very objects as uniforms) and the
// one writer, Ysolei's moon layer (temple_moon_fx.ts): how far the moon has
// swelled, dropped toward the island and gone dark. The same objects ride
// every material, so a write never relinks a program; all 0 is the untouched
// sky. Cosmetic only.

export const TEMPLE_MOON_SKY = {
  /** The disc's growth (0: its own size, 2: three times as wide). */
  swell: { value: 0 },
  /** How far its direction drops toward the horizon (direction units). */
  drop: { value: 0 },
  /** 0 bright, 1 a dark disc ringed by its corona (the eclipse). */
  eclipse: { value: 0 },
};
