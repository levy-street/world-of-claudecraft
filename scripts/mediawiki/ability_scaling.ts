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

const pct = (v: number) => `${Number((v * 100).toFixed(6))}%`;
const range = (min: number, max: number) => (min === max ? String(min) : `${min} to ${max}`);

// Keep the quotients intact: 1.5 / 3.5 is exact, while a truncated percentage
// can reproduce a different rounded hit. The spellbook supplies the base prose.
export function abilityScalingLines(res: ResolvedAbility): string[] {
  const def = res.def;
  const ranged = def.scalesWith === 'ranged';
  const physical = def.school === 'physical';
  const attack = ranged ? 'Ranged Attack Power' : physical ? 'Attack Power' : 'Spell Power';
  const power = ranged
    ? `${attack} × ${RANGED_SPELL_AP_SCALE}`
    : physical
      ? `${attack} × ${MELEE_SPELL_AP_SCALE}`
      : attack;
  const castFraction = (t: number) =>
    `${Math.min(SPELL_COEFF_MAX_CAST, Math.max(SPELL_COEFF_MIN_CAST, t))} / ${SPELL_COEFF_DIVISOR}`;
  const direct = (stat: string, aoe: boolean, override?: number) =>
    `${stat} × ${override ?? castFraction(res.castTime)}${aoe ? ' × ' + SPELL_AOE_COEFF_MULT : ''}`;
  const channel = (stat: string) =>
    `${stat} × ${castFraction(def.channel!.duration)} / ${def.channel!.ticks}`;
  const heal = `Healing Power × ${HEALING_SP_SCALE}`;
  const tick = (stat: string, interval: number) =>
    `${stat} × ${interval} / ${SPELL_DOT_COEFF_DURATION}`;
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
            `Each pulse grants allies ${pct(e.allyBuffPct)} extra damage within ${e.radius} yd.`,
          ];
        const area = e.type !== 'directDamage' && e.type !== 'drainTick';
        const formula = def.channel
          ? channel(power)
          : direct(power, area, e.type === 'directDamage' ? e.spellPowerCoeff : undefined);
        const label =
          e.type === 'chainDamage'
            ? 'Chain damage before falloff'
            : def.channel || e.type === 'groundAoE'
              ? 'Damage per pulse'
              : 'Damage';
        const lines = [
          `${label} starts at ${range(e.min, e.max)} plus the nearest whole number to (${formula}).`,
        ];
        if ('damageMult' in e && e.damageMult !== undefined && e.damageMult !== 1)
          lines.push(`Multiply the combined roll and power bonus by ${e.damageMult}.`);
        if ('radius' in e) lines.push(`Radius: ${e.radius} yd.`);
        if (e.type === 'chainDamage')
          lines.push(
            `Up to ${e.jumps} additional targets. Each successive jump retains ${pct(e.falloff)} of the previous hop's damage.`,
          );
        if (e.type === 'groundAoE')
          lines.push(
            `Pulses every ${e.interval} sec for ${e.duration} sec. The first pulse lands ${e.delayed ? 'after one interval' : 'on placement'}.`,
          );
        if (e.type === 'aoeDamage' && e.softCap)
          lines.push(
            `Beyond ${e.softCap} targets, each hit is multiplied by ${e.softCap} divided by the number of targets.`,
          );
        if (e.type === 'aoeDamage' && e.rageOnHit)
          lines.push(
            `Casting grants ${e.rageOnHit.base} base Rage plus ${e.rageOnHit.perTarget} per target up to ${e.rageOnHit.capTargets} targets.`,
          );
        if (e.type === 'drainTick')
          lines.push(`Each tick heals the caster for ${pct(e.healFrac)} of the damage.`);
        if (e.type === 'sporeBurst')
          lines.push(
            `Heals each ally for ${range(e.healMin, e.healMax)} plus the nearest whole number to (${direct(heal, true)}).`,
          );
        if (e.type === 'directDamage' && e.vsRootedMult)
          lines.push(`Against a rooted target, multiply this hit by ${e.vsRootedMult}.`);
        return lines;
      }
      case 'heal':
      case 'aoeHeal':
      case 'chainHeal': {
        if (e.type === 'heal' && e.casterMaxHpPct !== undefined)
          return [
            `Restores ${pct(e.casterMaxHpPct)} of the caster's maximum health, rounded to the nearest whole point.`,
          ];
        const amount = def.channel ? channel('Healing Power') : direct(heal, e.type === 'aoeHeal');
        const lines = [
          `Healing${def.channel ? ' per pulse' : ''} starts at ${range(e.min, e.max)} plus the nearest whole number to (${amount}).`,
        ];
        if (e.type === 'chainHeal')
          lines.push(
            `Up to ${e.jumps} jumps within ${e.radius} yd per jump. Each hop retains ${pct(e.falloff)} of the preceding heal.`,
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
          base = `${pct(e.pctOfMax)} of the target's maximum health, rounded to a whole point`;
        if (e.type === 'dot') {
          if (e.directPct !== undefined)
            base = `${pct(e.directPct)} of the preceding direct damage, rounded to a whole point`;
          if (e.perComboTotal !== undefined)
            base = `${e.baseTotal ?? 0} + ${e.perComboTotal} per combo point spent`;
          if (e.perCombo !== undefined) base = `${e.total} + ${e.perCombo} per combo point spent`;
        }
        const duration =
          e.type === 'dot' && e.perComboDuration
            ? `${e.baseDuration ?? 0} + ${e.perComboDuration} per combo point spent`
            : e.duration;
        const lines = [
          `Each ${isHeal ? 'healing' : 'damage'} tick starts with (${base}) divided by ${e.duration / e.interval}, rounded to the nearest whole point with a minimum of 1. Ticks every ${e.interval} sec for ${duration} sec.`,
        ];
        lines.push(
          hybrid
            ? 'The accompanying direct effect takes the power bonus. The periodic effect gains no separate power bonus.'
            : `Add the nearest whole number to (${tick(isHeal ? heal : power, e.interval)}) to every tick.`,
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
          `Each shield absorbs ${parts.join(' plus ')} for up to ${e.duration} sec. Round each contribution to a whole point.`,
        ];
      }
      case 'absorbSpentResource':
        return [
          `Shield strength equals ${e.mult} times the resource spent. Lasts ${e.duration} sec.`,
        ];
      case 'finisherDamage':
        return [
          `Start with ${e.base}, add ${e.perCombo} per combo point, a roll from 0 to ${e.variance}, and effective Attack Power / 14. Armor reduces the physical hit.`,
        ];
      case 'weaponStrike':
      case 'weaponDamage': {
        const mult = e.type === 'weaponStrike' ? (e.weaponMult ?? 1) : 1;
        const lines = [
          `Deals ${pct(mult)} of a weapon swing plus ${e.bonus} flat damage. A swing includes the weapon damage roll and effective Attack Power / 14 times swing speed in seconds.`,
        ];
        if (e.type === 'weaponStrike' && e.normalized)
          lines.push(
            `For this strike, rescale the weapon roll and Attack Power contribution to ${DAGGER_NORMALIZED_SPEED} sec for daggers or ${ONE_HAND_NORMALIZED_SPEED} sec for other weapons.`,
          );
        return lines;
      }
      case 'hunterBearTrap':
      case 'hunterBloodhook':
        return [
          `Snapshot ${e.bleedTotal} + ${pct(e.rangedPowerCoeff)} of Ranged Attack Power${e.type === 'hunterBloodhook' && e.damageMult ? ' and multiply the result by ' + e.damageMult : ''}. Divide the bleed across ${e.bleedDuration / e.bleedInterval} ticks spaced ${e.bleedInterval} sec apart.`,
        ];
      case 'hunterStampede':
        return [
          `Each of the ${e.beasts} beasts attacks every ${e.attackInterval} sec for ${e.duration} sec. Each attack rolls ${range(e.min, e.max)} plus ${pct(e.rangedPowerCoeff)} of Ranged Attack Power. Your pet damage bonus and Ferocity multiply the result when the beasts are summoned.`,
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
        return [
          line +
            ('permanent' in e && e.permanent
              ? ' Stays active until removed.'
              : e.duration > 0
                ? ' Lasts ' + e.duration + ' sec.'
                : ''),
        ];
      }
      case 'frozenOrb':
        return [
          `Every ${e.interval} sec for ${e.duration} sec the moving orb hits enemies in ${e.radius} yd for ${range(e.min, e.max)} plus the nearest whole number to (${direct(power, true)}). It snapshots this bonus when released.`,
        ];
      case 'empoweredCone':
        return e.stages.map(
          (s, i) =>
            `Charge stage ${i + 1} reaches ${s.range} yd and deals ${range(s.min, s.max)} plus the nearest whole number to (${power} × ${castFraction((res.castTime * (i + 1)) / e.stages.length)} × ${SPELL_AOE_COEFF_MULT}).${e.guaranteedCritLevel === i + 1 ? ' Always critically strikes.' : ''}${s.rootDuration ? ' Roots for ' + s.rootDuration + ' sec.' : ''}${s.incapacitateDuration ? ' Incapacitates for ' + s.incapacitateDuration + ' sec before diminishing returns.' : ''}`,
        );
      case 'valkyrsCalling':
        return [
          `On landing, each enemy in sight within ${e.radius} yd takes a roll from ${range(e.min, e.max)}. With more than ${e.softCap} victims multiply each roll by ${e.softCap} divided by the number of victims, then round. This landing gains no Spell Power bonus.`,
        ];
      case 'hunterShrapnel':
        return [
          `Your selected target in the ${e.coneAngleDeg}-degree, ${e.coneRange}-yd cone, or the nearest target in it if yours is outside, takes ${range(e.primaryMin, e.primaryMax)} base damage. Other targets take ${range(e.splashMin, e.splashMax)}. Add 8% of Ranged Attack Power to each direct hit before its damage multiplier and armor reduction. Each secondary wound adds ${e.spreadTotal} base damage over ${e.spreadDuration} sec, ticking every ${e.spreadInterval} sec.`,
        ];
      case 'packCommand':
        return [
          `Your pet rolls ${range(e.min, e.max)} plus its effective Attack Power / 28. A hit grants ${e.focus} Focus and a Ferocity stack for ${e.ferocityDuration} sec, up to three. The strike can miss, has a 5% chance of double damage and is reduced by armor after pet-damage modifiers.`,
        ];
      case 'unleashBeast':
        return [
          `Pet strike: ${range(e.primaryMin, e.primaryMax)}. Clap: ${range(e.clapMin, e.clapMax)} within ${e.radius} yd. Secondary clap targets use ${pct(e.secondaryClapMult ?? 1)} of the base clap roll. The empowered version multiplies the base ranges by 1.5. Each hit adds the pet's effective Attack Power / 28, rolls a 5% double-damage critical chance, then applies pet-damage modifiers and armor.`,
        ];
      case 'afflictionLitany':
        return [
          `Each pulse deals ${e.damage} base damage once per second for ${e.duration} sec, up to ${e.maxTargets} enemies within ${e.radius} yd. Spell Power adds no damage to a pulse.`,
        ];
      case 'afflictionViolence':
        return [
          `Ticks every ${e.interval ?? 2} sec for ${e.duration} sec. Each tick adds the nearest whole number to (${tick(power, e.interval ?? 2)}) to ${e.damage} base damage. The reactive strike uses the ${e.damage} base without this periodic power bonus.`,
        ];
      case 'afflictionSentence':
        return [
          `Consume at least 20 Condemnation. Before level and ability modifiers, the hit is 138 at 20, 400 at 50, 620 at 80, and 910 at 100. Between adjacent values, use proportional progress rounded to the nearest whole point. Multiply by character level / 20, with a 0.25 minimum and a 1 maximum. Each Fate Thread adds 6% (up to three). Possession multiplies by 1.25 and Hour of Judgment by 1.2. From levels 17 to 20 the final multiplier is ${[17, 18, 19, 20].map((l) => sentenceEndgameDamageMultiplier(l)).join(', ')} respectively. A full bank adds a further 5% against players or bosses and finishes a normal enemy below 20% health. Spending at least 50 heals you for 20% of the damage actually dealt.`,
        ];
      case 'selfHealPctMax':
        return [
          `Base self-healing equals ${pct(e.pct)} of your maximum health, rounded to a whole point.`,
        ];
      case 'selfAbsorbPctMax':
        return [
          `Absorbs ${pct(e.pct)} of your maximum health, rounded to a whole point, for up to ${e.duration} sec.`,
        ];
      case 'selfDamagePctMax':
        return [`Health cost: ${pct(e.pct)} of your maximum health.`];
      case 'selfDamagePctCurrent':
        return [`Health cost: ${pct(e.pct)} of your current health.`];
      case 'finisherStun':
        return [
          `Base stun duration is ${e.base} sec plus ${e.perCombo} sec per combo point, before control diminishing returns.`,
        ];
      case 'finisherHaste':
        return [
          `The attack-speed buff lasts ${e.basedur} sec plus ${e.perCombo} sec per combo point spent.`,
        ];
      case 'consumeAura':
        return [
          ...(e.deal
            ? [
                `Consuming the aura deals ${range(e.deal.min, e.deal.max)} plus the nearest whole number to (${direct(power, false)}).`,
              ]
            : []),
          ...(e.heal
            ? [
                `Consuming the aura heals for ${range(e.heal.min, e.heal.max)} plus the nearest whole number to (${direct(heal, false)}).`,
              ]
            : []),
        ];
      default:
        return [];
    }
  }
  return [...new Set(res.effects.flatMap(describe))];
}
