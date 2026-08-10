// The shared pet round trip: record the LIVING pet an owner had at the moment
// something took it away, then stand that pet back up beside its owner later.
//
// Two systems owe a pet back, and they owe it for the same reason: the world, not
// the owner, is what killed it.
//   - An arena-shaped match (pet/pet_match_return.ts, issue #1600): the bout is a
//     parenthesis, so a beast that walks in alive walks back out alive.
//   - The owner's own resurrection (pet/pet_owner_revive.ts): the owner's death
//     drags the pet down with it (the handleDeath owner arm), so the resurrection
//     that undoes that death hands the pet back too.
// Both need the same two-armed restore, so it lives here once and each caller
// keeps only its own bookkeeping (where the snapshot is stored, and when it is
// taken, stamped, and consumed).
//
// The restore has TWO arms because a corpse does not mean the same thing to every
// pet class. A hunter's beast and a mage's Water Elemental keep their corpse
// indefinitely (mob/locomotion.ts returns early for any non-demon owned pet), so
// those are revived IN PLACE, same entity. A warlock's demon unravels within
// seconds of dying (handleDeath gives an owned demon corpseTimer 3, then
// despawnPet removes it), so there is nothing left to revive and it is REBUILT
// from the snapshot payload.
//
// The rebuild arm is deliberately the narrow one, and it keys on the UNRAVEL,
// never on the death. A missing entity is not evidence of anything by itself:
// abandonPet accepts a dead pet and drops its entity too, so keying on "it died"
// would hand a hunter back the corpse they deliberately abandoned. Only the
// corpse-decay unravel in mob/locomotion.ts stamps a snapshot, and the rebuild
// additionally refuses when the owner already has a pet standing, so a deliberate
// dismissal or a re-summon is never overwritten.
//
// `src/sim`-pure and rng-free: no DOM/Three/render/ui/game/net imports, no
// Math.random/Date.now, and no draw sites (the revive is straight-line state).

import type { PetState } from '../sim';
import type { SimContext } from '../sim_context';
import { clearThreat } from '../threat';
import type { Entity } from '../types';
import { petOf, restorePet, serializePet } from './pet_commands';

/** The pet an owner had when it was taken: identity, return hp, rebuild payload. */
export interface PetReturnSnapshot {
  /** Entity id of the pet when the snapshot was taken; a different pet never matches. */
  petId: number;
  /** Absolute hp to come back at, used when `hpFraction` is absent. */
  hp: number;
  /**
   * Share of the pet's pool to come back at, resolved against the pool it
   * actually returns to rather than the one it was taken from. A match hands
   * back an absolute hp (the hp it walked in with, an untouched pool); a death
   * cannot, because dying unwinds every stat aura's hp contribution, so the
   * pool at the snapshot is not the pool at the revive.
   */
  hpFraction?: number;
  /** Everything needed to rebuild a pet whose entity does not outlive its death. */
  state: PetState;
  /** Set by notePetReturnUnravelled: the corpse decayed away, so a rebuild is owed. */
  unravelled?: boolean;
}

/**
 * Record the LIVING pet an owner has right now, or null when they have none.
 * A pet that is already a corpse is deliberately not recorded: only what was
 * taken is owed back, so neither a match nor a resurrection is a free pet revive.
 *
 * `hpFraction` (when given) is the share of its pool the pet comes back at;
 * without it the pet comes back at the hp it was carrying.
 */
export function snapshotPetReturn(
  ctx: SimContext,
  ownerPid: number,
  hpFraction?: number,
): PetReturnSnapshot | null {
  const pet = petOf(ctx, ownerPid);
  if (!pet || pet.dead) return null;
  const state = serializePet(ctx, ownerPid);
  if (!state) return null;
  return { petId: pet.id, hp: pet.hp, state, ...(hpFraction !== undefined ? { hpFraction } : {}) };
}

/**
 * Stamp a snapshotted pet whose CORPSE has decayed away. Called from the one site
 * that unravels an owned corpse (the demon arm of updateMob in mob/locomotion.ts):
 * every other way a pet entity can vanish is the owner's own doing, and must not
 * earn a rebuild. Once the entity is gone this is unknowable, so it has to be
 * recorded here rather than inferred at restore time.
 */
export function notePetReturnUnravelled(
  snap: PetReturnSnapshot | null | undefined,
  pet: Entity,
): void {
  if (snap?.petId === pet.id) snap.unravelled = true;
}

/**
 * Stand an owner's pet back up beside them: revived in place while its corpse is
 * still there (hunter beast, mage elemental), rebuilt from the payload when the
 * kill left nothing behind (warlock demon). A pet that is still alive is left
 * exactly as it is, and a pet that is gone for any reason OTHER than the world
 * taking its corpse is never handed back.
 *
 * Call this AFTER the owner has been placed at their destination, so the pet
 * lands beside them rather than wherever they used to be.
 */
export function restorePetReturn(
  ctx: SimContext,
  owner: Entity,
  snap: PetReturnSnapshot | null | undefined,
): void {
  if (!snap) return;
  const pet = ctx.entities.get(snap.petId);
  if (!pet || pet.kind !== 'mob' || pet.ownerId !== owner.id) {
    rebuildPetReturn(ctx, owner, snap);
    return;
  }
  if (!pet.dead) return;
  // Auras are deliberately untouched, exactly like the Revive Pet command: the
  // death already unwound every stat aura's hp contribution and filtered the list
  // to what survives a death by design (aurasSurvivingDeath), so a second pass here
  // would double-unwind maxHp and shed penalties the death was meant to keep.
  pet.dead = false;
  pet.hostile = false;
  pet.aiState = 'idle';
  pet.aggroTargetId = null;
  pet.inCombat = false;
  pet.corpseTimer = 0;
  pet.respawnTimer = 0;
  pet.loot = null;
  pet.lootable = false;
  pet.tappedById = null;
  pet.petManualTauntPending = false;
  pet.petPath = [];
  pet.petPathCooldown = 0;
  clearThreat(pet);
  pet.pos = ctx.groundPos(owner.pos.x + 2, owner.pos.z + 1);
  pet.prevPos = { ...pet.pos };
  ctx.rebucket(pet);
  pet.hp = returnHp(snap, pet.maxHp);
  ctx.emit({
    type: 'log',
    text: `${pet.name} returns to your side.`,
    color: '#8f8',
    pid: owner.id,
  });
}

/**
 * The warlock arm: the snapshotted entity is gone, so rebuild it from the payload
 * through the ordinary load path. Guarded twice over, because this arm CREATES a pet
 * rather than un-killing one. Only a corpse the WORLD took away is owed a rebuild
 * (an entity the owner dropped themselves, by abandoning a beast alive or dead, is
 * not), and never when the owner already has a pet standing (a re-summon is the pet
 * they chose to keep).
 */
function rebuildPetReturn(ctx: SimContext, owner: Entity, snap: PetReturnSnapshot): void {
  if (!snap.unravelled || petOf(ctx, owner.id, true)) return;
  restorePet(ctx, owner, { ...snap.state, dead: false, hp: snap.hp });
  const rebuilt = petOf(ctx, owner.id);
  // restorePet already explains itself when the creature template is gone (a
  // content rename); say nothing extra in that case.
  if (!rebuilt) return;
  // Applied after the rebuild, never before it: restorePet grows the pool by the
  // owner's share, so a fraction is only meaningful against the finished maxHp.
  rebuilt.hp = returnHp(snap, rebuilt.maxHp);
  ctx.emit({
    type: 'log',
    text: `${rebuilt.name} returns to your side.`,
    color: '#8f8',
    pid: owner.id,
  });
}

/** The hp a returning pet lands on, clamped into the pool it is returning to. */
function returnHp(snap: PetReturnSnapshot, maxHp: number): number {
  const want =
    snap.hpFraction !== undefined ? Math.round(maxHp * snap.hpFraction) : Math.round(snap.hp);
  return Math.max(1, Math.min(maxHp, want || maxHp));
}
