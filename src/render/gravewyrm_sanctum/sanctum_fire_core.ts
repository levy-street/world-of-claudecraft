// Pure plan for the Gravewyrm Sanctum's fires (sanctum_fire.ts): how many
// flame tongues, hot cores, embers and soul wisps each fire burns per tier,
// scaled by the fire's size, and the two colour ramps (the cult's orange pitch
// fire and the violet-green soulfire of the stolen souls) as linear rgb.
//
// Three-free, DOM-free, deterministic.

/** One fire to draw: its bowl's top, its size (tongue width, yards), soulfire
 *  or pitch fire, and whether it roars (a slow breathing swell: the vault's
 *  thaw pyres). */
export interface SanctumFireDraw {
  x: number;
  y: number;
  z: number;
  size: number;
  soul: boolean;
  roar?: boolean;
}

export const SANCTUM_FIRE = {
  /** The ring the tongues lick up round, as a share of the size. */
  ring: 0.36,
  /** How high an ember climbs (yards per unit of size, plus a spread). */
  emberRise: 3.2,
  /** How high a soul wisp spirals before it thins away (per unit of size). */
  wispRise: 4.6,
} as const;

export interface FireCounts {
  /** Every flame tongue: the inner column, the outer ring and the tip licks. */
  tongues: number;
  /** Tall narrow tongues in the fire's heart, at several sizes. */
  inner: number;
  /** Shorter, broader tongues round the coals, leaning out and licking up. */
  outer: number;
  /** Small quick flicks of flame breaking off above the body (they keep the
   *  silhouette ragged, never a cone). */
  licks: number;
  cores: number;
  embers: number;
  wisps: number;
  total: number;
}

/** Sprites for one fire on a tier: a bigger fire burns more tongues; the low
 *  tier keeps a layered fire but drops the licks, the embers and the wisps
 *  (cosmetic). */
export function sanctumFireCounts(size: number, soul: boolean, lowGfx: boolean): FireCounts {
  const big = size >= 1.3;
  const inner = lowGfx ? (big ? 6 : 3) : big ? 11 : 5;
  const outer = lowGfx ? (big ? 5 : 3) : big ? 13 : 6;
  const licks = lowGfx ? 0 : big ? 9 : 4;
  const cores = big ? 3 : 1;
  const embers = lowGfx ? 0 : big ? 18 : 7;
  const wisps = lowGfx || !soul ? 0 : big ? 8 : 3;
  const tongues = inner + outer + licks;
  return {
    tongues,
    inner,
    outer,
    licks,
    cores,
    embers,
    wisps,
    total: tongues + cores + embers + wisps,
  };
}

/** Total sprites for a list of fires (one instanced draw). */
export function sanctumFireInstanceTotal(
  fires: readonly SanctumFireDraw[],
  lowGfx: boolean,
): number {
  let n = 0;
  for (const f of fires) n += sanctumFireCounts(f.size, f.soul, lowGfx).total;
  return n;
}

/** The pitch fire's ramp, cold to white-hot (linear rgb, heat 0..1 stops). */
export const PITCH_RAMP: readonly (readonly [number, number, number])[] = [
  [0.0, 0.0, 0.0],
  [0.5, 0.07, 0.01],
  [0.98, 0.33, 0.05],
  [1.0, 0.68, 0.24],
  [1.0, 0.94, 0.76],
];

/** The soulfire's ramp: a dark violet at the cool edge (#7A58B8 deepened),
 *  a soul green body (#8FD6A0), a pale white-green core. */
export const SOUL_RAMP: readonly (readonly [number, number, number])[] = [
  [0.0, 0.0, 0.0],
  [0.07, 0.025, 0.2],
  [0.09, 0.36, 0.2],
  [0.3, 0.9, 0.42],
  [0.82, 1.0, 0.86],
];
