// Pure plan of the Guardian of the Heat's Molten Swells' look (pass 4; the
// painter is heat_swell_fx.ts, the lanes and their clock heat_fx.ts and
// heat_fx_core.ts). A swell is a heavy wave of molten rock rolling down its
// lane: a curling crest with a white-hot lip over an open boiling face, plates
// of dark cooling crust riding its back, spray and drops torn off the crest,
// and behind it a scorched trail that cools to crust and fades.
//
// Binding (readability): the wall is drawn EXACTLY where the sim strikes. The
// sim's wave (heat_geometry.ts inWave) strikes from `front - waveDepth` to
// `front` along its lane, `laneHalf` either side of it; the wall's whole body
// lies in that box (its profile's z in [-1, 0] scaled by waveDepth, its width
// the lane's half width), and the floor under it burns brightest across that
// same box, so the danger a player reads is the hit area at every frame.
//
// Three-free, DOM-free, deterministic.

import { HEAT_TUNING as T } from '../../sim/encounters/smith_heart/heat_ids';
import { SWELL_HEIGHT } from './heat_fx_core';

/** The look's numbers: the wall's full height (yards), how long the scorched
 *  trail lingers once its lane is gone, the shake at the origin. */
export const HEAT_SWELL_LOOK = {
  height: SWELL_HEIGHT,
  trailSeconds: 5,
  /** How far behind the wall the trail still glows (yards). */
  coolRun: T.waveSpeed * 2.2,
  originShake: 0.55,
} as const;

/** The wave's cross-section, front foot to back foot, as (z, y): z in
 *  [-1, 0] (0 the wave's front, -1 its back foot, waveDepth behind), y in
 *  [0, 1] (its full height). The face rises out of a boiling foot into the
 *  hollow under the curl, the lip hooks forward to the front line, the crest
 *  rolls over and the back slopes down to the floor. */
export const SWELL_PROFILE: readonly (readonly [number, number])[] = [
  [0, 0],
  [-0.08, 0.1],
  [-0.17, 0.24],
  [-0.24, 0.4],
  [-0.24, 0.54],
  [-0.17, 0.63],
  [-0.07, 0.66],
  [0, 0.64],
  [-0.02, 0.76],
  [-0.1, 0.9],
  [-0.24, 0.99],
  [-0.38, 1.0],
  [-0.52, 0.9],
  [-0.66, 0.7],
  [-0.8, 0.44],
  [-0.92, 0.18],
  [-1, 0],
];

/** The profile's share at the lip's tip (the shader's white-hot line). */
export const SWELL_LIP_V = 7 / (SWELL_PROFILE.length - 1);

/** The along-lane box the wall stands in for a wave whose front is `front`
 *  yards down a lane drawn `length` long: [near, far] yards from the lane's
 *  start (the sim's inWave band; the wall stops at the lane's end). */
export function swellFootprint(
  front: number,
  length: number,
  out: { near: number; far: number } = { near: 0, far: 0 },
): { near: number; far: number } {
  const far = Math.max(0, Math.min(front, length));
  out.far = far;
  out.near = Math.max(0, far - T.waveDepth);
  return out;
}

/** A spent swell's scorched trail `since` seconds after its lane went: from
 *  its full heat to nothing over trailSeconds. */
export function swellTrailFade(since: number): number {
  if (since <= 0) return 1;
  const k = Math.min(1, since / HEAT_SWELL_LOOK.trailSeconds);
  return (1 - k) ** 1.5;
}

/** The droop of the wall toward its ends (`x` -1..1 across): full in the
 *  middle, rolling down to the floor at the lane's edges (a wave, not a box). */
export function swellDroop(x: number): number {
  const a = Math.min(1, Math.abs(x));
  return 1 - a ** 6;
}
