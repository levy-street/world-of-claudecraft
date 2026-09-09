// Screen-area bounds for the two additive VFX surfaces that are sized in WORLD
// units and therefore have no upper bound on how much of the frame they can
// cover: the impact flipbook quad and the weapon-skin point sprites.
//
// Both are pure fill. An impact sheet is authored at 5 to 12 yards across and
// faces the camera, so at melee range one quad is effectively fullscreen, blended
// additively and then re-read by the composer bloom. A weapon mote uses
// `gl_PointSize = aSize * uScale / -mv.z`, which diverges as the weapon
// approaches the near plane, so a first-person-close weapon paints sprites
// hundreds of pixels wide.
//
// COSMETIC ONLY, and deliberately so: both bounds sit far above anything a
// normal camera distance produces, so they only ever trim the degenerate
// close-range case. Neither surface carries actionable information (an impact
// sheet is the decoration on a hit that has already resolved, a weapon mote is
// jewellery), and no telegraph, area ring or debuff read goes through here.
// Nothing about WHERE an effect is or HOW LONG it lasts changes.

/**
 * Fraction of the viewport HEIGHT one impact flipbook quad may cover.
 *
 * Sized against the real numbers rather than taste: the sequencer's boosted
 * impact sheet is `2 * cs * SPECTACLE.flipbook` yards across (about 7) and
 * grows to 1.2x over its life, while the default camera boom is 12 yards
 * (src/game/input.ts camDist, floor 3) at a 60 degree vertical fov. At the
 * default boom the bound is over 13 yards, so the authored sheet passes
 * through untouched; it only bites once the player has zoomed most of the way
 * in, which is exactly the case where one quad whites the frame out.
 */
export const IMPACT_QUAD_MAX_SCREEN_FRACTION = 0.95;

/** Fraction of the viewport HEIGHT one weapon-VFX point sprite may cover. */
export const WEAPON_POINT_MAX_SCREEN_FRACTION = 0.25;

/** The bound at the 1080p reference height, for a rig whose host never calls
 *  setPixelScale (the point materials ship with the matching uScale default). */
export const DEFAULT_WEAPON_POINT_MAX_PX = 1080 * WEAPON_POINT_MAX_SCREEN_FRACTION;

/**
 * The largest world-space edge length a camera-facing quad may have at
 * `distance` before it covers more than `maxFraction` of the viewport height.
 *
 * A quad of world height `h` at distance `d` under a vertical half-angle whose
 * tangent is `tanHalfVFov` covers `h / (2 * d * tanHalfVFov)` of the viewport
 * height, so the bound is that relation solved for `h`.
 */
export function maxWorldQuadSize(
  distance: number,
  tanHalfVFov: number,
  maxFraction: number,
): number {
  if (!(distance > 0) || !(tanHalfVFov > 0) || !(maxFraction > 0)) return Number.POSITIVE_INFINITY;
  return maxFraction * 2 * distance * tanHalfVFov;
}

/** `size`, trimmed to the screen-fraction bound at this distance. Values at or
 *  below the bound come back untouched, so ordinary camera distances are
 *  bit-identical to the unbounded path. */
export function boundQuadSize(
  size: number,
  distance: number,
  tanHalfVFov: number,
  maxFraction: number,
): number {
  const bound = maxWorldQuadSize(distance, tanHalfVFov, maxFraction);
  return size < bound ? size : bound;
}

/** The gl_PointSize ceiling, in device pixels, for a viewport this tall. */
export function maxPointSizePx(devicePxHeight: number): number {
  if (!(devicePxHeight > 0)) return DEFAULT_WEAPON_POINT_MAX_PX;
  return devicePxHeight * WEAPON_POINT_MAX_SCREEN_FRACTION;
}

/** tan(vfov / 2) for a vertical field of view in DEGREES (three's camera.fov). */
export function tanHalfVerticalFov(fovDegrees: number): number {
  return Math.tan((fovDegrees * Math.PI) / 360);
}
