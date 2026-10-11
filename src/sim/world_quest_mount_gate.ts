// Mount handling at a World Quest instructor.
//
// Every instructor start used to refuse a mounted rider in silence (the click did
// nothing, with no toast), which reads as a broken NPC. The talk now puts the
// rider's own mount away instead, the way the delivery cargo pickup already does
// through forceDismount, so the instructor answers on the first click. Only a
// vehicle seat or a live mount race still refuses: neither is the player's own
// mount to dismiss, and both own the player's controls until they end. The
// Fenbridge accusation (world_quest_investigation.ts) is an instructor start too:
// it summons the infiltrator, so it puts the mount away through this same gate.
//
// Pure over the SimContext seam: no rng, no clock, host-agnostic.

import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { Entity } from './types';

export type WorldQuestMountGateMeta = Pick<PlayerMeta, 'vehicle' | 'mountRace'>;

/** True when the instructor may proceed; false when a vehicle or race owns the player. */
export function dismountForWorldQuestInstructor(
  ctx: Pick<SimContext, 'forceDismount'>,
  player: Entity,
  meta: WorldQuestMountGateMeta,
): boolean {
  if (meta.vehicle || meta.mountRace) return false;
  ctx.forceDismount(player);
  return true;
}
