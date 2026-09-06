// Localized tooltip lines for an ability: the cost/cast/cooldown summary and the
// requirement list. Both are pure i18n mappers over resolved ability data with no
// Hud state behind them, so they live beside the HUD rather than inside the
// coordinator (src/ui/CLAUDE.md, module-first). abilityRequirementLines is the
// thin mapper over the pure resolver in hud/action_bar/ability_requirement_keys.ts,
// which owns the truth table incl. the Skulduggery-only stealth-bypass line.

import type { ResolvedAbility } from '../sim/sim';
import type { AbilityDef, ResourceType } from '../sim/types';
import { formatAbilityNumber } from './ability_description';
import { abilityCastLine, resourceDisplayName } from './entity_display_labels';
import {
  type AbilityRequirementResolve,
  abilityRequirementKeys,
} from './hud/action_bar/ability_requirement_keys';
import { t } from './i18n';
import type { TranslationKey } from './i18n.catalog';

// The two druid form labels this module's requirement line needs. A two-entry
// map, kept here beside its only consumer rather than reached back into the Hud.
const FORM_LABEL_KEYS: Record<'bear' | 'cat', TranslationKey> = {
  bear: 'abilityUi.forms.bear',
  cat: 'abilityUi.forms.cat',
};

export function describeAbilitySummary(
  known: ResolvedAbility,
  resourceType: ResourceType | null,
  spellHaste = 0,
): string {
  const parts: string[] = [];
  if (known.cost > 0) {
    parts.push(
      t('abilityUi.tooltip.cost', {
        cost: formatAbilityNumber(known.cost),
        resource: resourceDisplayName(resourceType),
      }),
    );
  }
  if ((known.def.ruinCost ?? 0) > 0) {
    parts.push(
      t('abilityUi.tooltip.ruinCost', {
        cost: formatAbilityNumber(known.def.ruinCost ?? 0),
      }),
    );
  }
  parts.push(abilityCastLine(known, spellHaste));
  // Resolved cooldown (after talent cooldown modifiers), not the base def cooldown.
  if (known.cooldown > 0) {
    parts.push(
      t('abilityUi.tooltip.cooldownSeconds', {
        seconds: formatAbilityNumber(known.cooldown),
      }),
    );
  }
  return parts.join(' · ');
}

// Thin i18n mapper over the pure resolver (ability_requirement_keys.ts), which
// owns the truth table incl. the Skulduggery-only stealth-bypass line.
export function abilityRequirementLines(
  def: AbilityDef,
  spec?: string | null,
  resolved?: AbilityRequirementResolve,
): string[] {
  return abilityRequirementKeys(def, spec, resolved).map((req) => {
    switch (req.key) {
      case 'requiresForm':
        if (req.form) {
          return t('abilityUi.tooltip.requiresForm', { form: t(FORM_LABEL_KEYS[req.form]) });
        }
        return t('abilityUi.tooltip.selfOnly');
      case 'requiresStealth':
        return t('abilityUi.tooltip.requiresStealth');
      case 'requiresStealthSkulduggery':
        return t('abilityUi.tooltip.requiresStealthSkulduggery');
      case 'requiresCombo':
        return t('abilityUi.tooltip.requiresCombo');
      case 'requiresDodge':
        return t('abilityUi.tooltip.requiresDodge');
      case 'requiresOutOfCombat':
        return t('abilityUi.tooltip.requiresOutOfCombat');
      case 'requiresTargetHealthBelow':
        if (req.percent !== undefined) {
          return t('abilityUi.tooltip.requiresTargetHealthBelow', {
            percent: formatAbilityNumber(req.percent),
          });
        }
        return t('abilityUi.tooltip.selfOnly');
      case 'onNextSwing':
        return t('abilityUi.tooltip.onNextSwing');
      case 'offGlobalCooldown':
        return t('abilityUi.tooltip.offGlobalCooldown');
      case 'friendlyTarget':
        return t('abilityUi.tooltip.friendlyTarget');
      case 'enemyTarget':
        return t('abilityUi.tooltip.enemyTarget');
      case 'anyTarget':
        return t('abilityUi.tooltip.anyTarget');
      case 'selfOnly':
        return t('abilityUi.tooltip.selfOnly');
      default:
        return t('abilityUi.tooltip.selfOnly');
    }
  });
}
