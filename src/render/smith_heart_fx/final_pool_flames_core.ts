// The burning pools' fire as numbers (the painter is final_pool_flames.ts, a
// part of FinalKitFx): how many pools burn at once, the tongues and embers per
// pool and the low tier's share, the tongues' height off the sim's radius,
// the fire catching as a pool lands. Every foot stands inside the sim's
// radius (`reach`), so the fire never reads wider than the hit area.
//
// Three-free, DOM-free, deterministic.

/** The look (yards, seconds). */
export const POOL_FLAMES = {
  /** Pools burning at once (the Ember Mark's and Forge Fire's cap, 10, the
   *  Cinder Trail's, 14, and Magma Rift's lava pools). */
  pools: 30,
  /** Tongues and embers per pool (detail tier; the low tier's share below). */
  tongues: 12,
  tonguesLow: 5,
  embers: 22,
  embersLow: 8,
  /** The tongues' height on a 5 yd pool (they scale with the radius, capped). */
  height: 2.3,
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
