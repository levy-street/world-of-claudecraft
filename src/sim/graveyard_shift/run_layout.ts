// Authored placements for a Graveyard Shift run, as offsets from the claimed
// Hollow Crypt slot's origin (the same frame as the dungeon's spawn list).
// Pure: no SimContext, no rng.

import { DUNGEONS } from '../data';

// The run borrows a free slot of the shipped Crypt for its geometry, colliders
// and interior (one constant, so a dedicated definition can replace it later).
export const GRAVEYARD_SHIFT_DUNGEON_ID = 'hollow_crypt';

// Morthen's chamber, a few yards in front of his throne (the `morthen` spawn
// stands at z 98), facing back down the nave toward the entrance (-z).
export const GRAVEYARD_SHIFT_ARRIVAL = { x: 0, z: 92, facing: Math.PI } as const;

// Where a run hands its owner back outside: the borrowed dungeon's own exit
// drop (its authored leaveOffset, else the door's default four yards out), the
// same point leaveDungeon walks a leaver to.
export function graveyardShiftDoorDrop(): { x: number; z: number } {
  const dungeon = DUNGEONS[GRAVEYARD_SHIFT_DUNGEON_ID];
  const drop = dungeon.leaveOffset ?? { x: 0, z: -4 };
  return { x: dungeon.doorPos.x + drop.x, z: dungeon.doorPos.z + drop.z };
}
