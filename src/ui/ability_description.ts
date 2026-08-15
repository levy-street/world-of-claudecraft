// The localized ability DESCRIPTION prose every tooltip surface shows, plus the
// placeholder values spliced into it.
//
// Extracted from hud.ts (the monolith ratchet): the description is resolved from
// the RESOLVED ability and the caller's scaling alone, never from the Hud's
// private mutable state, so it is a sibling module the coordinator consumes.
// Both callers (the ability tooltip and the aura tooltip's ability-description
// injector) go through abilityDisplayDescription, and the field CHOICE is a pure
// core (abilityDescriptionField) a vitest drives directly.

import type { ResolvedAbility } from '../sim/sim';
import {
  type AbilityScaling,
  abilityBuffValue,
  abilityDamageBonus,
  abilityDurationValue,
  abilityOverTimeEffect,
  abilityTemporalHourglassValues,
} from './ability_damage';
import { type AbilitySpecNoteField, tEntity, tEntityOptional } from './entity_i18n';
import { formatNumber, type InterpolationValues, t } from './i18n';

/** The tooltip's number format for every ability figure (damage, seconds, costs). */
export function formatAbilityNumber(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 1 });
}

// Builds the `$o` over-time string (a hybrid's dot/hot TOTAL) the same way
// abilityEffectText builds `$d`, including the "(+N)" scaling callout (which the
// bonus helper zeroes for hybrid riders, matching combat's no-double-dip rule).
function abilityOverTimeText(res: ResolvedAbility, scaling?: AbilityScaling): string {
  const eff = abilityOverTimeEffect(res);
  if (!eff) return '';
  const b = scaling ? abilityDamageBonus(res, eff, scaling) : 0;
  const bonus =
    b > 0 ? ` ${t('hudChrome.abilityScaling.bonus', { value: formatAbilityNumber(b) })}` : '';
  if (eff.type === 'dot' && eff.perCombo !== undefined) {
    return (
      t('abilityUi.tooltip.finisherDamage', {
        base: formatAbilityNumber(eff.total),
        perCombo: formatAbilityNumber(eff.perCombo),
      }) + bonus
    );
  }
  return formatAbilityNumber(eff.total) + bonus;
}

/** Which description field the RESOLVED ability should read: the stealth-free
 *  variant once a talent has retired the stealth gate (Cheap Trick on Gut Punch),
 *  the base description otherwise. Pure: the caller resolves the field through
 *  i18n and falls back to 'description' when the active locale has not filled the
 *  variant. */
export function abilityDescriptionField(
  res: ResolvedAbility,
): 'description' | 'descriptionNoStealth' {
  return res.def.requiresStealth === true && res.ignoreStealthRequirement === true
    ? 'descriptionNoStealth'
    : 'description';
}

// Fills every description placeholder from the RESOLVED ability: {damage} ($d)
// the primary hit, {overTime} ($o) a hybrid's dot/hot total, {buff} ($b) the
// first buff's value, {duration} ($t) the first timed effect's duration. All are
// rank- and talent-resolved, so the prose can never drift from what a cast does.
export function abilityDisplayDescription(
  res: ResolvedAbility,
  damageText: string,
  scaling?: AbilityScaling,
  spec?: string | null,
): string {
  const buff = abilityBuffValue(res);
  const duration = abilityDurationValue(res);
  const hourglass = abilityTemporalHourglassValues(res);
  // {rage} splices the RESOLVED gainResource total, so a talent that raises the
  // granted amount (Blood Offering on Blood Toll) shows in the tooltip.
  const rageGained = res.effects.reduce(
    (sum, eff) => sum + (eff.type === 'gainResource' ? eff.amount : 0),
    0,
  );
  const rageText = rageGained > 0 ? formatAbilityNumber(rageGained) : '';
  const values: InterpolationValues = {
    damage: damageText,
    overTime: abilityOverTimeText(res, scaling),
    buff: buff === null ? '' : formatAbilityNumber(buff),
    duration: duration === null ? '' : formatAbilityNumber(duration),
    healing: hourglass === null ? '' : formatAbilityNumber(hourglass.healing),
    selfCooldownRecovery:
      hourglass === null ? '' : formatAbilityNumber(hourglass.selfCooldownRecovery),
    allyCooldownRecovery:
      hourglass === null ? '' : formatAbilityNumber(hourglass.allyCooldownRecovery),
    hostilePveDuration: hourglass === null ? '' : formatAbilityNumber(hourglass.hostilePveDuration),
    hostilePvpDuration: hourglass === null ? '' : formatAbilityNumber(hourglass.hostilePvpDuration),
    groundDuration: hourglass === null ? '' : formatAbilityNumber(hourglass.groundDuration),
    rage: rageText,
  };
  // Cheap Trick retires Gut Punch's stealth requirement. When the RESOLVED ability
  // has dropped it, prefer the stealth-free description variant so the prose stops
  // contradicting the (talent-aware) requirement line, the same way the cost/cast
  // lines already prefer resolved values. A locale that has not TRANSLATED the
  // variant yet resolves null (tEntityOptional declines the English fill) and gets
  // its own base description instead of one English sentence mid-tooltip.
  const stealthFreeVariant =
    abilityDescriptionField(res) === 'descriptionNoStealth'
      ? tEntityOptional({ kind: 'ability', id: res.def.id, field: 'descriptionNoStealth', values })
      : null;
  const text =
    stealthFreeVariant ??
    tEntity({ kind: 'ability', id: res.def.id, field: 'description', values });
  // Spec-aware teaching line: a shared button explains its interaction ONLY
  // for the player's current spec, so a new player never reads another
  // spec's rules on their own tooltip.
  const note = spec ? res.def.specNotes?.[spec] : undefined;
  if (!note) return text;
  return `${text} ${tEntity({
    kind: 'ability',
    id: res.def.id,
    field: `specNote_${spec}` as AbilitySpecNoteField,
  })}`;
}
