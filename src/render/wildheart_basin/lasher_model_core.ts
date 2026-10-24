// The Snarlvine Lasher and the Thorn Sprout, their Blender bodies measured
// (scripts/assets/wildheart_vine_lasher, the delivery notes, and the shipped
// GLBs sampled bone by bone): the facts their looks
// (characters/wildheart_creature_looks.ts) and their effects (lasher_fx.ts, the
// sprout's burst in gorgebloom_fx.ts) key on. The Sprout is the same rig at
// half size with its own sculpt.
//
// Model space: yards at the authored size, glTF axes: +Y up, the body faces
// +Z, its LEFT is +X; the origin on the ground between the root feet. Clip
// times are seconds in the shipped clips (their first key one 24 fps frame
// in: every authored beat sits KEY_LEAD later).
//
// Three-free, DOM-free, deterministic.

import { KEY_LEAD } from './gorgebloom_model_core';

/** The templates' sim scales (sim/content/wildheart.ts). */
export const LASHER_SIM_SCALE = 2.2;
export const SPROUT_SIM_SCALE = 1.5;

export const LASHER_MODEL = {
  url: 'models/creatures/wildheart_vine_lasher.glb',
  /** The Idle pose's skinned bounds (0.5 s in): the vines' dip to the crown
   *  spikes (6.52; the hump at 5.7). */
  idleMin: -0.053,
  idleTop: 6.522,
  /** The gaits' reference speeds (planted feet slide at these). */
  walkRef: 2,
  runRef: 5.5,
} as const;

export const LASHER_CLIP = {
  /** Attack: the vine swipe crosses the front at 0.55; Attack2: the stab lands
   *  at 0.50, about 7 yd ahead. */
  swipe: 0.55 + KEY_LEAD,
  stab: 0.5 + KEY_LEAD,
  /** LashCast (the Entangling Lash, a 1.5 s bar): the whip circles overhead
   *  to 1.36, unrolls, and its tip slams the lane at 1.50 on the centre line,
   *  8.4 yd ahead; the whip lies along the lane to 1.80. */
  lashSlam: 1.5 + KEY_LEAD,
  lashTipImpact: { x: 0.09, y: 0, z: 8.42 },
  /** The whip's end (R_Vine7's tail) on the slam: where the lane's effect
   *  carries on from. */
  lashWhipEnd: 9.3,
  lashLiesUntil: 1.8 + KEY_LEAD,
  lashLength: 2.458,
  /** Death: the pile hits the ground at 1.45. */
  deathPile: 1.45 + KEY_LEAD,
} as const;

export const SPROUT_MODEL = {
  url: 'models/creatures/wildheart_thorn_sprout.glb',
  idleMin: -0.025,
  idleTop: 3.006,
  walkRef: 1,
  runRef: 2.75,
} as const;

export const SPROUT_CLIP = {
  /** Emerge: buried and tiny, it bursts out of its pod at 0.30, full height
   *  at 0.55, ready at 1.79. */
  emergeBurst: 0.3 + KEY_LEAD,
  emergeTall: 0.55 + KEY_LEAD,
  emergeLength: 1.833,
  /** Bite: the jaws close at 0.42. */
  bite: 0.42 + KEY_LEAD,
  /** Wither (its Gorgebloom died): gone into the loam by 1.90. */
  witherGone: 1.9 + KEY_LEAD,
} as const;

/** The def height (pivot to the Idle bounds' top at sim scale 1, the dip
 *  included) that draws a model at its authored size at sim `scale`. */
export function authoredLookHeight(m: { idleMin: number; idleTop: number }, scale: number): number {
  return (m.idleTop - m.idleMin) / scale;
}

/** The def hover that keeps the authored ground on the pivot (the dip below
 *  it sinks into the floor as authored). */
export function authoredLookHover(m: { idleMin: number }, scale: number): number {
  return m.idleMin / scale;
}
