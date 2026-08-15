// Pet return across the owner's own death and resurrection.
//
// A pet does not outlive its owner: the handleDeath player arm routes the owner's
// living pet straight into handleDeath too, so a hunter's beast and a mage's
// elemental are left as corpses and a warlock's demon unravels a few seconds
// later. Nothing ever undid that. Every way back to life (the corpse run, the
// Spirit Healer, a player-cast resurrection, the /unstuck graveyard revive) stood
// the OWNER up alone and left them owing a Revive Pet cast, or, for a warlock, a
// fresh summon with its cost and cooldown, for a death the resurrection had just
// undone. The pet now comes back with them.
//
// This slice owns the OWNER half of the round trip: where the snapshot lives
// (PlayerMeta, session state that dies with the session) and when it is taken,
// stamped, and consumed. The snapshot shape and the two-armed restore are shared
// with the arena-shaped-match round trip and live in pet/pet_return.ts; read that
// header for why a hunter beast is revived in place while a warlock demon is
// rebuilt from a payload, and why the rebuild keys on the corpse UNRAVEL rather
// than on the death.
//   - snapshotPetOnOwnerDeath: taken in the handleDeath owner arm, BEFORE the pet
//     is killed, and only for a LIVING pet. A pet that was already a corpse when
//     its owner fell is owed nothing: that death was not the owner's, so the
//     hunter still owes it the Revive Pet cast they always did, and a resurrection
//     never launders an earlier loss.
//   - notePetUnravelledOnOwnerDeath: stamped at the corpse-decay unravel in
//     mob/locomotion.ts, so a demon that leaves no corpse can still be rebuilt.
//   - restorePetOnOwnerRevive: called at the end of the shared reviveAt in
//     spirit.ts, after the body has been placed, so the pet lands beside its
//     owner wherever the resurrection put them. Every resurrection path funnels
//     through that one function, so all of them hand the pet back.
//
// The pet returns at PET_REVIVE_HP_FRACTION of its pool: exactly what the Revive
// Pet command gives, because that command is precisely the work the resurrection
// is doing for free. Carried as a FRACTION rather than an hp value because dying
// unwinds every stat-aura contribution to the pet's pool, so the pool at the death
// is not the pool it returns to.
//
// `src/sim`-pure and rng-free: no DOM/Three/render/ui/game/net imports, no
// Math.random/Date.now, and no draw sites.

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { PET_REVIVE_HP_FRACTION } from './pet_commands';
import { notePetReturnUnravelled, restorePetReturn, snapshotPetReturn } from './pet_return';

/**
 * Record the living pet an owner's death is about to take. Call from the
 * handleDeath player arm BEFORE the pet is routed into handleDeath itself.
 *
 * Rewritten on EVERY player death, the empty case included: a record left over
 * from an older death must never outlive the pet it described, or a later
 * resurrection could hand back a pet that death never took.
 */
export function snapshotPetOnOwnerDeath(ctx: SimContext, ownerPid: number): void {
  const meta = ctx.players.get(ownerPid);
  if (!meta) return;
  const snap = snapshotPetReturn(ctx, ownerPid, PET_REVIVE_HP_FRACTION);
  if (snap) meta.deathPet = snap;
  else delete meta.deathPet;
}

/**
 * Stamp an owner's snapshotted pet whose corpse has decayed away (the summoned
 * demon that unravels a few seconds after dying), so the resurrection knows a
 * rebuild is owed rather than an in-place revive.
 */
export function notePetUnravelledOnOwnerDeath(ctx: SimContext, pet: Entity): void {
  if (pet.ownerId === null) return;
  notePetReturnUnravelled(ctx.players.get(pet.ownerId)?.deathPet, pet);
}

/**
 * Bring the pet back with its resurrected owner. Call at the END of the shared
 * revive, once the body is standing at its destination, so the pet is placed
 * beside it.
 *
 * The record is consumed exactly once, whatever the restore's two arms decide:
 * the death it describes is over either way, and a leftover record is the one
 * thing that could turn a second resurrection into a free pet.
 */
export function restorePetOnOwnerRevive(ctx: SimContext, owner: Entity): void {
  const meta = ctx.players.get(owner.id);
  if (!meta) return;
  const snap = meta.deathPet;
  if (!snap) return;
  delete meta.deathPet;
  restorePetReturn(ctx, owner, snap);
}
