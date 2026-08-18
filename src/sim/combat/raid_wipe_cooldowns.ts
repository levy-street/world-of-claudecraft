import type { ResolvedAbility } from '../sim';
import type { Entity } from '../types';

const TWO_MINUTES = 120;
const ARMY_OF_THE_DEAD_ABILITY_ID = 'army_of_the_dead';

export function shouldResetRaidWipeCooldown(abilityId: string, cooldown: number): boolean {
  return abilityId === ARMY_OF_THE_DEAD_ABILITY_ID || cooldown > TWO_MINUTES;
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
