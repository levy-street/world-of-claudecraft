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

// The party is in the room before Morthen's chamber (the concept's opening),
// busy with the last pack (GRAVEYARD_SHIFT_PACK, a few yards toward the
// chamber): the tank and the rogue up front, the casters and the hunter behind.
// Ordered by roster index: spawn order is fixed. Every spot is out of say
// range of the arrival point (no speech reaches the boss room), and so past
// the party's notice radius: Morthen walks in unheard and unseen.
export const GRAVEYARD_SHIFT_BOT_SPOTS: readonly { x: number; z: number }[] = [
  { x: -1, z: 64 },
  { x: 3, z: 54 },
  { x: 7, z: 56 },
  { x: -6, z: 55 },
  { x: 2, z: 65 },
];
// What the party faces as it fights: the pack, toward the chamber.
export const GRAVEYARD_SHIFT_PARTY_FACES = { x: 0, z: 69 } as const;

// The shift's opening (run_opening.ts): the last pack of the party's clear,
// Morthen's own colleagues, already fighting it in the room before his
// chamber, and the monsters the party killed on the way in, lying where the
// Crypt's own spawn list placed them (crypt_shambler and hollow_acolyte rows
// short of the widows' room).
export const GRAVEYARD_SHIFT_PACK: readonly { templateId: string; x: number; z: number }[] = [
  { templateId: 'crypt_shambler', x: -2, z: 68 },
  { templateId: 'crypt_shambler', x: 2, z: 69 },
  { templateId: 'hollow_acolyte', x: 0, z: 71 },
];
export const GRAVEYARD_SHIFT_CLEARED_CORPSES: readonly {
  templateId: string;
  x: number;
  z: number;
}[] = [
  { templateId: 'crypt_shambler', x: -3, z: 18 },
  { templateId: 'crypt_shambler', x: 3, z: 19 },
  { templateId: 'crypt_shambler', x: -9, z: 38 },
  { templateId: 'hollow_acolyte', x: -5, z: 39 },
  { templateId: 'crypt_shambler', x: 9, z: 54 },
  { templateId: 'hollow_acolyte', x: 5, z: 55 },
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
