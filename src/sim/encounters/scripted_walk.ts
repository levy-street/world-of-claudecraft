// Shared movement for encounter transitions that must be visible to players.
// This helper deliberately delegates every step to the ordinary mob mover: no
// position assignment, no obstacle bypass, and no private timing state.

import type { SimContext } from '../sim_context';
import { type Entity, steadyAngleTo, type Vec3 } from '../types';

export function walkEncounterActorTo(
  ctx: SimContext,
  actor: Entity,
  destination: Vec3,
  speedMultiplier = 1,
): boolean {
  actor.aiState = 'chase';
  actor.vx = 0;
  actor.vz = 0;
  if (ctx.isRooted(actor)) {
    actor.facing = steadyAngleTo(actor.pos, destination, actor.facing);
    return false;
  }
  return ctx.moveToward(
    actor,
    destination,
    actor.moveSpeed * speedMultiplier * ctx.moveSpeedMult(actor),
  );
}
