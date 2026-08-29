// The one reach rule every player-cast resurrection obeys: the dead ally's BODY
// (corpsePos when the spirit has released, else where the entity lies) must be
// within range AND in line of sight of the caster. Raid/heroic lockouts are
// enforced only at the dungeon door (instances/dungeons.ts enterDungeon), while
// an accepted resurrection teleports the target to the caster, so an unreachable
// rez was a door bypass: a caster inside a locked instance could pull a
// lockout-barred player past the gate. Consumed by the casting lifecycle (start,
// mid-cast, and finish), the mass-resurrection roster sweep, and the accept-time
// arrival anchor in resurrection_offer.ts.

import { entityToBodyLineOfSightClear } from '../line_of_sight_elevation';
import type { SimContext } from '../sim_context';
import { dist2d, type Entity, type Vec3 } from '../types';

// The reach ceiling for a resurrection with no authored range (the mass
// resurrections author range 0). An authored range (both single-target rezzes
// author 30, matching their design docs) stays the enforced range.
export const RESURRECTION_RANGE = 40;

export type ResurrectionReachErrorKind = 'range' | 'los';

// The point being raised: the released body when there is one, else the entity.
function resurrectionBodyPos(dead: Entity): Vec3 {
  return dead.corpsePos ?? dead.pos;
}

// Why the target body is out of the caster's resurrection reach, or null when it
// is reachable. `rangeSlack` is the finish-side drift allowance the other cast
// arms already grant (a body cannot move, but the caster can be displaced).
export function resurrectionReachError(
  ctx: SimContext,
  caster: Entity,
  dead: Entity,
  maxRange: number,
  rangeSlack = 0,
): ResurrectionReachErrorKind | null {
  const body = resurrectionBodyPos(dead);
  if (dist2d(caster.pos, body) > maxRange + rangeSlack) return 'range';
  // Reach measures the CORPSE position, not the entity's (a released ghost
  // stands at the graveyard), so it uses the entity-to-body elevation arm.
  // Both ends are players, so only their delve runs can supply interior modules.
  const run = ctx.delveRunForPlayer(caster.id) ?? ctx.delveRunForPlayer(dead.id);
  const clear = entityToBodyLineOfSightClear(
    ctx.cfg.seed,
    caster,
    body,
    0.05,
    run?.modules,
    ctx.riftCollisionToken,
  );
  return clear ? null : 'los';
}

// The range a resurrection cast enforces: its authored range where one exists
// (capped at the ceiling), else the ceiling. The mass resurrections author
// range 0, so their roster sweep runs at RESURRECTION_RANGE; the Sunmender's
// group rite inherits its ability's authored 30.
export function resurrectionCastRange(abilityRange: number): number {
  return abilityRange > 0 ? Math.min(abilityRange, RESURRECTION_RANGE) : RESURRECTION_RANGE;
}
