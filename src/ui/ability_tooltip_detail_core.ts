// The Shift-held "details" block of an ability tooltip: the extra facts a
// player can read on demand without crowding the default tooltip (school,
// which stat the listed bonus comes from, tick cadence, area radius, threat,
// charges, cast mobility). Every line is derived from the RESOLVED ability and
// the live scaling snapshot, never from authored prose, so it cannot drift
// from combat.
//
// Pure and DOM-free (a registered UI_PURE_CORES entry): it returns localized
// strings, and the tooltip view escapes and wraps them.

import { baselinePushbackImmune } from '../sim/combat/pushback_baseline';
import type { ResolvedAbility } from '../sim/sim';
import type { AbilityEffect } from '../sim/types';
import {
  type AbilityScaling,
  abilityDamageBonus,
  abilityOverTimeEffect,
  abilityPrimaryEffect,
  abilityPrimaryHealingTotal,
  abilitySecondaryEffect,
} from './ability_damage';
import { formatAbilityNumber } from './ability_description';
import { primaryDamageTooltipRange } from './dawnreaver_damage_tooltip_core';
import { type TranslationKey, t } from './i18n';

/** The four live ratings an ability bonus can read. */
export type AbilityScalingStat = 'spellPower' | 'healPower' | 'attackPower' | 'rangedPower';

const SCALING_STATS: readonly AbilityScalingStat[] = [
  'spellPower',
  'healPower',
  'attackPower',
  'rangedPower',
];

const STAT_LABEL_KEYS: Record<AbilityScalingStat, TranslationKey> = {
  spellPower: 'hudChrome.abilityTooltipDetail.stat.spellPower',
  healPower: 'hudChrome.abilityTooltipDetail.stat.healPower',
  attackPower: 'hudChrome.abilityTooltipDetail.stat.attackPower',
  rangedPower: 'hudChrome.abilityTooltipDetail.stat.rangedPower',
};

const SCHOOL_KEYS: Record<NonNullable<ResolvedAbility['def']['school']>, TranslationKey> = {
  physical: 'hudChrome.auraEffect.school.physical',
  fire: 'hudChrome.auraEffect.school.fire',
  frost: 'hudChrome.auraEffect.school.frost',
  arcane: 'hudChrome.auraEffect.school.arcane',
  shadow: 'hudChrome.auraEffect.school.shadow',
  holy: 'hudChrome.auraEffect.school.holy',
  nature: 'hudChrome.auraEffect.school.nature',
};

function onlyStat(scaling: AbilityScaling, stat: AbilityScalingStat): AbilityScaling {
  return {
    spellPower: 0,
    healPower: 0,
    attackPower: 0,
    rangedPower: 0,
    auras: scaling.auras,
    [stat]: scaling[stat],
  };
}

/**
 * The stat that produces `eff`'s listed bonus for this character, found by
 * asking the SAME resolver the description uses with one stat kept at a time.
 * Deriving it this way (instead of a second hand-written switch) means the
 * label can never name a stat combat does not read. Null when the effect does
 * not scale or the character has none of the stat it reads.
 */
export function abilityScalingStatFor(
  res: ResolvedAbility,
  eff: AbilityEffect,
  scaling: AbilityScaling,
): AbilityScalingStat | null {
  for (const stat of SCALING_STATS) {
    if (scaling[stat] <= 0) continue;
    if (abilityDamageBonus(res, eff, onlyStat(scaling, stat)) > 0) return stat;
  }
  return null;
}

function scalingLine(
  res: ResolvedAbility,
  eff: AbilityEffect | undefined,
  scaling: AbilityScaling,
): string | null {
  if (!eff) return null;
  // When the description folds the bonus into ONE combined number (a live
  // v0.42 primary-damage or primary-healing factor, or Dawnweave on a prayer),
  // a bare "+bonus" here would not add up to the number above it. Ask the
  // SAME helpers the description asks, so the two can never disagree.
  if (abilityPrimaryHealingTotal(res, eff, scaling) !== null) return null;
  if (
    eff === abilityPrimaryEffect(res) &&
    (res.outputScaling?.primaryDamage ?? 1) !== 1 &&
    primaryDamageTooltipRange(res, eff, scaling) !== null
  ) {
    return null;
  }
  // The description's "(+N)" on a direct hit carries the rank's damageMult.
  const mult = eff.type === 'directDamage' ? (eff.damageMult ?? 1) : 1;
  const bonus = abilityDamageBonus(res, eff, scaling) * mult;
  if (bonus <= 0) return null;
  const stat = abilityScalingStatFor(res, eff, scaling);
  if (!stat) return null;
  return t('hudChrome.abilityTooltipDetail.scaling', {
    bonus: formatAbilityNumber(bonus),
    stat: t(STAT_LABEL_KEYS[stat]),
    value: formatAbilityNumber(scaling[stat]),
  });
}

function periodicLine(eff: AbilityEffect | undefined): string | null {
  // Only auras tick on a plain duration / interval cadence. Ground zones and
  // Frostglobe pulse on their own clocks (a delayed zone skips the on-cast
  // pulse, the orb's timer runs on float DT), so a derived count could be off
  // by one there: those get no tick line rather than a wrong one.
  if (!eff || (eff.type !== 'dot' && eff.type !== 'hot')) return null;
  // A combo-scaled bleed's duration depends on the points spent, so a fixed
  // tick count would be wrong for every finisher but one.
  if (eff.type === 'dot' && eff.perComboDuration !== undefined) return null;
  if (!(eff.interval > 0) || !(eff.duration > 0)) return null;
  const ticks = Math.max(1, Math.round(eff.duration / eff.interval));
  return t('hudChrome.abilityTooltipDetail.ticks', {
    ticks: formatAbilityNumber(ticks),
    interval: formatAbilityNumber(eff.interval),
    duration: formatAbilityNumber(eff.duration),
  });
}

/** The heal half of a damage-and-heal ability, shaped exactly as
 *  abilityDisplayDescription's {healing} splice shapes it. */
function healHalf(res: ResolvedAbility): AbilityEffect | undefined {
  const direct = res.effects.find((eff) => eff.type === 'heal');
  if (direct) return direct;
  const spore = res.effects.find(
    (eff): eff is Extract<AbilityEffect, { type: 'sporeBurst' }> => eff.type === 'sporeBurst',
  );
  return spore
    ? { type: 'aoeHeal', min: spore.healMin, max: spore.healMax, radius: spore.radius }
    : undefined;
}

function radiusLine(res: ResolvedAbility): string | null {
  const area = res.effects.find(
    (eff) =>
      eff.type === 'aoeDamage' ||
      eff.type === 'aoeHeal' ||
      eff.type === 'groundAoE' ||
      eff.type === 'frozenOrb' ||
      eff.type === 'sporeBurst',
  );
  if (!area || !('radius' in area) || !(area.radius > 0)) return null;
  return t('hudChrome.abilityTooltipDetail.radius', { radius: formatAbilityNumber(area.radius) });
}

/**
 * The localized detail lines for one resolved ability, in reading order.
 * Empty when there is nothing beyond the default tooltip to show.
 */
export function abilityTooltipDetailLines(res: ResolvedAbility, scaling: AbilityScaling): string[] {
  const def = res.def;
  const lines: string[] = [];
  const push = (line: string | null) => {
    if (line) lines.push(line);
  };

  if (def.school) {
    push(t('hudChrome.abilityTooltipDetail.school', { school: t(SCHOOL_KEYS[def.school]) }));
  }

  const primary = abilityPrimaryEffect(res) ?? abilitySecondaryEffect(res);
  const overTime = abilityOverTimeEffect(res);
  push(scalingLine(res, primary, scaling));
  if (overTime && overTime !== primary) push(scalingLine(res, overTime, scaling));
  // A damage-and-heal ability's heal half ({healing} in the description:
  // Scouring Mercy's direct heal, Spore Burst's splash heal) reads Healing
  // Power separately; resolve it on the same isolated effect the description
  // uses, so both name the same bonus.
  const heal = healHalf(res);
  if (heal && heal !== primary) {
    push(scalingLine({ ...res, effects: [heal] }, heal, scaling));
  }

  // No channel pulse-count line: the live count can differ from def.channel
  // (Aether Darts fires more darts at full Arcane Charges).
  push(periodicLine(overTime ?? primary));
  push(radiusLine(res));

  // `charges` is already the resolved TOTAL cap (abilitiesKnownAt and
  // applyTalentMods fold bonusCharges into it); an unlearned Talents preview
  // has no entry yet, so fall back to the definition's own cap.
  const charges = res.charges ?? res.def.maxCharges ?? 1;
  if (charges > 1) {
    push(t('hudChrome.abilityTooltipDetail.charges', { charges: formatAbilityNumber(charges) }));
  }

  const hasCastBar = res.castTime > 0 || def.channel !== undefined;
  if (hasCastBar && (res.castWhileMoving || def.castWhileMoving)) {
    push(t('hudChrome.abilityTooltipDetail.castWhileMoving'));
  }
  if (hasCastBar && (res.damagePushbackImmune || baselinePushbackImmune(def))) {
    push(t('hudChrome.abilityTooltipDetail.pushbackImmune'));
  }

  if (res.threatMult > 0 && res.threatMult !== 1) {
    push(
      t('hudChrome.abilityTooltipDetail.threatMult', {
        percent: formatAbilityNumber(Math.round(res.threatMult * 100)),
      }),
    );
  }
  if (res.threatFlat > 0) {
    push(
      t('hudChrome.abilityTooltipDetail.threatFlat', {
        threat: formatAbilityNumber(res.threatFlat),
      }),
    );
  }
  return lines;
}
