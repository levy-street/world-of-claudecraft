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

// The prototype party waits inside Morthen's chamber, in line of sight of the
// arrival point (owner decision: the concept's "busy in the next room" opening
// comes with the final version). Ordered by roster index: spawn order is fixed.
// They stand 16 to 22 yards out, past the party's engage radius, so they wait
// until Morthen walks up to them or hits one.
export const GRAVEYARD_SHIFT_BOT_SPOTS: readonly { x: number; z: number }[] = [
  { x: -3, z: 74 },
  { x: 2, z: 70 },
  { x: 6, z: 72 },
  { x: -6, z: 71 },
  { x: 3, z: 76 },
];

// Morthen's two skeleton allies rise at his sides on arrival.
export const GRAVEYARD_SHIFT_ALLY_SPOTS: readonly { x: number; z: number }[] = [
  { x: -3, z: 90 },
  { x: 3, z: 90 },
];

// The Staff Exit a won shift opens, behind the throne dais (r 9.5 around z 96)
// and short of the nave's end wall (z 112).
export const GRAVEYARD_SHIFT_STAFF_EXIT = { x: 0, z: 107 } as const;

// Where a run hands its owner back outside: the borrowed dungeon's own exit
// drop (its authored leaveOffset, else the door's default four yards out), the
// same point leaveDungeon walks a leaver to.
export function graveyardShiftDoorDrop(): { x: number; z: number } {
  const dungeon = DUNGEONS[GRAVEYARD_SHIFT_DUNGEON_ID];
  const drop = dungeon.leaveOffset ?? { x: 0, z: -4 };
  return { x: dungeon.doorPos.x + drop.x, z: dungeon.doorPos.z + drop.z };
}
