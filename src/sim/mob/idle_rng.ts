// The one owner of the off-stream idle rng (Entity.offStreamRng): a dependency-light
// leaf so every site that re-rolls a mob's idle timer imports the same decision
// instead of re-making it. mob/locomotion.ts (the idle-wander draws and the
// evade-home reset) and mob/lifecycle.ts (the respawn reset) both need it, and
// lifecycle must not import the locomotion coordinator just to reach it: the
// ./aggro_ranges precedent in this directory.
//
// `src/sim`-pure: no DOM/Three imports, no Math.random/Date.now (enforced by
// tests/architecture.test.ts).

import { MOBS } from '../data';
import { Rng } from '../rng';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

/** The rng an `offStreamRng` mob's PASSIVE idle draws come from: a private
 *  sub-stream seeded from the sim clock and the mob's id, exactly as the
 *  ambient stable horses do (mob/ambient.ts). Enabling distance culling routes
 *  every mob's passive rolls through this private lane, including nearby mobs.
 *  That intentionally reshapes the shared RNG sequence relative to an
 *  unthrottled sim, while making a nearby mob's passive state independent of
 *  whether a distant mob was skipped. Without either opt-in, the mob gets
 *  `ctx.rng` itself and the historical draw position is unchanged.
 *  Deterministic and wall-clock free, so hosts with the same config agree.
 *  Pinned by tests/off_stream_rng.test.ts and the idle_mob_distance_culling
 *  parity golden. */
export function idleRng(ctx: SimContext, mob: Entity): Rng {
  if (!mob.offStreamRng && (ctx.cfg.idleMobTickRadius ?? 0) <= 0) return ctx.rng;
  const seed = (((ctx.tickCount * 0x9e3779b1) >>> 0) ^ ((mob.id * 0x85ebca6b) >>> 0)) >>> 0;
  return new Rng(seed);
}

/**
 * Roll an idle wander PAUSE and apply the template's liveliness knob
 * (MobTemplate.wanderHaste) to it.
 *
 * One owner because there are FIVE sites that roll a pause (the two in the idle
 * wander step, the camp spawn, the respawn reset, and the evade-home reset) and a
 * knob honored at only some of them is a knob that does nothing: a quick mob
 * reaches a different site than a slow one, which is exactly how wanderHaste
 * shipped dead. Passing the rng in keeps the CALLER owning which stream the draw
 * comes from (`idleRng` above, or a camp's private scatter stream).
 *
 * The division is applied AFTER the draw, deliberately: the draw count, order and
 * drawn values are identical for every template, so the shared stream and the
 * parity draw digest cannot move whatever a template sets. Pinned by
 * tests/mob_locomotion.test.ts and tests/off_stream_rng.test.ts.
 */
export function wanderPause(rng: Rng, mob: Entity, min: number, max: number): number {
  return rng.range(min, max) / (MOBS[mob.templateId]?.wanderHaste ?? 1);
}
