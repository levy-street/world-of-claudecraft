// Pure plan of the Guardian of the Heat's Basalt Fist and its Molten Swells
// (heat_fx.ts paints them; docs/design/raid/smith_heart.md section 7.4). The
// sim's numbers (the fist's radius and bar, the lanes' length and half
// width, the waves' speed and depth) are read here, never changed:
//
//   the spot    the fist's lethal disc at its exact radius filling with the
//               bar, cracks of light racing through the basalt under it
//   the lanes   the three swells' lanes at their exact length and width,
//               filling with the bar; held, fading, while their waves roll
//   the fist    a giant fist of basalt and crystal falling out of the smoke
//               over the spot through the bar's last part, hitting it: the
//               crater's flash, a ring, molten cracks cooling over seconds
//   the swells  each a rolling wall of molten rock cresting down its lane at
//               the wave's own speed, rising out of the spot and dying at the
//               lane's end, leaving a molten wake that crusts as it cools
//
// Readability (binding): the spot and the lanes are the shared floor
// telegraph on EVERY tier (the spot lethal, the lanes danger, the vein's
// white-gold as the accent), and the walls themselves draw on every tier (a
// wave a player must step around); sparks, spray, smoke and the shakes thin.
// The Heat is the Hearth: molten gold and white, never volcanic red.
//
// Three-free, DOM-free, deterministic (a hash, never rng).

import { HEAT_CASTS, HEAT_TUNING as T } from '../../sim/encounters/smith_heart/heat_ids';

/** The guardian's fist bar (the cast the spot's fill follows). */
export const BASALT_FIST = HEAT_CASTS.fist;

/** The palette (linear 0..1): the first flame's white-gold, its gold body,
 *  the dark of the cooled crust, the smoke. */
export const HEAT_FX_COLORS = {
  core: [1.0, 0.94, 0.76] as const,
  fire: [1.0, 0.72, 0.3] as const,
  deep: [0.78, 0.4, 0.1] as const,
  crust: [0.09, 0.075, 0.065] as const,
  spark: [1.0, 0.82, 0.48] as const,
  smoke: [0.3, 0.27, 0.25] as const,
  ash: [0.48, 0.45, 0.41] as const,
  /** Shock rings (hex for the shared ring pool). */
  ring: 0xffe6b0,
  ringGold: 0xffb848,
  /** The telegraphs' element accent (the threat colour is the kit's). */
  accent: 0xffe6a0,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

// ---- the fist ------------------------------------------------------------------------

/** The share of the bar after which the giant fist starts to fall. */
/** The Basalt Fist's sculpted rock (audit point 17: the bundle of square
 *  columns): the Heart kit's colossus fist and forearm, repainted basalt, in
 *  the fist's frame (yards: y up from the knuckles' floor, +z the knuckles'
 *  face), the crystal knuckles kept on that face. */
export const HEAT_FIST_SCULPT = {
  fist: { node: 'Kit_ColFist', at: [0, 2.6, 0], rot: [0, 0, 0], scale: 1.55 },
  arm: { node: 'Kit_ColForearm', at: [0, 8.4, -0.4], rot: [0.1, 0, 0], scale: [1.45, 1.45, 1.45] },
} as const;

export const FIST_DROP_FROM = 0.62;
/** How high over the spot the fist hangs before it falls (yards). */
export const FIST_DROP_HEIGHT = 30;
/** Seconds the crater's molten cracks take to cool. */
export const CRATER_SECONDS = 6;

export interface FistLook {
  /** The telegraph's fill (0..1 of the bar). */
  fill: number;
  /** The fist's height over the spot (yards), and whether it shows. */
  height: number;
  shown: boolean;
  /** The cracks racing out under the spot (0..1). */
  crack: number;
}

/** The spot `age` seconds into its `seconds` of warning. */
export function fistLook(
  age: number,
  seconds: number,
  out: FistLook = { fill: 0, height: 0, shown: false, crack: 0 },
): FistLook {
  const k = clamp01(age / Math.max(0.1, seconds));
  out.fill = k;
  out.crack = smooth(k * 1.15);
  const drop = clamp01((k - FIST_DROP_FROM) / (1 - FIST_DROP_FROM));
  out.shown = k >= FIST_DROP_FROM * 0.7;
  // Hanging high in the smoke, then plunging (accelerating to the hit).
  out.height = FIST_DROP_HEIGHT * (1 - drop * drop * drop) + 1.2;
  return out;
}

/** The crater `since` seconds after the hit: the flash (0..1) and the molten
 *  cracks' glow (cooling to nothing at CRATER_SECONDS). */
export function craterLook(
  since: number,
  out: { flash: number; glow: number } = { flash: 0, glow: 0 },
): { flash: number; glow: number } {
  out.flash = 1 - smooth(since / 0.35);
  out.glow = since < 0 ? 0 : (1 - clamp01(since / CRATER_SECONDS)) ** 1.6;
  return out;
}

// ---- the lanes and the swells -----------------------------------------------------------

/** How tall a wave's wall stands at its full height (yards): a heavy wave
 *  over a player's head, lower than it is wide (pass 4: 3.4 to 3.8). */
export const SWELL_HEIGHT = 3.8;

/** A wave's wall `front` yards down its lane (`length` long, where it is
 *  drawn to): its height (yards), rising out of the spot over its first
 *  yards and sinking over its lane's last. */
export function swellHeight(front: number, length: number = T.laneLength): number {
  const rise = smooth(front / 4);
  const sink = smooth((length + T.waveDepth - front) / 4);
  return SWELL_HEIGHT * rise * sink;
}

/** A wave's front `since` seconds after it began to roll (the sim's speed,
 *  so the wall drawn is where the sim strikes). */
export function swellFront(since: number): number {
  return Math.max(0, since) * T.waveSpeed;
}

/** The molten wake a wave leaves: its heat `behind` yards back from the
 *  front (white-gold at the wall, crusting dark over its cooling run). */
export function wakeHeat(behind: number): number {
  if (behind < 0) return 0;
  return (1 - clamp01(behind / (T.waveSpeed * 2.5))) ** 1.4;
}

/** A small integer hash in [0, 1). */
export function heatFxHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x45d9f3b) ^ Math.imul(b | 0, 0x2c1b3c6d)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Pools (a fist every 22 s; its three swells roll about four seconds). */
export const HEAT_FX_POOLS = {
  fists: 2,
  lanes: 6,
  craters: 3,
} as const;
