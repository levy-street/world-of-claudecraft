// Pure plan of the Wheel of the Hearth on screen (heat_wheel_fx.ts paints it;
// the sim: encounters/smith_heart/heat_wheel.ts; the polish pass of 2026-11-18,
// in the family of the lava waves' wall of fire):
//  - a doomed slice's WARNING: molten cracks spreading out from the
//    wellspring's lip through the basalt, the plates between them glowing
//    hotter, the whole slice throbbing quicker to its eruption, heat shimmer
//    rising off its vents;
//  - the safe slice: calm, cool, still (every tier);
//  - the ERUPTION: a flash running out from the lip, geysers of fire and a low
//    sheet of flame over the slice, embers and smoke, then the scorch cooling
//    after the sim has dropped the slice (`fade` seconds).
// Every slice's footprint (the floor decal, the actionable part) draws on every
// tier; the low tier thins the vents (wheelBudget). The sim's numbers are read
// (heat_ids.ts), never tuned here. Three-free, DOM-free, deterministic.

import { HEARTH_WELL } from '../../sim/content/smith_heart_layout';
import { WHEEL_ARCS_DEG } from '../../sim/encounters/smith_heart/heat_ids';

export const WHEEL_FX = {
  /** Floor slots: a round warning (four slices) over the last one burning
   *  (three) and the one before cooling (three), and spares. */
  slots: 14,
  /** Vents laid in the widest slice; a narrower one shows its share. */
  vents: 60,
  /** Every `geyserEvery`th vent is a tall geyser; the rest a low flame. */
  geyserEvery: 4,
  /** The vents' reach out from the lip (yards; the floor clips them). */
  ventInner: HEARTH_WELL.r + 2.5,
  ventOuter: 50,
  /** No vent this close to a slice's straight edge (the safe slice stays clear). */
  ventEdge: 2.5,
  /** The eruption runs out from the lip to the far wall over this long. */
  ripple: 0.32,
  /** A geyser's height and a low flame's (yards, min to max). */
  geyser: [7, 13] as const,
  flame: [2.4, 4.8] as const,
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
 * (0..1) and 1 for a geyser (0 a low flame). A low-discrepancy layout, so any
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
