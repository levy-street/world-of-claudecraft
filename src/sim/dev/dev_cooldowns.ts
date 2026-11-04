// [dev] Cooldown clearing shared by /dev cooldowns and /dev god (which runs it every
// tick from combat/auras.ts updateTimers). Draws no rng.

import type { Entity } from '../types';

/** [dev] Clears every player cooldown: abilities, GCD, potion, firebottle, and charge pools. */
export function clearCooldownsForDev(entity: Entity, time: number): void {
  entity.cooldowns.clear();
  entity.gcdRemaining = 0;
  entity.potionCooldownUntil = time;
  entity.potionCdRemaining = 0;
  entity.firebottleCdRemaining = 0;
  if (entity.abilityCharges) {
    for (const state of Object.values(entity.abilityCharges)) {
      state.charges = state.maxCharges;
      state.recharges = [];
      state.recharge = 0;
    }
  }
}
