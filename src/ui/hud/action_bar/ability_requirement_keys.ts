// Pure, host-agnostic resolver for an ability tooltip's requirement lines
// (the dim "Requires ..." rows under the description). hud.ts is the thin
// consumer (abilityRequirementLines) that maps each descriptor to its
// abilityUi.tooltip.* string; this lives on its own so a Vitest can pin the
// truth table (notably the spec-scoped stealth line) without pulling in the
// DOM/Three HUD module.
//
// Spec scoping: the Gloam / Shadow Veil stealth bypass is Skulduggery-only
// aura state (rogue_engines.gloamBankArmed / veilAllowsStealthAbilities), so
// ONLY that spec's tooltips mention it. Every other rogue spec, an unspecced
// rogue, and a stalking druid read a plain stealth requirement (owner ruling
// 2026-07-29: a tooltip never shows another spec's mechanics).
import type { AbilityDef } from '../../../sim/types';
import { isSelfOnlyAbility } from './ability_self_only';

export interface AbilityRequirementKey {
  key:
    | 'requiresForm'
    | 'requiresStealth'
    | 'requiresStealthSkulduggery'
    | 'requiresCombo'
    | 'requiresDodge'
    | 'requiresOutOfCombat'
    | 'requiresTargetHealthBelow'
    | 'onNextSwing'
    | 'offGlobalCooldown'
    | 'friendlyTarget'
    | 'enemyTarget'
    | 'selfOnly';
  /** Set only for key 'requiresForm'. */
  form?: NonNullable<AbilityDef['requiresForm']>;
  /** Set only for key 'requiresTargetHealthBelow' (already a 0-100 percent). */
  percent?: number;
}

export function abilityRequirementKeys(
  def: AbilityDef,
  spec?: string | null,
): AbilityRequirementKey[] {
  const out: AbilityRequirementKey[] = [];
  if (def.requiresForm) out.push({ key: 'requiresForm', form: def.requiresForm });
  if (def.requiresStealth) {
    out.push({
      key:
        def.class === 'rogue' && spec === 'subtlety'
          ? 'requiresStealthSkulduggery'
          : 'requiresStealth',
    });
  }
  if (def.spendsCombo) out.push({ key: 'requiresCombo' });
  if (def.requiresDodgeProc) out.push({ key: 'requiresDodge' });
  if (def.requiresOutOfCombat) out.push({ key: 'requiresOutOfCombat' });
  // Both execute-window fields surface the same player-facing requirement; only
  // the boundary differs (executeThreshold is strict, requiresTargetHpBelow is
  // at-or-below), so reading one and not the other silently hid the requirement
  // on every strict-threshold ability.
  const executeWindowPct = def.executeThreshold ?? def.requiresTargetHpBelow;
  if (executeWindowPct !== undefined) {
    out.push({ key: 'requiresTargetHealthBelow', percent: executeWindowPct * 100 });
  }
  if (def.onNextSwing) out.push({ key: 'onNextSwing' });
  if (def.offGcd) out.push({ key: 'offGlobalCooldown' });
  if (def.targetType === 'friendly') out.push({ key: 'friendlyTarget' });
  else if (def.requiresTarget) out.push({ key: 'enemyTarget' });
  else if (isSelfOnlyAbility(def)) out.push({ key: 'selfOnly' });
  return out;
}
