// The burning pools' fire as numbers (the painter is final_pool_flames.ts, a
// part of FinalKitFx): how many pools burn at once, the soft flames, smoke
// puffs and embers per pool and the low tier's share, the flames' height off
// the sim's radius, the fire catching as a pool lands. Every flame's foot
// stands inside the sim's radius (`reach`) with its whole width and lean, so
// the fire never reads wider than the hit area.
//
// The second polish pass (2026-11-24): Jose read the first pass's tongues as
// rows of regular little cones. The flames are now soft noise cards
// (soft_flame_glsl.ts), wide and few rather than thin and many, each on its
// own height, clock and wandering foot, over a heat glow on the pool.
//
// Three-free, DOM-free, deterministic.

/** The look (yards, seconds). */
export const POOL_FLAMES = {
  /** Pools burning at once (the Ember Mark's and Forge Fire's cap, 10, the
   *  Cinder Trail's, 14, and Magma Rift's lava pools). */
  pools: 30,
  /** Soft flames, smoke puffs and embers per pool (detail tier; the low
   *  tier's share below: it keeps the fire, sheds the smoke). */
  tongues: 26,
  tonguesLow: 10,
  smokes: 5,
  smokesLow: 0,
  embers: 22,
  embersLow: 8,
  /** The tongues' height on a 5 yd pool (they scale with the radius, capped). */
  height: 4.2,
  /** How far out the tongues' feet stand (share of the sim's radius). */
  reach: 0.82,
  /** The fire catching as the pool lands (seconds). */
  catch: 0.45,
} as const;

/** A pool's fire `age` seconds after it landed: 0 to 1 as it catches. */
export function poolFlameHeat(age: number): number {
  if (age <= 0) return 0;
  const k = Math.min(1, age / POOL_FLAMES.catch);
  return k * k * (3 - 2 * k);
}

/** A pool of radius `r`: its tongues' height (yards), wider pools a little
 *  taller, never a wall. */
export function poolFlameHeight(r: number): number {
  return POOL_FLAMES.height * Math.min(1.35, Math.max(0.6, r / 5));
}

/** A soft flame's half width over its height (its widest card), and its
 *  lean at the tip over its height. Mirrored by the flame's vertex program in
 *  final_pool_flames.ts. */
export const POOL_FLAME_SHAPE = { halfW: 0.42, lean: 0.14 } as const;

/** The widest a flame `hgt` yards tall stands either side of its foot (its
 *  card's half width and its lean), so its foot is planted that far in. */
export function poolTongueSpread(hgt: number): number {
  return hgt * (POOL_FLAME_SHAPE.halfW + POOL_FLAME_SHAPE.lean);
}

/** How far out a tongue `hgt` yards tall may plant its foot in a pool of
 *  radius `r`, so its flame never stands past the sim's radius. */
export function poolTongueReach(r: number, hgt: number): number {
  return Math.max(0, Math.min(r * POOL_FLAMES.reach, r - poolTongueSpread(hgt)));
}
