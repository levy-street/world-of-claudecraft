// Grask's ROLLING BOULDER, the pure half: every tunable, how many must stand
// with the marked player, how many boulders and at whom, where a boulder is at
// any moment, and whom it runs down. No rng, no DOM: the renderer imports this
// file, so the boulder on screen is the boulder that hits and the ring on the
// floor is the ring that counts.
//
// The rule: one player is marked and cannot move. A boulder rolls at them. If
// enough allies stand WITH them when it arrives it is thrown back at Grask and
// stuns him; if not, it crushes them. Alone there is nobody to stand with, so a
// lone player keeps their feet and simply gets out of its way.
//
// What the client needs rides ordinary hoard cues:
//   brute-boulder-throw   the carrier, at Grask: where every boulder starts
//   brute-boulder         one per boulder (ids carrier + 1, carrier + 2), at the
//                         marked player (`targetId`, `radius` the support ring,
//                         `innerRadius` how many allies it takes) or, alone, at
//                         the far end of its lane (no target, `innerRadius` 0)
//   brute-boulder-return  the SAME id, thrown back: from there to Grask
//   brute-boulder-crush   the SAME id, broken: `innerRadius` 1 if it hit someone

import { RUN_SPEED } from '../types';

export const BOULDER_CUE_VARIANTS = [
  'brute-boulder-throw',
  'brute-boulder',
  'brute-boulder-return',
  'brute-boulder-crush',
] as const;
export function isBoulderVariant(variant: string | undefined): boolean {
  return (BOULDER_CUE_VARIANTS as readonly string[]).includes(variant ?? '');
}

export const HOARD_BOULDER_DREAD_AURA_ID = 'hoard_boulder_dread';
export const HOARD_BOULDER_DAZE_AURA_ID = 'hoard_boulder_daze';
export const HOARD_BOULDER_STAGGER_AURA_ID = 'hoard_boulder_stagger';

export const BOULDER = Object.freeze({
  /** MARK_WARNING: the mark is up this long before the boulder leaves his hands. */
  warningSec: 2.4,
  /** BOULDER_SPEED, and the least time it is ever in flight (a target at his feet
   *  still gives the party time to reach them). */
  rollSpeed: 9,
  minTravelSec: 1.3,
  boulderRadius: 2.3,
  /** SUPPORT_RADIUS: standing this close to the marked player counts. */
  supportRadius: 5,
  /** Alone, the lane runs this far past where the player stood. */
  soloOvershoot: 9,
  /** FAIL_DAMAGE and FAIL_STUN. */
  crushDamageFraction: 0.75,
  crushStunSec: 4,
  /** Thrown back: how fast, how long Grask reels, and what it costs him (a share
   *  of his own health). */
  returnSpeed: 16,
  bossStunSec: 6,
  reflectDamageFraction: 0.04,
  /** A second boulder follows the first by this long. */
  doubleStaggerSec: 1.4,
  crushSec: 0.9,
});

/** REQUIRED_SUPPORTERS: allies who must stand with the marked player. Nobody
 *  alone, one of two, two of three to five, three of a bigger party. */
export function supportersNeeded(living: number): number {
  if (living <= 1) return 0;
  if (living === 2) return 1;
  if (living <= 5) return 2;
  return 3;
}

export interface BoulderPlan {
  boulders: number;
  /** Allies each boulder asks for (0: the lone-player dodge). */
  needed: number;
}

/** How many boulders, and what each asks. A second one only ever joins when the
 *  party can answer BOTH: the marked cannot help each other, so the free players
 *  are split between them and each boulder asks for no more than its share. */
export function boulderPlan(living: number, double: boolean): BoulderPlan {
  const needed = supportersNeeded(living);
  if (!double || living < 4) return { boulders: 1, needed };
  const free = living - 2;
  return { boulders: 2, needed: Math.max(1, Math.min(needed, Math.floor(free / 2))) };
}

/** Seconds a boulder is in flight over `distance` yards. */
export function boulderTravelSec(distance: number, speed = 1): number {
  return Math.max(BOULDER.minTravelSec, distance / (BOULDER.rollSpeed * Math.max(0.1, speed)));
}
export function boulderReturnSec(distance: number): number {
  return Math.max(0.5, distance / BOULDER.returnSpeed);
}

/** How far along its roll (0 to 1) a boulder is `elapsed` seconds into a cue of
 *  `total` seconds whose last `travel` seconds are the roll. It gathers pace:
 *  heavy off his hands, fastest as it arrives. */
export function boulderProgress(elapsed: number, total: number, travel: number): number {
  const t = (elapsed - (total - travel)) / Math.max(1e-6, travel);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * (0.55 + 0.45 * t);
}

/** Whether a boulder rolling from (ax, az) to (bx, bz) between two moments of
 *  its roll ran over a point: swept, so a fast boulder never steps over anyone. */
export function boulderRunsOver(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  progressBefore: number,
  progressNow: number,
  pointX: number,
  pointZ: number,
  reach: number = BOULDER.boulderRadius,
): boolean {
  if (progressNow <= progressBefore) return false;
  const sx = ax + (bx - ax) * progressBefore;
  const sz = az + (bz - az) * progressBefore;
  const ex = ax + (bx - ax) * progressNow;
  const ez = az + (bz - az) * progressNow;
  const dx = ex - sx;
  const dz = ez - sz;
  const lengthSq = dx * dx + dz * dz;
  const t =
    lengthSq < 1e-9
      ? 0
      : Math.max(0, Math.min(1, ((pointX - sx) * dx + (pointZ - sz) * dz) / lengthSq));
  return Math.hypot(pointX - (sx + dx * t), pointZ - (sz + dz * t)) <= reach;
}

/** Whether an ally at (x, z) stands with the marked player at (mx, mz). */
export function standsWith(mx: number, mz: number, x: number, z: number): boolean {
  return Math.hypot(x - mx, z - mz) <= BOULDER.supportRadius;
}

/** The farthest an ally can be and still reach the ring before the boulder does:
 *  the fairness number the tests hold the clocks to. */
export function boulderAnswerRange(speed = 1): number {
  return (BOULDER.warningSec + boulderTravelSec(0, speed)) * RUN_SPEED + BOULDER.supportRadius;
}
