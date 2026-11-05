// A Guardian of the Breath shove that SLIDES (breath_roar.ts' throw, moved
// here so the loose gales share it): the body is carried a step each tick
// along its line by the knockback's walker (throwPlayer: a wall stops it, an
// open lip leaves it in the air over the void), never a blink. While it
// slides it wears an unbreakable root (the hold aura), so the server's
// movement override stays ACTIVE for the slide and the online client stands
// its prediction down once and draws the authoritative motion (a
// server-driven step every tick with no override bumps the override epoch:
// the prediction flaps and the throw reads jerky).
//
//   linear   the Summit Roar's throw: the same step every tick.
//   out      a loose gale's toss (Jose's playtest of 2026-11-04: it read as a
//            sideways teleport): a shove that starts fast and settles, eased
//            out over its seconds.
//
// The anchored and the Knotted Gale's carrier keep their feet (heldFast):
// they are never held and never slide. Zero rng.

import { DT, type Entity } from '../../types';
import { type BreathScope, heldFast, throwPlayer } from './breath_scope';
import { dropAura } from './fight_kit';

export type BreathShoveEase = 'linear' | 'out';

/** A shove in flight (state: rides the fight's state, in tick order). */
export interface BreathShove {
  id: number;
  /** The unit line (world). */
  ux: number;
  uz: number;
  /** Yards still to slide, and this tick's step (the next to take). */
  left: number;
  step: number;
  /** Ticks taken and the slide's ticks. */
  k: number;
  n: number;
  ease: BreathShoveEase;
  /** The whole throw (yards). */
  yards: number;
  /** The hold aura it wears while it slides. */
  aura: string;
}

/** The share of the throw done after `t` (0..1) of its ticks. */
export function shoveEase(ease: BreathShoveEase, t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return ease === 'linear' ? u : 1 - (1 - u) * (1 - u);
}

/** The yards slid on tick `k` (0-based) of `n` for a `yards` throw. */
export function shoveStep(ease: BreathShoveEase, yards: number, k: number, n: number): number {
  return yards * (shoveEase(ease, (k + 1) / n) - shoveEase(ease, k / n));
}

/** Begin sliding `p` `yards` along the unit (ux, uz) over `seconds`, held by
 *  `aura` (named `name`). The anchored and the carrier keep their feet: null. */
export function beginShove(
  s: BreathScope,
  p: Entity,
  ux: number,
  uz: number,
  yards: number,
  seconds: number,
  ease: BreathShoveEase,
  aura: string,
  name: string,
): BreathShove | null {
  if (heldFast(p) || p.carriedBy !== undefined || yards <= 0) return null;
  const n = Math.max(1, Math.round(seconds / DT));
  s.ctx.applyAura(p, {
    id: aura,
    name,
    kind: 'root',
    remaining: seconds + 0.5,
    duration: seconds + 0.5,
    value: 0,
    sourceId: s.boss.id,
    school: 'nature',
    unbreakableControl: true,
    undispellable: true,
  });
  return {
    id: p.id,
    ux,
    uz,
    left: yards,
    step: shoveStep(ease, yards, 0, n),
    k: 0,
    n,
    ease,
    yards,
    aura,
  };
}

/** Every shove in `list` one tick along its line (finished ones leave the
 *  list, their hold dropped). */
export function stepShoves(s: BreathScope, list: BreathShove[]): void {
  for (let i = list.length - 1; i >= 0; i--) {
    const sl = list[i];
    const p = s.ctx.entities.get(sl.id);
    // Only a living body still in the fight's scope slides (a teleport, a
    // wipe home or a hearth ends it).
    if (!p || p.dead || !s.players.includes(p)) {
      if (p) dropAura(p, sl.aura);
      list.splice(i, 1);
      continue;
    }
    const step = Math.min(sl.step, sl.left);
    const moved = throwPlayer(s, p, sl.ux, sl.uz, step);
    sl.left -= step;
    sl.k++;
    sl.step = sl.k < sl.n ? shoveStep(sl.ease, sl.yards, sl.k, sl.n) : sl.left;
    if (!p.onGround && sl.left > 1e-6) {
      // Carried past an open lip into the air: the rest of the throw rides
      // on as its flight at the slide's pace, and the fall takes it from here.
      const secs = Math.max(DT, (sl.n - sl.k) * DT);
      p.vx = (sl.ux * sl.left) / secs;
      p.vz = (sl.uz * sl.left) / secs;
      dropAura(p, sl.aura);
      list.splice(i, 1);
      continue;
    }
    // Done: thrown its whole way, or stopped (a wall).
    if (sl.left <= 1e-6 || moved <= 0) {
      dropAura(p, sl.aura);
      list.splice(i, 1);
    }
  }
}

/** Drop every shove's hold (a reset, the gales gone). */
export function clearShoves(s: Pick<BreathScope, 'ctx'>, list: BreathShove[]): void {
  for (const sl of list) {
    const p = s.ctx.entities.get(sl.id);
    if (p) dropAura(p, sl.aura);
  }
  list.length = 0;
}
