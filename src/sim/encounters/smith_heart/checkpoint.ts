// The Smith's Heart's death-recovery candidates (docs/design/raid/smith_heart.md,
// "Death and the run back"): a released spirit walks back in through the
// raid's door and rises, penalty-free, at a checkpoint, exactly as in the
// five-mans. instances/dungeon_checkpoints.ts owns the door's side (the route's
// gates, the arrival's clearance, the fallback to the entrance); this module
// says which rooms to try and in what order (checkpoint_order.ts: the last
// guardian killed, the Heart once all four are down), and whether the Heart's
// way in, the seal's portal, stands open.

import {
  SMITH_HEART_CHECKPOINTS,
  type SmithHeartCheckpoint,
  type SmithHeartCheckpointRoom,
} from '../../content/smith_heart_checkpoints';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { noteSmithHeartKills, smithHeartCheckpointRooms } from './checkpoint_order';
import { SMITH_HEART_VEIN_BITS, smithHeartEarnedMask, smithHeartProgress } from './seal';

/** One room the door side may offer, with whether its way in beyond the
 *  gates it lists is open (the Heart's needs the seal's portal). */
export interface SmithHeartCheckpointCandidate extends SmithHeartCheckpoint {
  room: SmithHeartCheckpointRoom;
  reachable: boolean;
}

/** The claim's recovery candidates, best first. Notes a kill landed this very
 *  tick first (the seal's tick records the rest), so none is ever missed. */
export function smithHeartCheckpointCandidates(
  ctx: SimContext,
  inst: InstanceSlot,
): SmithHeartCheckpointCandidate[] {
  const order = noteSmithHeartKills(inst, smithHeartEarnedMask(ctx, inst), SMITH_HEART_VEIN_BITS);
  return smithHeartCheckpointRooms(order).map((room) => ({
    room,
    ...SMITH_HEART_CHECKPOINTS[room],
    reachable: room !== 'final' || smithHeartProgress(ctx, inst).portalOpen,
  }));
}
