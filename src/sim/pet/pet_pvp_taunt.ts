// PvP pet taunt: a tank pet's taunt (its in-combat Growl autocast or the owner's
// /pettaunt) turns a hostile PLAYER's selected target onto the pet.
//
// Against a mob, a taunt rewrites the mob's threat table and forced target
// (Sim.applyTaunt). A player has neither: their selection is their own, so before
// this module a pet's taunt on a player did nothing at all. Here it switches the
// player's target to the pet through the ordinary target-selection entry
// (ctx.targetEntity), so it follows the same rules as a click: a follow ends,
// auto-attack carries over onto the pet, and the
// stop-auto-attack-on-target-switch setting is honored. The switch is
// deliberately one-shot, never a lock: the player can retarget at once, so the
// taunt costs them that retarget (a tactical peel), not control of their
// character. A cast already in progress keeps its own castTargetId and lands
// where it was aimed.
//
// Scope: only where the pet is hostile to the player (duels, arenas,
// battlegrounds, flagged World PvP), at the pet's existing 10 sec taunt cadence
// (PET_GROWL_INTERVAL). The taunt-eligibility gate (pet_taunt_gate.ts) still
// decides which pets taunt at all, so ranged pets never do.

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

const PVP_TAUNT_COLOR = '#ff9966';

/** True when `pet` may taunt `target` as a player: a living, hostile player. */
export function canPetTauntPlayer(ctx: SimContext, pet: Entity, target: Entity): boolean {
  return (
    target.kind === 'player' &&
    !target.dead &&
    pet.ownerId !== null &&
    target.id !== pet.ownerId &&
    ctx.isHostileTo(pet, target)
  );
}

/**
 * Switch a hostile player's target onto the taunting pet. Returns true when the
 * switch happened (the caller then starts the taunt cooldown). Returns false when
 * the player is not a valid PvP taunt target or is ALREADY targeting the pet, so
 * an autocast is saved for the moment they look away instead of being spent on
 * nothing.
 */
export function applyPetPvpTaunt(ctx: SimContext, pet: Entity, target: Entity): boolean {
  if (!canPetTauntPlayer(ctx, pet, target)) return false;
  if (target.targetId === pet.id) return false;
  ctx.targetEntity(pet.id, target.id);
  if (target.targetId !== pet.id) return false;
  ctx.emit({
    type: 'log',
    text: `${pet.name} taunts you: your target switches to it.`,
    color: PVP_TAUNT_COLOR,
    pid: target.id,
  });
  if (pet.ownerId !== null) {
    ctx.emit({
      type: 'log',
      text: `${pet.name} taunts ${target.name}: their target switches to it.`,
      color: PVP_TAUNT_COLOR,
      pid: pet.ownerId,
    });
  }
  return true;
}
