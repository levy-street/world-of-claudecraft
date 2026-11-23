// Shared live ability prose for aura tooltips, independent of the HUD coordinator.
import type { ResolvedAbility } from '../sim/sim';
import type { Entity } from '../sim/types';
import { abilityScalingOf } from './ability_damage';
import { abilityDisplayDescription, abilityEffectText } from './ability_description';
import type { AuraEffectInput } from './aura_effect';
import { renderAuraTooltipBodyHtml } from './aura_tooltip';
import { esc } from './esc';

export function resolvedAuraTooltipBodyHtml(
  aura: AuraEffectInput & { id?: string },
  player: Entity,
  resolve: (id: string) => ResolvedAbility | null,
  effectHtml: (aura: AuraEffectInput & { id?: string }) => string,
): string {
  if (!aura.id) return effectHtml(aura);
  return renderAuraTooltipBodyHtml<AuraEffectInput & { id: string }>(
    aura as AuraEffectInput & { id: string },
    {
      abilityDescription: (id) => {
        const ability = resolve(id);
        if (!ability) return null;
        const scaling = abilityScalingOf(player);
        return abilityDisplayDescription(
          ability,
          abilityEffectText(ability, scaling),
          scaling,
          aura,
        );
      },
      effectHtml,
      escapeHtml: esc,
    },
  );
}
