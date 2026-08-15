// Pet return across an arena-shaped match (ranked arena, Fiesta, Protect Yumi).
//
// The bout is a parenthesis, not a rest stop (issue #1600): startArenaMatch
// snapshots what each fighter carried in and returnFromArena hands it back, so a
// match can never be farmed as a free full restore. The fighter's PET was the one
// thing that seam never covered: the arena clean slate stands the FIGHTER back up
// on the way out (returnFromArena sets `dead = false`), but a beast killed on the
// sands, or one dragged down with its owner by the handleDeath owner arm, stayed a
// corpse. A hunter who queued with a living pet went home without one and owed a
// Revive Pet cast for a death the normalized bout inflicted.
//
// This slice owns the MATCH half of that round trip: where the snapshot lives (on
// the ArenaMatch, beside preMatchPools) and when it is taken, refreshed, stamped,
// and applied. The snapshot shape and the two-armed restore itself are shared with
// the owner-resurrection round trip and live in pet/pet_return.ts; read that header
// for why a hunter beast is revived in place while a warlock demon is rebuilt.
//   - snapshotMatchPet: taken at match formation, and only for a LIVING pet (a
//     fighter who queued with a corpse is owed nothing, so the arena can never be a
//     free pet revive). The pet comes back at the hp it walked in at.
//   - noteMatchPetUnravelled: stamped at the corpse-decay unravel in
//     mob/locomotion.ts, the one place that means "the world removed this corpse".
//   - restoreMatchPet: called at the END of the return path, after the fighter is
//     already standing at their queue spot, so the beast is placed beside its owner
//     in the world instead of back on the sands.
//
// `src/sim`-pure and rng-free: no DOM/Three/render/ui/game/net imports, no
// Math.random/Date.now, and no draw sites (the revive is straight-line state).

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { petOf, serializePet } from './pet_commands';
import {
  notePetReturnUnravelled,
  type PetReturnSnapshot,
  restorePetReturn,
  snapshotPetReturn,
} from './pet_return';

/** The pet a fighter walked into a match with: identity, carried hp, rebuild payload. */
export type MatchPetSnapshot = PetReturnSnapshot;

/**
 * Record the LIVING pet a fighter is queueing with, or null when they have none.
 * A pet that is already a corpse is deliberately not recorded: the match owes back
 * only what it took.
 */
export function snapshotMatchPet(ctx: SimContext, ownerPid: number): MatchPetSnapshot | null {
  return snapshotPetReturn(ctx, ownerPid);
}

/**
 * Carry forward harmless pre-fight pet changes that happen after match formation.
 * The countdown can tick passive regen before the gates open, so the return
 * snapshot follows the same living entity into the active bout. Call this before
 * fighter normalization, which can rescale the owner's pet.
 */
export function refreshMatchPetSnapshot(
  ctx: SimContext,
  ownerPid: number,
  snap: MatchPetSnapshot | null | undefined,
): void {
  if (!snap) return;
  const pet = petOf(ctx, ownerPid);
  if (!pet || pet.id !== snap.petId || pet.dead) return;
  const state = serializePet(ctx, ownerPid);
  if (!state) return;
  snap.hp = pet.hp;
  snap.state = state;
}

/**
 * Stamp a fighter's snapshotted pet whose CORPSE has decayed away, so the return
 * path knows a rebuild is owed. Called from the demon arm of updateMob in
 * mob/locomotion.ts; see pet/pet_return.ts for why the rebuild keys on the unravel.
 */
export function noteMatchPetUnravelled(ctx: SimContext, pet: Entity): void {
  if (pet.ownerId === null) return;
  // Both match kinds, because a demon's corpse is the ONLY signal the rebuild
  // arm has: an owner can be in one match at a time, but a lookup that knows
  // about only one of them silently strands the other's demon. That is exactly
  // what happened while the battleground carried no pet round trip at all, and
  // the arm fails quietly (the entity id is simply gone by restore time), so
  // it is worth naming here rather than leaving to the reader.
  const owner = pet.ownerId;
  notePetReturnUnravelled(ctx.arenaMatches.get(owner)?.preMatchPets?.get(owner), pet);
  notePetReturnUnravelled(ctx.bgMatches.get(owner)?.preMatchPets?.get(owner), pet);
}

/**
 * Stand a fighter's pet back up on the way out of a match, at the hp it walked in
 * with, beside its owner. A pet that survived the bout is left exactly as the bout
 * left it, and a pet that is gone for any reason OTHER than the bout killing it is
 * never handed back.
 *
 * Call this AFTER the owner has been placed back at their queue spot, so the pet
 * lands in the world rather than on the sands.
 */
export function restoreMatchPet(
  ctx: SimContext,
  owner: Entity,
  snap: MatchPetSnapshot | null | undefined,
): void {
  restorePetReturn(ctx, owner, snap);
}
