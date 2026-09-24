// Ordered exclusive locomotion modes before ordinary charge/follow/fear/walking.
// True means this mode owns the step. Keep the order: vehicle freeze precedes
// rift lift stripping, and the race lock precedes leap/climb but follows Valkyr.

import { advanceClimb, tryStartClimb } from './climb';
import { advanceHeroicLeap } from './combat/heroic_leap';
import { advanceValkyrsCalling } from './combat/paladin_valkyrs_calling';
import { riftPlayerLift } from './rift/runs';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { clearAfkOnMove } from './social/away';
import type { Entity } from './types';
import { advanceGliderMovement } from './world_quest_glider';
import { advanceWispMazeMovement } from './world_quest_wisp_maze';

export function advanceExclusiveMovement(ctx: SimContext, p: Entity, meta: PlayerMeta): boolean {
  if (meta.vehicle) return true;
  if (advanceWispMazeMovement(ctx, p, meta)) return true;
  if (advanceGliderMovement(ctx, p, meta)) return true;
  // Strip the previous raised-tier lift before any movement integration.
  // updateRiftTriggers reapplies it after the step; non-rift movement is unchanged.
  const preLift = riftPlayerLift(ctx, p);
  if (preLift !== 0) p.pos.y -= preLift;
  const mv = meta.moveInput;
  if (
    mv.forward ||
    mv.back ||
    mv.strafeLeft ||
    mv.strafeRight ||
    mv.turnLeft ||
    mv.turnRight ||
    mv.jump
  ) {
    meta.lastActiveTick = ctx.tickCount;
    // Deliberate locomotion clears AFK, but not Do Not Disturb.
    clearAfkOnMove(ctx, meta, p);
  }
  if (advanceValkyrsCalling(ctx, p)) return true;
  if (meta.mountRace?.phase === 'countdown') return true;
  if (advanceHeroicLeap(ctx, p)) return true;
  // A running climb owns the body; airborne descending movement may grab a
  // reachable ledge automatically. No second input or frame-perfect QTE.
  if (advanceClimb(p)) return true;
  if (tryStartClimb(p, ctx.cfg.seed) && advanceClimb(p)) return true;
  return false;
}
