// Aurora visibility fade for the Frostveil sky. The curtains hang far above
// the fog (fog: false, additive blending), so without an explicit gate every
// neighboring realm sees them over its horizon. Fades the aurora out across
// the frost rect's z band and both x borders, so the ribbons vanish AT and
// beyond the real zone boundary: the Drakelands' xMin (src/sim/content/
// drakelands.ts) and the Amberfall's xMax (src/sim/content/amberfall.ts) are
// both 180 (signed for the west side), so this core's x bound must match
// that value exactly or the aurora bleeds into the neighboring realm.
//
// RENDER_PURE_CORES module: no three.js, no DOM; frost_sky.ts's update() is
// the thin Three-side consumer that multiplies each ribbon's opacity by the
// returned band.

export const AURORA_Z_NEAR = 1400;
export const AURORA_Z_FAR = 1920;
/** Matches drakelands.ts xMin (180) and amberfall.ts xMax (-180). */
export const AURORA_X_BOUND = 180;
export const AURORA_RAMP = 80;

/**
 * 0 outside the frost rect, ramping linearly to 1 over `AURORA_RAMP` units
 * inside each of its four edges. At and beyond AURORA_X_BOUND on either side
 * (and outside the z band) the aurora is fully invisible.
 */
export function auroraFadeBand(camX: number, camZ: number): number {
  const fadeIn = Math.min(1, Math.max(0, (camZ - AURORA_Z_NEAR) / AURORA_RAMP));
  const fadeOut = 1 - Math.min(1, Math.max(0, (camZ - AURORA_Z_FAR) / AURORA_RAMP));
  const fadeW = Math.min(1, Math.max(0, (camX + AURORA_X_BOUND) / AURORA_RAMP));
  const fadeE = Math.min(1, Math.max(0, (AURORA_X_BOUND - camX) / AURORA_RAMP));
  return Math.min(fadeIn, fadeOut, fadeW, fadeE);
}
