// Delve pet handling: which pets come along into a delve, and keeping a kept pet
// at its owner's heel across every delve teleport.
//
// A HUNTER's beast and a WARLOCK's demon now fight beside their owner inside a
// delve, alongside the delve companion (Acolyte Tessa on a solo run). The frost
// mage's Water Elemental is still parked in the delvePetStash on entry and handed
// back on exit by stowPetForDelve/restorePetFromDelveStash (pet/pet_commands.ts).
//
// A delve moves its players by teleport (the board door into the first room, room
// to room through the tombstone passages, the in-delve respawn, and every exit back
// to the door). The pet AI's own last-resort warp would eventually catch a stranded
// pet up, but only while it is heeling, and a pet left in the previous room has no
// route through the delve walls. So each of those teleports sets the living pet
// down beside its owner explicitly, in the same tick.
//
// `src/sim`-pure and rng-free: no DOM/Three/render/ui/game/net imports, no
// Math.random/Date.now, and no draw sites.

import { petOf, stowPetForDelve } from '../pet/pet_commands';
import type { SimContext } from '../sim_context';
import type { PlayerClass } from '../types';

/** Where a kept pet lands relative to its owner: the owner's left, mirroring the
 *  delve companion who spawns 1.5 to the owner's right. */
const DELVE_PET_HEEL_OFFSET_X = -1.5;

/** True when this class's pet comes along into a delve instead of being stowed. */
export function delveKeepsPet(cls: PlayerClass): boolean {
  return cls === 'hunter' || cls === 'warlock';
}

/**
 * Entry-time pet handling. Call BEFORE the owner is teleported in: a stowed pet
 * is serialized where it stands. A kept pet is left alone here and follows the
 * owner through bringPetToOwner once they have landed.
 */
export function stowPetUnlessKept(ctx: SimContext, pid: number): void {
  const meta = ctx.players.get(pid);
  if (meta && delveKeepsPet(meta.cls)) return;
  stowPetForDelve(ctx, pid);
}

/**
 * Set the owner's pet down beside them after a delve teleport. Call AFTER the
 * owner's body has been placed. The pet arrives out of combat with no stale route
 * or target, since whatever it was fighting stayed behind. A dead pet's corpse is
 * carried too, so it is never stranded in a room the owner has left (Revive Pet
 * then stands it up where the owner is). Class-agnostic: a pet any class summons
 * inside the delve follows the same way.
 */
export function bringPetToOwner(ctx: SimContext, pid: number): void {
  const owner = ctx.entities.get(pid);
  if (!owner) return;
  const pet = petOf(ctx, pid, true);
  if (!pet) return;
  pet.pos = ctx.groundPos(owner.pos.x + DELVE_PET_HEEL_OFFSET_X, owner.pos.z);
  pet.prevPos = { ...pet.pos };
  pet.facing = owner.facing;
  pet.prevFacing = owner.facing;
  pet.petPath = [];
  pet.petPathCooldown = 0;
  pet.aggroTargetId = null;
  pet.targetId = null;
  pet.autoAttack = false;
  ctx.rebucket(pet);
}
