// The Snarlvine Lasher's Entangling Lash, planned (lasher_fx.ts draws it): the
// whip's tip slams the lane where the model's own tip lands (8.4 yd out on the
// centre line), then a thorn wave carries the lane on from the whip's end to
// the 20 yd the sim tests, and the splash looks of the impact and the wave.
//
// Three-free, DOM-free, deterministic.

import { MOBS } from '../../sim/data';
import { laneWaveDelay, laneWaveStations } from './basin_thorns_core';
import { LASHER_CLIP, LASHER_SIM_SCALE } from './lasher_model_core';
import type { CrownSpec, RippleSpec } from './saurian_fx_core';

/** The lane the sim tests and its bar (vine_lasher's trashKit.line). */
export function lasherLane(): { length: number; halfWidth: number; castTime: number } {
  const line = MOBS.vine_lasher?.trashKit?.line;
  return {
    length: line?.length ?? 20,
    halfWidth: line?.halfWidth ?? 2,
    castTime: line?.castTime ?? 1.5,
  };
}

/** LashCast plays from the bar's start at the rate that lands the whip's tip
 *  on the lane on the bar's last frame. */
export function lasherLashRate(): number {
  return LASHER_CLIP.lashSlam / lasherLane().castTime;
}

/** In-game yards per model yard for a Lasher drawn at sim `scale`. */
export function lasherModelScale(scale: number): number {
  return (scale > 0 ? scale : LASHER_SIM_SCALE) / LASHER_SIM_SCALE;
}

/** Yards along the lane where the whip's tip lands, and where it ends. */
export function lasherTipReach(scale: number): number {
  return LASHER_CLIP.lashTipImpact.z * lasherModelScale(scale);
}
export function lasherWhipEnd(scale: number): number {
  return LASHER_CLIP.lashWhipEnd * lasherModelScale(scale);
}

/** The wave's front: yd/s, and its spacing. */
export const LASHER_WAVE_SPEED = 52;
export const LASHER_WAVE_STEP = 2.2;

/** The wave's stations from the whip's end to the lane's end. Writes `out`. */
export function lasherWaveStations(scale: number, out: number[]): number[] {
  return laneWaveStations(lasherWhipEnd(scale), lasherLane().length, LASHER_WAVE_STEP, out);
}

/** Seconds after the slam the wave reaches `reach` yards. */
export function lasherWaveDelay(reach: number, scale: number): number {
  return laneWaveDelay(reach, lasherWhipEnd(scale), LASHER_WAVE_SPEED);
}

export const LASHER_SPLASH = {
  tip: {
    crown: { r0: 0.4, r1: 2.2, height: 2.4, life: 0.75 } satisfies CrownSpec,
    ripple: { reach: 4, life: 1, rings: 2 } satisfies RippleSpec,
    tint: 0xb8a070,
  },
  wave: { r0: 0.25, r1: 1.2, height: 1.6, life: 0.55 } satisfies CrownSpec,
} as const;
