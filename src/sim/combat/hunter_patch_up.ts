// Patch Up (hunter, ability id 'revive_pet'). A living companion regains 10%
// of its maximum health every second for 8 sec (80% in all); a dead one is revived with
// 50% health instead. The numbers are shares of the pet's own pool, so they
// live here rather than as a flat hot total on the ability def. Draws no rng.

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export const PATCH_UP_HEAL_PCT_PER_TICK = 0.1;
export const PATCH_UP_TICK_INTERVAL = 1;
export const PATCH_UP_DURATION = 8;
export const PATCH_UP_REVIVE_HP_PCT = 0.5;

/** Resolves a finished Patch Up cast on the hunter's pet (alive or dead). */
export function applyPatchUp(
  ctx: SimContext,
  hunter: Entity,
  pet: Entity,
  ability: { id: string; name: string; school: Entity['auras'][number]['school'] },
): void {
  if (pet.dead) {
    ctx.revivePet(hunter.id);
    // revivePet restores the shared 35% return; Patch Up brings the pet back
    // stronger. Only raise it, and only when the revive actually happened.
    if (!pet.dead) {
      pet.hp = Math.max(pet.hp, Math.round(pet.maxHp * PATCH_UP_REVIVE_HP_PCT));
    }
    return;
  }
  ctx.applyAura(pet, {
    id: ability.id,
    name: ability.name,
    kind: 'hot',
    remaining: PATCH_UP_DURATION,
    duration: PATCH_UP_DURATION,
    value: Math.max(1, Math.round(pet.maxHp * PATCH_UP_HEAL_PCT_PER_TICK)),
    tickInterval: PATCH_UP_TICK_INTERVAL,
    tickTimer: PATCH_UP_TICK_INTERVAL,
    sourceId: hunter.id,
    school: ability.school,
  });
}
