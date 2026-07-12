import type { ResolvedAbility } from '../sim/sim';
import {
  type AbilityEffect,
  FAERIE_FIRE_ARMOR_PCT,
  SUNDER_ARMOR_PCT_PER_STACK,
} from '../sim/types';
import {
  type AbilityScaling,
  abilityBuffValue,
  abilityDamageBonus,
  abilityDurationValue,
  abilityOverTimeEffect,
  abilityPrimaryEffect,
  abilitySecondaryEffect,
} from './ability_damage';
import { tEntity } from './entity_i18n';
import { formatNumber, t } from './i18n';

export function formatAbilityNumber(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 1 });
}

// Fills every description placeholder from the RESOLVED ability: {damage} ($d)
// the primary hit, {overTime} ($o) a hybrid's dot/hot total, {buff} ($b) the
// first buff's value, {duration} ($t) the first timed effect's duration. All are
// rank- and talent-resolved, so the prose can never drift from what a cast does.
export function abilityDisplayDescription(
  res: ResolvedAbility,
  damageText: string,
  scaling?: AbilityScaling,
): string {
  const buff = abilityBuffValue(res);
  const duration = abilityDurationValue(res);
  const chain = res.effects.find((effect) => effect.type === 'chainDamage');
  const gainResource = res.effects.find((effect) => effect.type === 'gainResource');
  const intervalEffect = res.effects.find(
    (effect) => effect.type === 'dot' || effect.type === 'hot' || effect.type === 'groundAoE',
  );
  const radiusEffect = res.effects.find(
    (effect): effect is AbilityEffect & { radius: number } => 'radius' in effect,
  );
  const attackPower = res.effects.find(
    (effect): effect is Extract<AbilityEffect, { type: 'selfBuff' }> =>
      effect.type === 'selfBuff' && effect.kind === 'buff_ap',
  );
  const spellPower = res.effects.find(
    (effect): effect is Extract<AbilityEffect, { type: 'selfBuff' }> =>
      effect.type === 'selfBuff' && effect.kind === 'buff_spellpower',
  );
  const allyHaste = res.effects.find((effect) => effect.type === 'aoeAllyHaste');
  const buffText = allyHaste
    ? formatNumber(allyHaste.mult - 1, { style: 'percent', maximumFractionDigits: 1 })
    : buff === null
      ? ''
      : formatAbilityNumber(buff);
  let description = tEntity({
    kind: 'ability',
    id: res.def.id,
    field: 'description',
    values: {
      damage: damageText,
      overTime: abilityOverTimeText(res, scaling),
      buff: buffText,
      duration: duration === null ? '' : formatAbilityNumber(duration),
      amount: gainResource ? formatAbilityNumber(gainResource.amount) : '',
      interval: intervalEffect ? formatAbilityNumber(intervalEffect.interval) : '',
      radius: radiusEffect ? formatAbilityNumber(radiusEffect.radius) : '',
      jumps: chain ? formatAbilityNumber(chain.jumps) : '',
      falloff: chain
        ? formatNumber(chain.falloff, { style: 'percent', maximumFractionDigits: 1 })
        : '',
      attackPower: attackPower ? formatAbilityNumber(attackPower.value) : '',
      spellPower: spellPower ? formatAbilityNumber(spellPower.value) : '',
    },
  });
  // weaponStrike prose carries its base weapon coefficient as a literal
  // percentage. Talent and mastery damage modifiers scale the resolved
  // weaponMult, so replace that one authored percentage with the live value.
  const resolvedStrike = res.effects.find((effect) => effect.type === 'weaponStrike');
  if (resolvedStrike) {
    const rankEffects =
      res.rank === 1
        ? res.def.effects
        : (res.def.ranks?.find((rank) => rank.rank === res.rank)?.effects ?? res.def.effects);
    const baseStrike = rankEffects.find((effect) => effect.type === 'weaponStrike');
    const baseMult = baseStrike?.weaponMult ?? 1;
    const resolvedMult = resolvedStrike.weaponMult ?? 1;
    const authoredWeaponPercent = /\b\d+(?:\.\d+)?\s*%\s*weapon damage\b/i.test(description);
    if (!authoredWeaponPercent) {
      description = description.replace(
        /\bweapon damage\b/i,
        `${formatNumber(resolvedMult, { style: 'percent', maximumFractionDigits: 1 })} weapon damage`,
      );
    } else if (Math.abs(baseMult - resolvedMult) > 1e-9) {
      const basePercent = formatAbilityNumber(baseMult * 100);
      const escaped = basePercent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      description = description.replace(
        new RegExp(`\\b${escaped}\\s*%`),
        formatNumber(resolvedMult, { style: 'percent', maximumFractionDigits: 1 }),
      );
    }
  }
  return description;
}

// Builds the `$d` damage string for an ability tooltip. When `scaling` (the live
// character's Spell Power / Ranged AP / Attack Power) is given, the BASE damage is
// shown with the scaling contribution called out as a "(+N)" suffix.
export function abilityEffectText(res: ResolvedAbility, scaling?: AbilityScaling): string {
  const suffix = (eff: AbilityEffect) => {
    const bonus = scaling ? abilityDamageBonus(res, eff, scaling) : 0;
    return bonus > 0
      ? ` ${t('hudChrome.abilityScaling.bonus', { value: formatAbilityNumber(bonus) })}`
      : '';
  };
  const primary = abilityPrimaryEffect(res);
  if (primary) {
    switch (primary.type) {
      case 'directDamage':
      case 'chainDamage':
      case 'heal':
      case 'chainHeal':
      case 'aoeDamage':
      case 'aoeHeal':
      case 'aoeRoot':
      case 'groundAoE':
      case 'drainTick':
        return abilityAmountRange(primary.min, primary.max) + suffix(primary);
      case 'consumeAura':
        if (primary.deal) {
          return abilityAmountRange(primary.deal.min, primary.deal.max) + suffix(primary);
        }
        if (primary.heal) {
          return abilityAmountRange(primary.heal.min, primary.heal.max) + suffix(primary);
        }
        return '';
      case 'weaponDamage':
      case 'weaponStrike':
        return formatAbilityNumber(primary.bonus);
      case 'sunder':
        return formatAbilityNumber(
          SUNDER_ARMOR_PCT_PER_STACK * (primary.full ? primary.maxStacks : 1) * 100,
        );
      case 'faerieFire':
        return formatAbilityNumber(FAERIE_FIRE_ARMOR_PCT * 100);
      case 'lifeTap':
        return formatAbilityNumber(primary.hp);
      case 'finisherDamage':
        return (
          t('abilityUi.tooltip.finisherDamage', {
            base: formatAbilityNumber(primary.base),
            perCombo: formatAbilityNumber(primary.perCombo),
          }) + suffix(primary)
        );
    }
  }

  const secondary = abilitySecondaryEffect(res);
  if (!secondary) return '';
  switch (secondary.type) {
    case 'dot':
    case 'hot':
      return formatAbilityNumber(secondary.total) + suffix(secondary);
    case 'absorb':
      return formatAbilityNumber(secondary.amount);
    case 'imbue':
      return formatAbilityNumber(secondary.bonus);
    default:
      return '';
  }
}

function abilityOverTimeText(res: ResolvedAbility, scaling?: AbilityScaling): string {
  const effect = abilityOverTimeEffect(res);
  if (!effect) return '';
  const bonusValue = scaling ? abilityDamageBonus(res, effect, scaling) : 0;
  const bonus =
    bonusValue > 0
      ? ` ${t('hudChrome.abilityScaling.bonus', { value: formatAbilityNumber(bonusValue) })}`
      : '';
  return effect.type === 'groundAoE'
    ? abilityAmountRange(effect.min, effect.max) + bonus
    : formatAbilityNumber(effect.total) + bonus;
}

function abilityAmountRange(min: number, max: number): string {
  if (min === max) return formatAbilityNumber(min);
  return t('abilityUi.tooltip.damageRange', {
    min: formatAbilityNumber(min),
    max: formatAbilityNumber(max),
  });
}
