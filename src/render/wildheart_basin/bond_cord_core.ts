// Pure plan for the Pack Bond's jade spirit cord (bond_cord.ts): where it ties
// on (the jaguar's collar ring, the master's chest), how it sags, how its three
// braided strands twist, and how bright and how thick it burns as master and
// jaguar close (the sim's bondStrength through basin_boss_fx_core's
// bondCordStrength).
//
// Three-free, DOM-free, deterministic.

export const BOND_CORD = {
  /** Strands braided round the cord's line, and the segments along it. */
  strands: 3,
  segments: 56,
  /** The braid's radius at its middle (yards) at full strength, pinched to
   *  nothing at each end, and its twists along the cord. */
  braid: 0.34,
  twists: 5,
  /** Each strand's own thickness, and the soft core's. */
  strand: 0.075,
  core: 0.32,
  /** Sag at the middle per yard of span (a cord of light hangs a little). */
  sagPerYard: 0.055,
  /** The ground glow under each body (radius, yards). */
  pool: 3.2,
} as const;

/** How far the cord's middle hangs below the straight line, for a span. */
export function cordSag(span: number, strength: number): number {
  return span * BOND_CORD.sagPerYard * (1.25 - 0.5 * strength);
}

/** The braid's radius at `u` along the cord (0 at the master, 1 at the cat). */
export function braidRadius(u: number, strength: number): number {
  const pinch = Math.sin(Math.PI * Math.max(0, Math.min(1, u)));
  return BOND_CORD.braid * pinch ** 0.6 * (0.55 + 0.45 * strength);
}

/** A point on the cord's centre line at `u`: the straight line from `from`
 *  to `to`, sagging under its own weight. Writes `out`. */
export function cordPoint(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  u: number,
  sag: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  out.x = from.x + (to.x - from.x) * u;
  out.y = from.y + (to.y - from.y) * u - sag * 4 * u * (1 - u);
  out.z = from.z + (to.z - from.z) * u;
  return out;
}
