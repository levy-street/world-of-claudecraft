import type { ResolvedAbility } from '../sim';
import type { Entity } from '../types';

const TWO_MINUTES = 120;

export function shouldResetRaidWipeCooldown(_abilityId: string, cooldown: number): boolean {
  return cooldown >= TWO_MINUTES;
}

export function resetLongCooldownsForRaidWipe(
  player: Entity,
  knownAbilities: readonly ResolvedAbility[],
): void {
  for (const ability of knownAbilities) {
    if (!shouldResetRaidWipeCooldown(ability.def.id, ability.cooldown)) continue;
    const cooldownKeys = new Set([ability.def.id, ability.cooldownId ?? ability.def.id]);
    for (const key of cooldownKeys) {
      player.cooldowns.delete(key);
      const charges = player.abilityCharges?.[key];
      if (!charges) continue;
      charges.charges = charges.maxCharges;
      charges.recharge = 0;
      charges.recharges = [];
    }
  }
}
