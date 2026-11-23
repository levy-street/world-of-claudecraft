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
  tongues: 18,
  tonguesLow: 7,
  embers: 22,
  embersLow: 8,
  /** The tongues' height on a 5 yd pool (they scale with the radius, capped). */
  height: 3.6,
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

/** The widest a tongue `hgt` yards tall stands either side of its foot (its
 *  ribbon's half width at the root, the fragment's shape, and its lean):
 *  mirrored by the tongue's vertex program in final_pool_flames.ts. */
export function poolTongueSpread(hgt: number): number {
  const width = (0.35 + hgt * 0.75) * 1.2;
  return width * 0.5 * 0.8 + hgt * 0.22;
}

/** How far out a tongue `hgt` yards tall may plant its foot in a pool of
 *  radius `r`, so its flame never stands past the sim's radius. */
export function poolTongueReach(r: number, hgt: number): number {
  return Math.max(0, Math.min(r * POOL_FLAMES.reach, r - poolTongueSpread(hgt)));
}
