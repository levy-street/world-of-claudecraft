// The battleground corpse hold: keep an owned demon corpse from unravelling
// while a dead fighter inside an ACTIVE match is still owed exactly this pet
// back on the next respawn wave.
//
// Why: waves run every BG_WAVE_PERIOD (10s) but an owned demon corpse decays
// 3s after death (the demon arm of updateMob in mob/locomotion.ts), so almost
// every wave found the corpse already gone and restorePetReturn took the
// REBUILD arm: a brand-new entity id per wave, per warlock. Each rebuild made
// every nearby client drop its old character view and mint a fresh one (entity,
// rig, nameplate, wire spawn) for what is visually the same demon, a steady
// main-thread hitch source on event evenings. Holding the corpse makes the
// revive-in-place arm apply instead: same entity, same client view, no churn,
// and identical player-visible behavior to a death that lands within 3s of the
// wave today. The consult sits in the shared owned demon/undead unravel branch,
// so a temporary necromancy undead is held on exactly the same terms as a
// demon: deliberate, the wave owes it back the same way.
//
// The hold is deliberately NARROW, mirroring the pet_return keying doctrine
// (only what the world took is owed back):
// - only while the owner is DEAD: the moment they are raised the restore has
//   already consumed the snapshot, and any corpse still standing resumes decay;
// - only while the owner's deathPet snapshot names THIS corpse: a pet that was
//   already dead when its owner fell, or one the owner dropped themselves, was
//   never owed and is never held;
// - only inside a match in the 'active' state: desertion, the end-of-match
//   result hold, and the open world all decay exactly as before.
// Within those bounds the hold has no clock of its own: an unreleased corpse
// holds its demon until the owner is raised or the match leaves 'active'. That
// is deliberate, not an oversight, and the obvious tightening (gate the hold
// on owner.ghost) is wrong: the wave raises only RELEASED spirits, and the
// release press is the player's own, on their own time (no in-match
// auto-release exists; only relog releases for you). A ghost gate would hand
// the reuse only to owners who press Release inside the corpse's 3s window
// and drop everyone slower straight back onto the rebuild arm this module
// exists to remove. Inside a match the wave is also nearly the only way up:
// player-cast resurrection, the corpse run, and the Spirit Healer all refuse
// seated fighters (combat/resurrection_offer.ts, spirit.ts); only the
// /unstuck revive arm also reaches reviveAt. The clockless hold is still
// bounded in practice: BG_END_HOLD (15s) dwarfs the 3s corpse window, so a
// fighter who never releases always unravels during the result screen and
// the match-end path sees the pre-hold shape; the paths that can reach
// restoreMatchPet with the corpse still standing (the deserter arm and the
// immediate forfeit teardown) both land on the revive-in-place arm hunter
// beasts already take there.
// The demon corpse lying beside its owner's own corpse is coherent for
// exactly as long as that owner stays down.
//
// The caller FREEZES corpseTimer rather than gating only the unravel: the wire
// mirrors corpse decay as a flag keyed on corpseTimer (server/game.ts `cd`,
// consumed by entityViewIsAdmitted), so a decayed read would make every client
// drop the corpse's view mid-hold and rebuild it at the wave, which is the
// exact churn the hold exists to remove.
//
// `src/sim`-pure and rng-free: no DOM/Three/render/ui/game/net imports, no
// Math.random/Date.now, and no draw sites (a read-only predicate).

import type { SimContext } from '../sim_context';
import { bgActiveSeatedFighter } from '../social/battleground';
import type { Entity } from '../types';

/**
 * True while `pet`'s corpse must be held for a battleground respawn wave to
 * revive in place: it is a CORPSE whose owner is a dead fighter in an ACTIVE
 * match and whose owner-death snapshot still names this exact pet. A living
 * pet is never held (guarded here, not only at the call site, because this is
 * an exported predicate and a second caller must get the same answer).
 */
export function holdPetCorpseForBgWave(ctx: SimContext, pet: Entity): boolean {
  if (!pet.dead || pet.ownerId === null) return false;
  const owner = ctx.entities.get(pet.ownerId);
  if (owner?.kind !== 'player' || !owner.dead) return false;
  const snap = ctx.players.get(owner.id)?.deathPet;
  if (!snap || snap.petId !== pet.id || snap.unravelled) return false;
  // This runs per tick for every held corpse AND for the whole 3s decay
  // window of an open-world warlock death, so the seated fast path (which
  // allocates nothing) is used over the general bgActiveMatchForFighter
  // helper; a stale index entry simply fails the hold and the corpse decays
  // exactly as before the hold existed.
  return bgActiveSeatedFighter(ctx, owner.id);
}
