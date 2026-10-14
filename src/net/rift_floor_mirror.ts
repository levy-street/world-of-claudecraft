// The online client's mirror of the rift floor its view stands on
// (ClientWorld.riftFloor) and that floor's predicted collision region.
//
// riftState events are the only floor source (no snapshot field), and the server
// routes them by the VIEW's pid: while a moderator spectates, the target's stream
// arrives instead of their own. So the mirror is also reset whenever the stream
// it was built from may no longer describe the view: every spectate frame (open,
// retarget, exit) and every reconnect hello (the old stream may have ended
// unseen, or been a watched player's). The server follows each with the live
// floor of the new view, if any (server/moderation_moves.ts describeRiftFloor).
// Without the reset a moderator back from watching a rift runner kept the
// runner's rift map, minimap and collision on open ground.
import { clearRiftRegion, setRiftRegion } from '../sim/colliders';
import { riftFloorColliders } from '../sim/rift/rift_gen';
import type { SimEvent } from '../sim/types';
import type { RiftFloorView } from '../world_api/dungeons';

export type RiftStateEvent = Extract<SimEvent, { type: 'riftState' }>;

/** Swap the mirrored floor `prev` for the one `next` describes; an exit or a null
 *  `next` (a reset) leaves none. `token`'s collision region follows the server's
 *  floor lifecycle (spawnRiftFloor / freeRiftFloorEntities in sim/rift/runs.ts):
 *  the old floor's region is always cleared before a new one is registered,
 *  whether this is a descent, a real exit, or a reset. Returns the new floor. */
export function swapMirroredRiftFloor(
  token: number,
  prev: RiftFloorView | null,
  next: RiftStateEvent | null,
): RiftFloorView | null {
  if (prev) clearRiftRegion(token, prev.origin.x, prev.origin.z);
  if (!next?.active) return null;
  const floor: RiftFloorView = {
    eventId: next.eventId,
    instanceId: next.instanceId,
    seed: next.seed,
    baseLevel: next.baseLevel,
    floorIndex: next.floorIndex,
    floorCount: next.floorCount,
    origin: next.origin,
    contentId: next.contentId,
    contentHash: next.contentHash,
    upgrade: next.upgrade,
    name: next.name,
    themeName: next.themeName,
    tier: next.tier,
  };
  setRiftRegion(
    token,
    floor.origin.x,
    floor.origin.z,
    riftFloorColliders(floor.seed, floor.baseLevel, floor.floorIndex, floor.upgrade),
  );
  return floor;
}
