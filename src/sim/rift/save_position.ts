// Where a character save taken inside a rift or a treasure hoard puts the
// player on their next login. Rift instances are runtime-only (persistence.ts
// never saves them): the floor a player logs out on is torn down or reused by
// another party by the time they return, and its far-east coordinates carry
// no hint of where its entrance was. So the save itself records the run's
// overworld return spot (the same `returnPos`/`returnFacing` a normal exit
// through the beacon or the exit portal uses), and login lands them beside the
// portal or the hoard's dig site instead of falling through the instance-door
// rule in saved_pos_exit.ts to the first dungeon's door.
import type { SimContext } from '../sim_context';
import type { Vec3 } from '../types';
import { riftInstanceAtPos } from './runs';

export interface RiftSavePlacement {
  pos: { x: number; z: number };
  facing: number;
}

/** The overworld return spot and exit facing of the live rift or hoard run
 * whose floor contains `pos`, or null when `pos` is on no live floor. */
export function riftSavePlacement(ctx: SimContext, pos: Vec3): RiftSavePlacement | null {
  const inst = riftInstanceAtPos(ctx, pos);
  if (!inst) return null;
  return { pos: { x: inst.returnPos.x, z: inst.returnPos.z }, facing: inst.returnFacing ?? 0 };
}

/** The corpse position a save records: a body left on a live rift floor is
 * moved to that run's return spot, because the floor will not exist when a
 * released spirit logs back in to run to it. Anywhere else it is unchanged. */
export function riftSaveCorpsePos(
  ctx: SimContext,
  corpsePos: Vec3 | null,
): { x: number; z: number } | null {
  if (!corpsePos) return null;
  const placement = riftSavePlacement(ctx, corpsePos);
  return placement ? placement.pos : { x: corpsePos.x, z: corpsePos.z };
}
