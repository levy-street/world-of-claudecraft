// Pure ability-tooltip line builders: the cost/cast/cooldown summary, the
// range and cast lines, the live spell-haste fraction they fold in, and the
// requirement rows. Moved WHOLE from hud.ts at the Phase 10 headroom
// extraction (the monolith ratchet heal) with ONE deliberate behavior delta:
// playerSpellHasteFrac gained the `?? 0` mirror guard (an absent spellHaste
// on a ClientWorld-mirrored entity used to read NaN). These close over no
// Hud state, so a Vitest imports them directly.

import type { ResolvedAbility } from '../sim/sim';
import type { AbilityDef, Entity, ResourceType } from '../sim/types';
import { formatAbilityNumber } from './ability_description';
// The LEAF path on purpose, never the './hud/action_bar' barrel: this module
// is a registered UI_PURE_CORES entry, the barrel re-exports the two action
// bar PAINTERS (painter_host reach one hop away), and the architecture
// guard's forbiddenUiCoreImport matches import specifiers only, so a painter
// reached through a barrel would be invisible to the purity ban. Deep-path
// imports of ability_requirement_keys are the convention at every other
// consumer too.
import {
  type AbilityRequirementResolve,
  abilityRequirementKeys,
} from './hud/action_bar/ability_requirement_keys';
import { type TranslationKey, t } from './i18n';

const RESOURCE_LABEL_KEYS: Record<ResourceType, TranslationKey> = {
  mana: 'abilityUi.resources.mana',
  rage: 'abilityUi.resources.rage',
  energy: 'abilityUi.resources.energy',
  focus: 'abilityUi.resources.focus',
};

const FORM_LABEL_KEYS: Record<'bear' | 'cat', TranslationKey> = {
  bear: 'abilityUi.forms.bear',
  cat: 'abilityUi.forms.cat',
};

export function resourceDisplayName(resourceType: ResourceType | null): string {
  return t(RESOURCE_LABEL_KEYS[resourceType ?? 'mana']);
}

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

export function abilityRangeLine(def: AbilityDef): string | null {
  if (def.range <= 0) return null;
  if (def.minRange !== undefined) {
    return t('abilityUi.tooltip.rangeWithMin', {
      min: formatAbilityNumber(def.minRange),
      max: formatAbilityNumber(def.range),
    });
  }
  return t('abilityUi.tooltip.range', {
    range: formatAbilityNumber(def.range),
  });
}

// The live caster's TOTAL spell-haste fraction: the resolved stat (set bonuses + spec
// mastery) PLUS active buff_spellhaste auras (e.g. Aether Surge, Coldsurge, Lich Form,
// Anointing's target buff).
// Mirrors the sim's spellHasteMult (spell_combat.ts) EXACTLY, including its
// `Math.max(0, ...)` floor, so a shown cast time never disagrees with the real one (a
// net-negative haste, e.g. a cast-slow debuff, floors at 0 for both). ui/ cannot import
// the sim-combat helper across the seam, so the formula is kept identical here by hand.
export function playerSpellHasteFrac(p: Entity | null | undefined): number {
  if (!p) return 0;
  // ?? 0: a mirrored online entity can omit default-zero fields, and an
  // absent spellHaste must read as none, never NaN (which the floor below
  // would pass straight through into a "NaN sec cast" tooltip).
  let frac = p.spellHaste ?? 0;
  for (const a of p.auras) if (a.kind === 'buff_spellhaste') frac += a.value;
  return Math.max(0, frac);
}

// `spellHaste` (the live character's total spell haste, a fraction) shortens the shown
// cast / channel time exactly as the sim does, so a hasted caster's tooltips reflect the
// real, faster cast.
export function abilityCastLine(known: ResolvedAbility, spellHaste = 0): string {
  const h = 1 + Math.max(0, spellHaste);
  if (known.def.channel) {
    return t('abilityUi.tooltip.channeledSeconds', {
      seconds: formatAbilityNumber(known.def.channel.duration / h),
    });
  }
  if (known.castTime > 0) {
    return t('abilityUi.tooltip.castSeconds', {
      seconds: formatAbilityNumber(known.castTime / h),
    });
  }
  return t('abilityUi.tooltip.instant');
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
      case 'selfOnly':
        return t('abilityUi.tooltip.selfOnly');
      default:
        return t('abilityUi.tooltip.selfOnly');
    }
  });
}
