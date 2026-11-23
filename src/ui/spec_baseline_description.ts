// Specialization-card display only. Preserve the separate additive ability
// bonuses and the primary-healing multiplier used by the combat resolver.
import { specBaselineFor } from '../sim/content/spec_baselines';
import type { SpecDef, TalentEffect } from '../sim/content/talents';
import { ABILITIES } from '../sim/data';
import { offensiveSpecTuningFor, primaryHealingMultiplier } from '../sim/spec_output_tuning';
import { t } from './i18n';

export interface BaselineEffectLabels {
  physical?: string;
  abilityOutput: ReadonlyMap<string, string>;
}

interface BaselineText {
  noEffect: string;
  statLabels: { damage: string };
  increase: (target: string, amount: string, perRank: string) => string;
}

export function describeSpecBaseline(
  spec: SpecDef,
  text: BaselineText,
  describeEffect: (effect: TalentEffect, labels: BaselineEffectLabels) => string,
  percent: (value: number) => string,
): string | null {
  const baseline = specBaselineFor(spec.class, spec.id);
  const tuning = offensiveSpecTuningFor(spec.class, spec.id);
  const primaryHealing = primaryHealingMultiplier(spec.class, spec.id);
  if (!baseline && !tuning && primaryHealing === 1) return null;

  const global = { ...baseline?.global };
  const extra: string[] = [];
  const physical = tuning?.physical ?? 0;
  const spell = tuning?.spell ?? 0;
  if (physical > 0 && physical === spell && !global.meleeDmgPct && !global.spellDmgPct) {
    extra.push(text.increase(text.statLabels.damage, percent(physical), ''));
  } else {
    if (physical) global.meleeDmgPct = (global.meleeDmgPct ?? 0) + physical;
    if (spell) global.spellDmgPct = (global.spellDmgPct ?? 0) + spell;
  }

  const abilityOutput = new Map<string, string>();
  for (const mod of baseline?.ability ?? []) {
    const effects = ABILITIES[mod.ability]?.effects ?? [];
    if (effects.some((effect) => effect.type === 'absorb')) {
      abilityOutput.set(mod.ability, t('hudChrome.specPanel.absorption'));
    } else if (
      effects.some((effect) => ['heal', 'hot', 'chainHeal', 'aoeHeal'].includes(effect.type))
    ) {
      abilityOutput.set(mod.ability, t('hudChrome.specPanel.healing'));
    }
  }
  const described = describeEffect(
    { ...baseline, global },
    {
      physical:
        spec.class === 'hunter' ? t('hudChrome.specPanel.physicalAbilityDamage') : undefined,
      abilityOutput,
    },
  );
  if (primaryHealing !== 1) {
    extra.push(t('hudChrome.specPanel.primaryHealingBonus', { pct: percent(primaryHealing - 1) }));
  }
  const parts = described === text.noEffect ? extra : [described, ...extra];
  return parts.length > 0 ? parts.join(' ') : null;
}
