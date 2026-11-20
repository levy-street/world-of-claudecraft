// Pure plan of the Wheel of the Hearth on screen (heat_wheel_fx.ts paints it;
// the sim: encounters/smith_heart/heat_wheel.ts; the polish pass of 2026-11-18,
// in the family of the lava waves' wall of fire):
//  - a doomed slice's WARNING: molten cracks spreading out from the
//    wellspring's lip through the basalt, the plates between them glowing
//    hotter, the whole slice throbbing quicker to its eruption, heat shimmer
//    rising off its vents;
//  - the safe slice: calm, cool, still (every tier);
//  - the ERUPTION: a flash running out from the lip, a few big geysers of fire
//    bursting in step with it over the burning ground, embers and smoke, then
//    the scorch cooling after the sim has dropped the slice (`fade` seconds);
//    a burnt slice the next round marks safe is put out fast (`quench`).
// Every slice's footprint (the floor decal, the actionable part) draws on every
// tier; the low tier thins the vents (wheelBudget). The sim's numbers are read
// (heat_ids.ts), never tuned here. Three-free, DOM-free, deterministic.

import { HEARTH_WELL } from '../../sim/content/smith_heart_layout';
import { WHEEL_ARCS_DEG } from '../../sim/encounters/smith_heart/heat_ids';

export const WHEEL_FX = {
  /** Floor slots: a round warning (four slices) over the last one burning
   *  (three) and the one before cooling (three), and spares. */
  slots: 14,
  /** Geysers laid in the widest slice; a narrower one shows its share (few
   *  and big: a scatter of small flames read as confetti). */
  vents: 16,
  /** Every `geyserEvery`th vent is a geyser (every one since the second
   *  polish pass). */
  geyserEvery: 1,
  /** Each geyser's planes: three crossed (a volume from any side) and a
   *  camera-facing burst at its foot (round from straight above). */
  planes: 4,
  /** Seconds the big geysers take to drop on a burning slice the next round
   *  marks safe (the clutter goes; the danger read stays: `danger`, `low`). */
  quench: 0.35,
  /** While the sim still burns a slice its floor never reads cooler than
   *  this fire (0..1) and its low flames stand (graphics fairness: no
   *  invisible damage); once the sim drops it, both go over `out`. */
  danger: 0.4,
  out: 0.3,
  /** A low flame's height (yards, min to max). */
  low: [2.6, 4] as const,
  /** The vents' reach out from the lip (yards; the floor clips them). */
  ventInner: HEARTH_WELL.r + 2.5,
  ventOuter: 50,
  /** No geyser this close to a slice's straight edge (its fire is several
   *  yards wide: the safe slice stays clear). */
  ventEdge: 5.5,
  /** The eruption runs out from the lip to the far wall over this long. */
  ripple: 0.32,
  /** A geyser's height (yards, min to max). */
  geyser: [12, 18] as const,
  /** A column fades out when its axis comes this close (yards) to the
   *  camera, or to the line from the camera to the local player (it never
   *  hides your own character). */
  clear: 4,
  /** The scorch cools this long after the sim drops the slice. */
  fade: 2.6,
} as const;

/** The widest slice's span (radians): a slice shows vents by its share. */
const WIDEST = Math.max(...WHEEL_ARCS_DEG.map(([a, b]) => b - a)) * (Math.PI / 180);

export interface WheelLook {
  /** 0..1 of the warning built (cracks spreading, plates heating). */
  build: number;
  /** The quickening throb of the warning's last stretch, 0..1. */
  throb: number;
  /** Seconds since the eruption (-1 while it warns). */
  erupt: number;
  /** The fire's strength over the slice, 0..1. */
  burn: number;
  /** The scorch left behind, 0..1 (cools to nothing over `fade`). */
  scorch: number;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};

/** A doomed slice `age` seconds into its warning of `seconds`. */
export function wheelWarnLook(age: number, seconds: number, out: WheelLook): WheelLook {
  const f = clamp01(age / Math.max(0.1, seconds));
  out.build = f;
  // From a slow beat to five a second at the eruption, felt only past half.
  const phase = age * (1.2 + 3.8 * f * f);
  const b = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
  out.throb = b * b * smooth((f - 0.45) / 0.4);
  out.erupt = -1;
  out.burn = 0;
  out.scorch = 0;
  return out;
}

/**
 * A slice `t` seconds after its eruption; the sim burns it `burnSeconds`, then
 * the painter keeps it `WHEEL_FX.fade` more while the scorch cools. The fire
 * leaps at once, settles, then dies with the sim's burn; the scorch spreads
 * under it and cools after.
 */
export function wheelEruptLook(t: number, burnSeconds: number, out: WheelLook): WheelLook {
  const span = Math.max(0.1, burnSeconds);
  out.build = 1;
  out.throb = 0;
  out.erupt = Math.max(0, t);
  const rise = smooth(t / 0.08);
  const settle = 0.45 + 0.55 * (1 - smooth(t / 0.7));
  const die = 1 - smooth((t - span * 0.6) / (span * 0.4 + 0.45));
  out.burn = rise * settle * die;
  out.scorch = smooth(t / (span * 0.8)) * (1 - smooth((t - span) / WHEEL_FX.fade));
  return out;
}

/** The painter is done with a slice this long after its eruption. */
export function wheelEruptSpan(burnSeconds: number): number {
  return Math.max(0.1, burnSeconds) + WHEEL_FX.fade;
}

/** How many of the laid vents a slice of `from`..`to` radians shows. */
export function wheelVentCount(from: number, to: number, detail: boolean): number {
  const share = Math.max(0, Math.min(1, (to - from) / WIDEST));
  const n = Math.round(WHEEL_FX.vents * share);
  return detail ? n : Math.ceil(n * 0.45);
}

/**
 * The laid vents, one row of four per vent: the bearing's share across the
 * slice (0..1), the radius's share from the lip out (0..1, area-even), a seed
 * (0..1) and 1 for a geyser. A low-discrepancy layout, so any
 * prefix (a narrow slice's, the low tier's) still covers the slice evenly.
 */
export function wheelVents(count: number = WHEEL_FX.vents): Float32Array {
  const out = new Float32Array(count * 4);
  const g1 = 0.7548776662466927;
  const g2 = 0.5698402909980532;
  for (let i = 0; i < count; i++) {
    const u = (0.5 + g1 * (i + 1)) % 1;
    const v = (0.5 + g2 * (i + 1)) % 1;
    out[i * 4] = 0.04 + 0.92 * u;
    out[i * 4 + 1] = Math.sqrt(v);
    out[i * 4 + 2] = ((((i + 1) * 0.618034 + 0.137) % 1) + 1) % 1;
    out[i * 4 + 3] = i % WHEEL_FX.geyserEvery === 0 ? 1 : 0;
  }
  return out;
}

/** A vent's spot (instance-local yards off the wellspring's centre) in a slice
 *  of `from`..`to` radians (sim bearings: 0 runs +z), or null where the slice's
 *  edge keeps it clear. `out` is [x, z]. */
export function wheelVentAt(
  vents: Float32Array,
  i: number,
  from: number,
  to: number,
  out: [number, number],
): [number, number] | null {
  const a = from + (to - from) * vents[i * 4];
  const r = WHEEL_FX.ventInner + (WHEEL_FX.ventOuter - WHEEL_FX.ventInner) * vents[i * 4 + 1];
  if (Math.min(a - from, to - a) * r < WHEEL_FX.ventEdge) return null;
  out[0] = Math.sin(a) * r;
  out[1] = Math.cos(a) * r;
  return out;
}

/** What a burnt slice shows over its fire: the floor's fire (0..1), the big
 *  geysers' share (0..1) and the low flames' (0..1). */
export interface WheelFireLook {
  floor: number;
  geysers: number;
  low: number;
}

/**
 * A burnt slice's fire `look` (wheelEruptLook) while the sim still burns it
 * (`burning`: its object stands) or `since` seconds after the sim dropped it,
 * its geysers `quench`ed (0..1) once the next round marks it safe. While it
 * burns it always reads as fire: the floor at least `danger`, the low flames
 * up (the geysers may drop to cut the clutter, never the danger); after the
 * drop both go over `out`.
 */
export function wheelFireLook(
  look: WheelLook,
  burning: boolean,
  since: number,
  quench: number,
  out: WheelFireLook,
): WheelFireLook {
  const q = clamp01(quench);
  if (burning) {
    out.floor = Math.max(look.burn, WHEEL_FX.danger);
    out.geysers = 1 - q;
    out.low = 1;
    return out;
  }
  const k = 1 - smooth(since / WHEEL_FX.out);
  out.floor = Math.max(look.burn, WHEEL_FX.danger) * k;
  out.geysers = (1 - q) * k;
  out.low = k;
  return out;
}
