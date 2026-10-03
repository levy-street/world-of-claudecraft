// Claim and release of the private Crypt slot a run plays in. The claim is made
// directly (never through enterDungeon): no roster spawn on shared rng draws, no
// exit portal, no lockout or heroic bookkeeping. freeInstance owns the release.

import { freeInstance } from '../instances/dungeons';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import { GRAVEYARD_SHIFT_DUNGEON_ID } from './run_layout';

export function claimGraveyardShiftSlot(ctx: SimContext, key: string): InstanceSlot | null {
  const inst = ctx.instances.find(
    (i) => i.dungeonId === GRAVEYARD_SHIFT_DUNGEON_ID && i.partyKey === null,
  );
  if (!inst) return null;
  inst.partyKey = key;
  inst.difficulty = 'normal';
  inst.emptyFor = 0;
  inst.claimedAt = ctx.time;
  return inst;
}

// Only frees a slot this run still holds: the reaper or a reset may already
// have handed it back to the pool.
export function releaseGraveyardShiftSlot(ctx: SimContext, inst: InstanceSlot, key: string): void {
  if (inst.partyKey === key) freeInstance(ctx, inst);
}
