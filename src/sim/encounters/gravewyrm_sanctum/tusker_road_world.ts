// The Trample lane in WORLD coordinates, for the clients that read the fight
// off mirrored entities (the renderer's lane paint and the HUD alert): the
// same plan the encounter makes (tusker_road.ts planTrampleLane) from the
// Tusker's world position, its locked facing and the outcrop objects in view.
// The Sanctum's instances are laid out along z, so a world z names its slot.
//
// Zero rng, no SimContext.

import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../data';
import type { TuskerLane } from '../../types';
import { SANCTUM_DUNGEON } from './ids';
import { type OutcropSpot, planTrampleLane } from './tusker_road';

/** The origin of the Sanctum instance a world z lies in. Read-only: the same
 *  object comes back for every call on that slot (built once per slot), so
 *  the painters and the HUD that plan the lane every frame allocate nothing. */
export function sanctumOriginAt(z: number): Readonly<{ x: number; z: number }> {
  const def = DUNGEONS[SANCTUM_DUNGEON];
  if (!def) return NO_ORIGIN;
  const slot = instanceSlotForZ(z);
  let o = ORIGINS[slot];
  if (!o) {
    o = instanceOrigin(def.index, slot);
    ORIGINS[slot] = o;
  }
  return o;
}

const NO_ORIGIN: Readonly<{ x: number; z: number }> = { x: 0, z: 0 };
/** The Sanctum's instance origins by slot (fixed for the process). */
const ORIGINS: { x: number; z: number }[] = [];

/**
 * The Trample lane from a world spot along `yaw`, given the standing outcrops
 * in world coordinates. The lane comes back in WORLD coordinates (its start is
 * the spot given); its length, reach and outcrop are the encounter's own.
 */
export function planTrampleLaneWorld(
  x: number,
  z: number,
  yaw: number,
  outcrops: readonly OutcropSpot[],
  out?: TuskerLane,
): TuskerLane {
  const o = sanctumOriginAt(z);
  // The outcrops in the instance's frame, on reused spots (the painters plan
  // every frame of a bar; nothing is allocated once the pool is warm).
  const local = LOCAL;
  local.length = outcrops.length;
  for (let i = 0; i < outcrops.length; i++) {
    let spot = POOL[i];
    if (!spot) {
      spot = { id: 0, x: 0, z: 0 };
      POOL[i] = spot;
    }
    spot.id = outcrops[i].id;
    spot.x = outcrops[i].x - o.x;
    spot.z = outcrops[i].z - o.z;
    local[i] = spot;
  }
  const lane = planTrampleLane(x - o.x, z - o.z, yaw, local, out);
  lane.x = x;
  lane.z = z;
  return lane;
}

/** The reused instance-local spots of planTrampleLaneWorld. Client only:
 *  the encounter plans in its own frame and never calls it, and it must never
 *  be called from the sim tick (these are shared by every caller in the
 *  process). Every call is synchronous and its outcrop list is consumed
 *  before it returns, so a caller may keep the returned lane (its own `out`)
 *  but never this module's spots. */
const POOL: OutcropSpot[] = [];
const LOCAL: OutcropSpot[] = [];
