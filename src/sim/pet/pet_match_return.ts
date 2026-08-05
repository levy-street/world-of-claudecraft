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
// This slice owns the three parts of that round trip and nothing else:
//   - snapshotMatchPet: taken at match formation, records the pet ENTITY ID, the hp
//     it walked in at, and a full rebuild payload, and only for a LIVING pet (a
//     fighter who queued with a corpse is owed nothing, so the arena can never be a
//     free pet revive).
//   - noteMatchPetUnravelled: stamped at the corpse-decay unravel in
//     mob/locomotion.ts, the one place that means "the world removed this corpse".
//   - restoreMatchPet: called at the END of the return path, after the fighter is
//     already standing at their queue spot, so the beast is placed beside its owner
//     in the world instead of back on the sands.
//
// Every pet class is covered, but by two different arms, because a corpse does not
// mean the same thing to each. A hunter's beast and a mage's Water Elemental keep
// their corpse indefinitely (mob/locomotion.ts returns early for any non-demon owned
// pet), so those are revived IN PLACE, same entity. A warlock's demon unravels within
// seconds of dying (handleDeath gives an owned demon corpseTimer 3, then despawnPet
// removes it), so there is nothing left to revive and it is REBUILT from the payload.
//
// The rebuild arm is deliberately the narrow one, and it keys on the UNRAVEL, never
// on the death. A missing entity is not evidence of anything by itself: abandonPet
// accepts a dead pet and drops its entity too, so keying on "the bout killed it"
// would hand a hunter back the corpse they deliberately abandoned mid-bout. Only
// the corpse-decay unravel in mob/locomotion.ts stamps the snapshot, and the
// rebuild additionally refuses when the owner already has a pet standing.
//
// `src/sim`-pure and rng-free: no DOM/Three/render/ui/game/net imports, no
// Math.random/Date.now, and no draw sites (the revive is straight-line state).

import type { PetState } from '../sim';
import type { SimContext } from '../sim_context';
import { clearThreat } from '../threat';
import type { Entity } from '../types';
import { petOf, restorePet, serializePet } from './pet_commands';

/** The pet a fighter walked into a match with: identity, carried hp, rebuild payload. */
export interface MatchPetSnapshot {
  /** Entity id of the pet at match formation; a different pet never matches. */
  petId: number;
  /** Hp at match formation, restored if the bout killed it. */
  hp: number;
  /** Everything needed to rebuild a pet whose entity does not outlive its death. */
  state: PetState;
  /** Set by noteMatchPetUnravelled: the corpse decayed away, so a rebuild is owed. */
  unravelled?: boolean;
}

/**
 * Record the LIVING pet a fighter is queueing with, or null when they have none.
 * A pet that is already a corpse is deliberately not recorded: the match owes back
 * only what it took.
 */
export function snapshotMatchPet(ctx: SimContext, ownerPid: number): MatchPetSnapshot | null {
  const pet = petOf(ctx, ownerPid);
  if (!pet || pet.dead) return null;
  const state = serializePet(ctx, ownerPid);
  if (!state) return null;
  return { petId: pet.id, hp: pet.hp, state };
}

/**
 * Stamp a snapshotted pet whose CORPSE has decayed away. Called from the one site
 * that unravels an owned corpse (the demon arm of updateMob in mob/locomotion.ts):
 * every other way a pet entity can vanish mid-bout is the owner's own doing, and
 * must not earn a rebuild. Once the entity is gone this is unknowable, so it has to
 * be recorded here rather than inferred at return time.
 */
export function noteMatchPetUnravelled(ctx: SimContext, pet: Entity): void {
  if (pet.ownerId === null) return;
  const snap = ctx.arenaMatches.get(pet.ownerId)?.preMatchPets?.get(pet.ownerId);
  if (snap?.petId === pet.id) snap.unravelled = true;
}

/**
 * Stand a fighter's pet back up on the way out of a match, at the hp it walked in
 * with, beside its owner: revived in place while its corpse is still there (hunter
 * beast, mage elemental), rebuilt from the payload when the bout's kill left nothing
 * behind (warlock demon). A pet that survived the bout is left exactly as the bout
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
  if (!snap) return;
  const pet = ctx.entities.get(snap.petId);
  if (!pet || pet.kind !== 'mob' || pet.ownerId !== owner.id) {
    rebuildMatchPet(ctx, owner, snap);
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
  pet.hp = Math.max(1, Math.min(pet.maxHp, Math.round(snap.hp) || pet.maxHp));
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
 * not), and never when the owner already has a pet standing (a mid-bout re-summon is
 * the pet they chose to keep).
 */
function rebuildMatchPet(ctx: SimContext, owner: Entity, snap: MatchPetSnapshot): void {
  if (!snap.unravelled || petOf(ctx, owner.id, true)) return;
  restorePet(ctx, owner, { ...snap.state, dead: false, hp: snap.hp });
  const rebuilt = petOf(ctx, owner.id);
  // restorePet already explains itself when the creature template is gone (a
  // content rename); say nothing extra in that case.
  if (!rebuilt) return;
  ctx.emit({
    type: 'log',
    text: `${rebuilt.name} returns to your side.`,
    color: '#8f8',
    pid: owner.id,
  });
}
