// Morthen never dies on shift: a blow that would kill the run owner leaves them
// at 1 hp and marks the run lost; the run tick tears down (never from inside
// dealDamage). Covers every source (bots, mobs, sourceless), unlike the duel
// clamp which needs a player attacker, and keeps clamping while the loss is
// pending so a second lethal hit in the same tick cannot slip through.

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export function graveyardShiftLethalClamp(ctx: SimContext, target: Entity, amount: number): number {
  if (target.kind !== 'player' || target.dead) return amount;
  const run = ctx.graveyardShiftRuns.get(target.id);
  if (!run || target.hp - amount >= 1) return amount;
  run.pendingOutcome = 'lost';
  return Math.max(0, target.hp - 1);
}
