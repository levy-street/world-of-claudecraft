import { sentenceEndgameDamageMultiplier } from '../../src/sim/combat/affliction';
import {
  DAGGER_NORMALIZED_SPEED,
  ONE_HAND_NORMALIZED_SPEED,
} from '../../src/sim/combat/form_swing';
import type { ResolvedAbility } from '../../src/sim/resolved_ability';
import { HEALING_SP_SCALE } from '../../src/sim/spell_scaling';
import {
  type AbilityEffect,
  MELEE_SPELL_AP_SCALE,
  RANGED_SPELL_AP_SCALE,
  SPELL_AOE_COEFF_MULT,
  SPELL_COEFF_DIVISOR,
  SPELL_COEFF_MAX_CAST,
  SPELL_COEFF_MIN_CAST,
  SPELL_DOT_COEFF_DURATION,
} from '../../src/sim/types';
import { auraEffectDescriptor } from '../../src/ui/aura_effect';
import { type TranslationKey, t } from '../../src/ui/i18n';
import { type Factor, frac, math, scaledStat } from './math_markup';

const pct = (v: number) => `${Number((v * 100).toFixed(6))}%`;
const range = (min: number, max: number) => (min === max ? String(min) : `${min} to ${max}`);
// The power bonus is rounded on its own and then added to the base roll.
// The bonus chip follows the base number: "42 to 51 (+ 85.7% Healing Power)."
const add = (formula: string) => `${formula}.`;
type Scaled = { stat: string; factors: Factor[] };

// Keep the quotients intact: 1.5 / 3.5 is exact, while a truncated percentage
// can reproduce a different rounded hit. The spellbook supplies the base prose.
export function abilityScalingLines(res: ResolvedAbility): string[] {
  const def = res.def;
  const ranged = def.scalesWith === 'ranged';
  const physical = def.school === 'physical';
  const attack = ranged ? 'Ranged Attack Power' : physical ? 'Attack Power' : 'Spell Power';
  const power: Scaled = {
    stat: attack,
    factors: ranged ? [RANGED_SPELL_AP_SCALE] : physical ? [MELEE_SPELL_AP_SCALE] : [],
  };
  const castFraction = (t: number): Factor => ({
    frac: [Math.min(SPELL_COEFF_MAX_CAST, Math.max(SPELL_COEFF_MIN_CAST, t)), SPELL_COEFF_DIVISOR],
  });
  const direct = (s: Scaled, aoe: boolean, override?: number) =>
    scaledStat(s.stat, [
      ...s.factors,
      override ?? castFraction(res.castTime),
      ...(aoe ? [SPELL_AOE_COEFF_MULT] : []),
    ]);
  const channel = (s: Scaled) =>
    scaledStat(s.stat, [
      ...s.factors,
      castFraction(def.channel!.duration),
      { div: def.channel!.ticks },
    ]);
  const heal: Scaled = { stat: 'Healing Power', factors: [HEALING_SP_SCALE] };
  const tick = (s: Scaled, interval: number) =>
    scaledStat(s.stat, [...s.factors, { frac: [interval, SPELL_DOT_COEFF_DURATION] }]);
  // Attack Power turns into damage at 14 per second of swing (28 for pets).
  const apPart = (per: number, who = 'your total Attack Power') => math(frac(who, per));
  function describe(e: AbilityEffect): string[] {
    switch (e.type) {
      case 'directDamage':
      case 'drainTick':
      case 'aoeDamage':
      case 'aoeRoot':
      case 'chainDamage':
      case 'groundAoE':
      case 'sporeBurst': {
        if (e.type === 'groundAoE' && e.allyBuffPct !== undefined)
          return [
            `Each pulse gives allies within ${e.radius} yd ${pct(e.allyBuffPct)} more damage.`,
          ];
        const area = e.type !== 'directDamage' && e.type !== 'drainTick';
        const formula = def.channel
          ? channel(power)
          : direct(power, area, e.type === 'directDamage' ? e.spellPowerCoeff : undefined);
        const label =
          e.type === 'chainDamage'
            ? 'Damage to the first target'
            : def.channel || e.type === 'groundAoE'
              ? 'Damage per pulse'
              : 'Damage';
        const lines = [`${label} is ${range(e.min, e.max)} ${add(formula)}`];
        if ('damageMult' in e && e.damageMult !== undefined && e.damageMult !== 1)
          lines.push(`Then multiply that total by ${e.damageMult}.`);
        if ('radius' in e) lines.push(`Radius: ${e.radius} yd.`);
        if (e.type === 'chainDamage')
          lines.push(
            `It jumps to up to ${e.jumps} more targets. Each jump deals ${pct(e.falloff)} of the damage of the jump before it.`,
          );
        if (e.type === 'groundAoE')
          lines.push(
            `It pulses every ${e.interval} sec for ${e.duration} sec. The first pulse happens ${e.delayed ? e.interval + ' sec after you place it' : 'as soon as you place it'}.`,
          );
        if (e.type === 'aoeDamage' && e.softCap)
          lines.push(
            `If it hits more than ${e.softCap} targets, each hit is multiplied by ${e.softCap} divided by the number of targets.`,
          );
        if (e.type === 'aoeDamage' && e.rageOnHit)
          lines.push(
            `Using it gives you ${e.rageOnHit.base} Rage, plus ${e.rageOnHit.perTarget} more for each target hit. Only the first ${e.rageOnHit.capTargets} targets count.`,
          );
        if (e.type === 'drainTick')
          lines.push(`Each tick heals you for ${pct(e.healFrac)} of the damage it deals.`);
        if (e.type === 'sporeBurst')
          lines.push(
            `Heals each ally for ${range(e.healMin, e.healMax)} ${add(direct(heal, true))}`,
          );
        if (e.type === 'directDamage' && e.vsRootedMult)
          lines.push(`If the target is rooted, this hit is multiplied by ${e.vsRootedMult}.`);
        return lines;
      }
      case 'heal':
      case 'aoeHeal':
      case 'chainHeal': {
        if (e.type === 'heal' && e.casterMaxHpPct !== undefined)
          return [
            `Heals for ${pct(e.casterMaxHpPct)} of your maximum health, rounded to the nearest whole number.`,
          ];
        const amount = def.channel
          ? channel({ stat: 'Healing Power', factors: [] })
          : direct(heal, e.type === 'aoeHeal');
        const lines = [
          `Healing${def.channel ? ' per pulse' : ''} is ${range(e.min, e.max)} ${add(amount)}`,
        ];
        if (e.type === 'chainHeal')
          lines.push(
            `It jumps up to ${e.jumps} times. Each jump can reach ${e.radius} yd. Each jump heals for ${pct(e.falloff)} of the heal before it.`,
          );
        return lines;
      }
      case 'hot':
      case 'dot': {
        const isHeal = e.type === 'hot';
        const hybrid = res.effects.some((x) =>
          isHeal
            ? x.type === 'heal'
            : ['directDamage', 'chainDamage', 'aoeDamage', 'aoeRoot'].includes(x.type),
        );
        let base = String(e.total);
        if (e.type === 'hot' && e.pctOfMax !== undefined)
          base = `${pct(e.pctOfMax)} of the target's maximum health, rounded to a whole number`;
        if (e.type === 'dot') {
          if (e.directPct !== undefined)
            base = `${pct(e.directPct)} of the damage from the instant hit, rounded to a whole number`;
          if (e.perComboTotal !== undefined)
            base = `${e.baseTotal ?? 0} + ${e.perComboTotal} per combo point spent`;
          if (e.perCombo !== undefined) base = `${e.total} + ${e.perCombo} per combo point spent`;
        }
        const duration =
          e.type === 'dot' && e.perComboDuration
            ? `${e.baseDuration ?? 0} + ${e.perComboDuration} per combo point spent`
            : e.duration;
        const lines = [
          `Each ${isHeal ? 'healing' : 'damage'} tick is (${base}) divided by ${e.duration / e.interval}. It is rounded to the nearest whole number, and is always at least 1. It ticks every ${e.interval} sec for ${duration} sec.`,
        ];
        lines.push(
          hybrid
            ? 'Only the instant part gets the power bonus. The ticks over time do not get one of their own.'
            : `Every tick also gets ${tick(isHeal ? heal : power, e.interval)}.`,
        );
        return lines;
      }
      case 'absorb':
      case 'aoeAllyAbsorb': {
        const parts = [String(e.amount)];
        if (e.type === 'absorb' && e.casterMaxHpPct)
          parts.push(`${pct(e.casterMaxHpPct)} of your maximum health`);
        if (e.spellPowerCoeff) parts.push(`${pct(e.spellPowerCoeff)} of your Healing Power`);
        return [
          `Each shield absorbs ${parts.join(' plus ')} damage. Each part is rounded to a whole number. The shield lasts up to ${e.duration} sec.`,
        ];
      }
      case 'absorbSpentResource':
        return [
          `The shield absorbs ${e.mult} times the amount of resource you spent. It lasts ${e.duration} sec.`,
        ];
      case 'finisherDamage':
        return [
          `Damage is ${e.base}, plus ${e.perCombo} per combo point, plus a random 0 to ${e.variance}, plus ${apPart(14)}. Armor reduces this physical hit.`,
        ];
      case 'weaponStrike':
      case 'weaponDamage': {
        const mult = e.type === 'weaponStrike' ? (e.weaponMult ?? 1) : 1;
        const lines = [
          `Deals ${pct(mult)} of a weapon swing, plus ${e.bonus} extra damage. A weapon swing is your weapon's damage roll plus ${math(frac('your total Attack Power', 14) + ' × your swing speed in seconds')}.`,
        ];
        if (e.type === 'weaponStrike' && e.normalized)
          lines.push(
            `For this strike, the weapon roll and the Attack Power part are worked out as if your swing speed were ${DAGGER_NORMALIZED_SPEED} sec for a dagger or ${ONE_HAND_NORMALIZED_SPEED} sec for any other weapon.`,
          );
        return lines;
      }
      case 'hunterBearTrap':
      case 'hunterBloodhook':
        return [
          `The bleed total is ${e.bleedTotal} plus ${pct(e.rangedPowerCoeff)} of your Ranged Attack Power${e.type === 'hunterBloodhook' && e.damageMult ? ', then multiplied by ' + e.damageMult : ''}. It is locked in when the bleed starts. The total is split into ${e.bleedDuration / e.bleedInterval} ticks, ${e.bleedInterval} sec apart.`,
        ];
      case 'hunterStampede':
        return [
          `Each of the ${e.beasts} beasts attacks every ${e.attackInterval} sec for ${e.duration} sec. Each attack deals ${range(e.min, e.max)} plus ${pct(e.rangedPowerCoeff)} of your Ranged Attack Power. Your pet damage bonus and Ferocity multiply that damage. They are locked in when the beasts are summoned.`,
        ];
      case 'selfBuff':
      case 'buffTarget': {
        const effect = auraEffectDescriptor({
          id: def.id,
          kind: e.kind,
          value: e.value,
          value2: e.value2,
          school: def.school,
        });
        if (!effect || def.tooltipOmitEffectLines) return [];
        const line = t(effect.key as TranslationKey, { ...effect.nums, school: def.school });
        // Catalog effect lines may end without a full stop; add one before the duration.
        return [
          (/[.!?]$/.test(line) ? line : line + '.') +
            ('permanent' in e && e.permanent
              ? ' Stays on until removed.'
              : e.duration > 0
                ? ' Lasts ' + e.duration + ' sec.'
                : ''),
        ];
      }
      case 'frozenOrb':
        return [
          `The orb travels for ${e.duration} sec. Every ${e.interval} sec, it hits enemies within ${e.radius} yd for ${range(e.min, e.max)} ${add(direct(power, true))} The power bonus is locked in when you release the orb.`,
        ];
      case 'empoweredCone':
        return e.stages.map(
          (s, i) =>
            `Charge stage ${i + 1} reaches ${s.range} yd and deals ${range(s.min, s.max)} ${add(scaledStat(power.stat, [...power.factors, castFraction((res.castTime * (i + 1)) / e.stages.length), SPELL_AOE_COEFF_MULT]))}${e.guaranteedCritLevel === i + 1 ? ' It is always a critical hit.' : ''}${s.rootDuration ? ' Roots for ' + s.rootDuration + ' sec.' : ''}${s.incapacitateDuration ? ' Incapacitates for ' + s.incapacitateDuration + ' sec. Diminishing returns can make this shorter.' : ''}`,
        );
      case 'valkyrsCalling':
        return [
          `When you land, each enemy in line of sight within ${e.radius} yd takes ${range(e.min, e.max)} damage. If more than ${e.softCap} enemies are hit, each roll is multiplied by ${e.softCap} divided by the number of enemies hit, then rounded. Spell Power does not add to this damage.`,
        ];
      case 'hunterShrapnel':
        return [
          `The blast fills a ${e.coneAngleDeg}-degree cone, ${e.coneRange} yd long. Your target takes ${range(e.primaryMin, e.primaryMax)} base damage if it is in the cone. If it is not, the nearest enemy in the cone takes that damage instead. Other targets in the cone take ${range(e.splashMin, e.splashMax)}. Each direct hit adds 8% of your Ranged Attack Power. This is added before damage multipliers and armor. Each of those other targets also gets a wound that deals ${e.spreadTotal} base damage over ${e.spreadDuration} sec, ticking every ${e.spreadInterval} sec.`,
        ];
      case 'packCommand':
        return [
          `Your pet deals ${range(e.min, e.max)} plus ${apPart(28, 'its total Attack Power')}. If it hits, you get ${e.focus} Focus and one Ferocity stack for ${e.ferocityDuration} sec (up to 3 stacks). The strike can miss. It has a 5% chance to deal double damage. Pet damage bonuses apply first, then armor reduces the hit.`,
        ];
      case 'unleashBeast':
        return [
          `Pet strike: ${range(e.primaryMin, e.primaryMax)} damage. Clap: ${range(e.clapMin, e.clapMax)} damage within ${e.radius} yd. Other enemies hit by the clap take ${pct(e.secondaryClapMult ?? 1)} of the base clap roll. The empowered version multiplies these base numbers by 1.5. Each hit adds ${apPart(28, "the pet's total Attack Power")}. Each hit has a 5% chance to be a critical hit for double damage. Then pet damage bonuses and armor apply.`,
        ];
      case 'afflictionLitany':
        return [
          `It pulses once per second for ${e.duration} sec. Each pulse deals ${e.damage} base damage to up to ${e.maxTargets} enemies within ${e.radius} yd. Spell Power does not add to a pulse.`,
        ];
      case 'afflictionViolence':
        return [
          `It ticks every ${e.interval ?? 2} sec for ${e.duration} sec. Each tick deals ${e.damage} base damage ${add(tick(power, e.interval ?? 2))} The reactive strike deals the ${e.damage} base damage without this power bonus.`,
        ];
      case 'afflictionSentence':
        return [
          `You need at least 20 Condemnation. The hit uses up your Condemnation. Its base damage depends on how much you spend: 138 at 20, 400 at 50, 620 at 80, and 910 at 100. Between those points, the damage rises evenly and is rounded to the nearest whole number. This base comes before level and ability modifiers. Multiply it by your level / 20 (at least 0.25, at most 1). Each Fate Thread adds 6% (up to 3). Possession multiplies it by 1.25 and Hour of Judgment by 1.2. At levels 17, 18, 19 and 20, the final multiplier is ${[17, 18, 19, 20].map((l) => sentenceEndgameDamageMultiplier(l)).join(', ')}. Spending a full bank adds 5% more damage against players and bosses. A full bank also finishes off a normal enemy below 20% health. Spending at least 50 heals you for 20% of the damage it actually dealt.`,
        ];
      case 'selfHealPctMax':
        return [
          `Heals you for ${pct(e.pct)} of your maximum health before bonuses, rounded to a whole number.`,
        ];
      case 'selfAbsorbPctMax':
        return [
          `Absorbs damage equal to ${pct(e.pct)} of your maximum health, rounded to a whole number. Lasts up to ${e.duration} sec.`,
        ];
      case 'selfDamagePctMax':
        return [`Health cost: ${pct(e.pct)} of your maximum health.`];
      case 'selfDamagePctCurrent':
        return [`Health cost: ${pct(e.pct)} of your current health.`];
      case 'finisherStun':
        return [
          `Stuns for ${e.base} sec plus ${e.perCombo} sec per combo point. Diminishing returns can make the stun shorter.`,
        ];
      case 'finisherHaste':
        return [
          `The attack-speed buff lasts ${e.basedur} sec plus ${e.perCombo} sec per combo point spent.`,
        ];
      case 'consumeAura':
        return [
          ...(e.deal
            ? [
                `Using up the effect deals ${range(e.deal.min, e.deal.max)} ${add(direct(power, false))}`,
              ]
            : []),
          ...(e.heal
            ? [
                `Using up the effect heals for ${range(e.heal.min, e.heal.max)} ${add(direct(heal, false))}`,
              ]
            : []),
        ];
      default:
        return [];
    }
  }
  return [...new Set(res.effects.flatMap(describe))];
}
