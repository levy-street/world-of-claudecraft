// Whether an idle hostile's proximity scan may pull a player it has in range: in the open
// world only one it can see. The classic rule: a mob does not aggro through a wall, so a
// player resting in a walk-in building (the Mirefen tavern, the first) is not pulled by
// the marsh outside through its stone, while one who steps into the doorway's view is.
//
// Consumed by the general idle scan in mob/locomotion.ts, after the distance test, so the
// sight line is traced only for a player who would otherwise be pulled. It gates nothing
// else: a deliberate pull (a player's attack, a social or pack pull, a taunt) still goes
// through aggroMob untouched, so normal combat applies to a fight a player starts.
//
// The sight line is the spell one (Sim.hasLineOfSight over colliders.ts lineOfSightClear):
// what stands above the eye line blocks (walls, buildings, trees), low clutter does not,
// and the terrain never does. Instanced interiors (dungeons, delves, rifts, arenas, the
// battleground) keep their authored proximity pulls: their packs are placed and linked
// for them, and a sight rule there would reshape every tuned pull.
//
// Pure over its SimContext callback: no state, no rng, deterministic on every host.

import { DUNGEON_X_THRESHOLD } from '../data';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export function proximityAggroSees(
  ctx: Pick<SimContext, 'hasLineOfSight'>,
  mob: Entity,
  target: Entity,
): boolean {
  if (mob.pos.x > DUNGEON_X_THRESHOLD) return true;
  return ctx.hasLineOfSight(mob, target);
}
