// The Graveyard Shift's way in, as a pure leaf the sim, the renderer and the
// client scan share: the glowing grave by the Hollow Crypt, Tibbs the union rep
// who climbs out of it, and the one eligibility rule that decides both whether
// the grave glows and whether it answers. The rule is never shown to the
// player: an ineligible player sees a plain grave. No SimContext, no rng.

import type { Vec3 } from '../types';

// The grave stands in the chapel graveyard, a few yards north of the Hollow
// Crypt's door (80, 90) (owner's pick).
export const GRAVE_ITEM_ID = 'gshift_grave';
export const GRAVE_POS = { x: 84, z: 111 } as const;
// Stable ids, clear of the sequential roster and of every other stable band:
// inside the stable ground-object range (types.ts), above the Farshore band
// (2_147_100_xxx). Both are dropped and re-added with the same id on purpose.
export const GRAVE_ENTITY_ID = 2_147_200_001;
export const TIBBS_ENTITY_ID = 2_147_200_002;
export const TIBBS_NPC_ID = 'tibbs';
// Tibbs stands beside his grave, facing the player's usual approach (south).
export const TIBBS_OFFSET = { x: 1.6, z: -1.2 } as const;
// The grave whispers to an eligible player who comes this close (client side).
export const GRAVE_WHISPER_RADIUS = 12;
// The grave answers an interaction from this close.
export const GRAVE_INTERACT_RADIUS = 6;
// Tibbs goes back down once the player walks this far off, or after this long.
export const TIBBS_LEAVE_RADIUS = 20;
export const TIBBS_IDLE_SECONDS = 90;

// Owner decision: a level 15 character, five levels past the Crypt, comes back
// to cover the shift.
export const GRAVEYARD_SHIFT_MIN_LEVEL = 15;
// Having killed Morthen once: the Cryptbreaker deed, or, for a character older
// than the Book of Deeds, the Crypt's own quest turned in.
export const GRAVEYARD_SHIFT_UNLOCK_DEED = 'dgn_hollow_crypt';
export const GRAVEYARD_SHIFT_UNLOCK_QUEST = 'q_hollow';
// The cosmetic reward for the won shift (secret until earned). Owner decision:
// the shift can be won ONCE, so holding the deed closes the grave for good.
export const BOSS_FOR_A_DAY_DEED_ID = 'hid_boss_for_a_day';

export interface GraveyardShiftEligibilityInput {
  readonly level: number;
  readonly deedsEarned: { has(id: string): boolean };
  readonly questsDone: { has(id: string): boolean };
}

/** Whether the grave stands and answers for this character: level 15, Morthen
 *  killed once, and the shift not yet won. */
export function isGraveyardShiftEligible(p: GraveyardShiftEligibilityInput): boolean {
  return (
    p.level >= GRAVEYARD_SHIFT_MIN_LEVEL &&
    !p.deedsEarned.has(BOSS_FOR_A_DAY_DEED_ID) &&
    (p.deedsEarned.has(GRAVEYARD_SHIFT_UNLOCK_DEED) ||
      p.questsDone.has(GRAVEYARD_SHIFT_UNLOCK_QUEST))
  );
}

export function isGraveyardShiftGrave(e: { objectItemId?: string | null } | undefined): boolean {
  return e?.objectItemId === GRAVE_ITEM_ID;
}

/** Where Tibbs stands beside the grave, in world x/z. */
export function tibbsSpot(): { x: number; z: number } {
  return { x: GRAVE_POS.x + TIBBS_OFFSET.x, z: GRAVE_POS.z + TIBBS_OFFSET.z };
}

/** Where a shift ends: on the path in front of the grave, facing Tibbs. */
export function graveReturnSpot(): { x: number; z: number } {
  return { x: GRAVE_POS.x + 0.5, z: GRAVE_POS.z - 3.5 };
}

export function withinGrave(pos: Pick<Vec3, 'x' | 'z'>, radius: number): boolean {
  return Math.hypot(pos.x - GRAVE_POS.x, pos.z - GRAVE_POS.z) <= radius;
}
