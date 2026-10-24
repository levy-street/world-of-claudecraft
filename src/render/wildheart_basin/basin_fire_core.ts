// Pure plan for the Sunbone braziers' fire (basin_fire.ts): how many flame
// tongues, hot cores and embers each bowl burns per tier, and their sizes.
//
// Three-free, DOM-free, deterministic.

export const BRAZIER_FIRE = {
  /** A tongue's width (yards) and the ring they lick up round. */
  tongue: 1.25,
  ring: 0.4,
  /** The hot core low in the bowl. */
  core: 1.1,
  /** How high an ember climbs before it burns out (yards, plus a spread). */
  emberRise: 3.4,
} as const;

/** Sprites per brazier on a tier (cosmetic: the low tier keeps a fire). */
export function fireInstanceCount(lowGfx: boolean): {
  tongues: number;
  cores: number;
  embers: number;
  total: number;
} {
  const tongues = lowGfx ? 5 : 9;
  const cores = 1;
  const embers = lowGfx ? 0 : 7;
  return { tongues, cores, embers, total: tongues + cores + embers };
}
