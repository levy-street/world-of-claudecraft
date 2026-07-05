// Pure, host-agnostic descriptor for what a buff/debuff actually DOES, used to
// enrich the aura hover tooltip (previously name + remaining time only). Given an
// aura's kind/value/etc, it returns an i18n key plus the RAW numbers to splice in
// (and, for damage-over-time auras, the school). It stays DOM-free and i18n-free:
// the HUD consumer formats the numbers via formatNumber, resolves the localized
// school name, and renders t(key, values). That keeps every kind->effect mapping
// unit-testable without a DOM (reference: stat_tooltip.ts core + its painter).
//
// The `value` field is overloaded per AuraKind; the semantics below mirror the sim
// apply sites (recalc/movement/combat), not guesses:
//   - flat stat buffs (buff_ap/armor/int/...): value is the flat amount.
//   - slow: value is a movement multiplier < 1 (slow = min(slow, value)).
//   - attackspeed: value multiplies the swing interval (m *= value); > 1 = slower.
//   - buff_speed: value is an ABSOLUTE movement multiplier floored to 1.0.
//   - buff_haste: value divides the swing/cast interval (m /= value); > 1 = faster.
//   - tongues: value multiplies casting time (m = max(m, value)); > 1 = slower casts.
//   - mortal_wound/cost_tax/critvuln/vulnerability/spellvuln/expose/buff_dodge:
//     value is a 0..1 fraction shown as a percent.
import type { AuraKind } from '../sim/types';

export type AuraSchool = 'physical' | 'fire' | 'frost' | 'arcane' | 'shadow' | 'holy' | 'nature';

// Structural subset of Aura the descriptor needs; keeps this module decoupled from
// the full sim Aura shape so a Vitest can drive it with plain literals.
export interface AuraEffectInput {
  kind: AuraKind;
  value: number;
  value2?: number;
  value3?: number;
  tickInterval?: number;
  school?: AuraSchool;
  stacks?: number;
}

export interface AuraEffectDescriptor {
  // dotted hudChrome.auraEffect.* key the HUD renders via t(key, values)
  key: string;
  // raw numbers to splice in; the consumer runs each through formatNumber
  nums?: Record<string, number>;
  // when set, the consumer injects the localized school name as {school}
  school?: AuraSchool;
}

const round = (n: number): number => Math.round(n);
// percent a multiplier raises/lowers a quantity, e.g. mult 1.4 -> 40, 0.5 -> 50
const pctFromMult = (mult: number): number => Math.abs(round((mult - 1) * 100));
// percent from a 0..1 fraction, e.g. 0.3 -> 30
const pctFromFrac = (frac: number): number => Math.abs(round(frac * 100));

const KEY = 'hudChrome.auraEffect';

// Flat stat buffs share one shape: positive raises the stat, negative lowers it.
const flatStat = (statKey: string, value: number): AuraEffectDescriptor => ({
  key: `${KEY}.${value < 0 ? 'reduce' : 'increase'}.${statKey}`,
  nums: { value: Math.abs(round(value)) },
});

/**
 * Describe an aura's gameplay effect, or null if the kind has no meaningful
 * one-line summary (the tooltip then falls back to name + remaining time only).
 */
export function auraEffectDescriptor(a: AuraEffectInput): AuraEffectDescriptor | null {
  switch (a.kind) {
    case 'dot':
      return {
        key: `${KEY}.dot`,
        nums: { value: round(a.value), interval: a.tickInterval ?? 1 },
        school: a.school,
      };
    case 'hot':
      return { key: `${KEY}.hot`, nums: { value: round(a.value), interval: a.tickInterval ?? 1 } };
    case 'absorb':
      return { key: `${KEY}.absorb`, nums: { value: round(a.value) }, school: a.school };
    case 'heal_absorb':
      return { key: `${KEY}.healAbsorb`, nums: { value: round(a.value) } };
    case 'thorns':
      return { key: `${KEY}.thorns`, nums: { value: round(a.value) }, school: a.school };

    case 'slow':
      return { key: `${KEY}.slow`, nums: { pct: pctFromMult(a.value) } };
    case 'buff_speed':
      return { key: `${KEY}.speed`, nums: { pct: pctFromMult(a.value) } };
    case 'attackspeed':
      // value multiplies the swing interval: > 1 slower, < 1 faster.
      return {
        key: a.value >= 1 ? `${KEY}.attackSpeedSlow` : `${KEY}.attackSpeedFast`,
        nums: { pct: pctFromMult(a.value) },
      };
    case 'buff_haste':
      // value divides the swing/cast interval: > 1 faster.
      return { key: `${KEY}.haste`, nums: { pct: pctFromMult(a.value) } };
    case 'tongues':
      return { key: `${KEY}.tongues`, nums: { pct: pctFromMult(a.value) } };

    case 'buff_ap':
      return flatStat('ap', a.value);
    case 'debuff_ap':
      return flatStat('ap', -Math.abs(a.value));
    case 'buff_armor':
      return flatStat('armor', a.value);
    case 'buff_int':
      return flatStat('int', a.value);
    case 'buff_agi':
      return flatStat('agi', a.value);
    case 'buff_sta':
      return flatStat('sta', a.value);
    case 'buff_spi':
      return flatStat('spi', a.value);
    case 'buff_allstats':
      return flatStat('allStats', a.value);
    case 'buff_allstats_pct':
      // Percentage drain on the whole stat block (The Keeper's Toll / Resurrection
      // Sickness: value -0.75 -> "Reduces all attributes by 75%"). Always a drain.
      return { key: `${KEY}.allStatsPctReduce`, nums: { pct: pctFromFrac(a.value) } };
    case 'buff_dodge':
      // The staggerHit mob affix rides buff_dodge with a NEGATIVE value, so the
      // sign picks the direction (mirrors flatStat).
      return {
        key: `${KEY}.${a.value < 0 ? 'dodgeReduce' : 'dodge'}`,
        nums: { pct: pctFromFrac(a.value) },
      };

    case 'sunder': {
      // value is a FLAT armor amount per stack; total reduction is value * stacks
      // (armor -= a.value * (a.stacks ?? 1) in the mitigation pass).
      const stacks = a.stacks ?? 1;
      const total = round(a.value * stacks);
      return stacks > 1
        ? { key: `${KEY}.armorFlatStacks`, nums: { value: total, stacks } }
        : { key: `${KEY}.armorFlat`, nums: { value: total } };
    }
    case 'expose':
      // The mob expose affix raises physical damage taken (exposeMult += value).
      return { key: `${KEY}.physVuln`, nums: { pct: pctFromFrac(a.value) } };
    case 'mortal_wound':
      return { key: `${KEY}.mortalWound`, nums: { pct: pctFromFrac(a.value) } };
    case 'vulnerability':
      return { key: `${KEY}.vulnerability`, nums: { pct: pctFromFrac(a.value) } };
    case 'spellvuln':
      return { key: `${KEY}.spellVuln`, nums: { pct: pctFromFrac(a.value) } };
    case 'critvuln':
      return { key: `${KEY}.critVuln`, nums: { pct: pctFromFrac(a.value) } };
    case 'cost_tax':
      return { key: `${KEY}.costTax`, nums: { pct: pctFromFrac(a.value) } };

    // Crowd control / silence-family: the meaningful summary is the restriction,
    // not a number.
    case 'stun':
      return { key: `${KEY}.stun` };
    case 'root':
      return { key: `${KEY}.root` };
    case 'incapacitate':
      return { key: `${KEY}.incapacitate` };
    case 'polymorph':
      return { key: `${KEY}.polymorph` };
    case 'hex':
      // Weakening Hex throttles outgoing damage AND healing by (1 - value); it is
      // not a loss-of-control effect.
      return { key: `${KEY}.hex`, nums: { pct: pctFromFrac(a.value) } };
    case 'blind':
      return { key: `${KEY}.blind` };
    case 'silence':
      return { key: `${KEY}.silence` };
    case 'disarm':
      return { key: `${KEY}.disarm` };
    case 'lockout':
      return { key: `${KEY}.lockout` };

    case 'imbue':
      // value2/value3: judgement min/max bonus damage on the imbued weapon.
      return a.value2 != null && a.value3 != null
        ? { key: `${KEY}.imbueRange`, nums: { min: round(a.value2), max: round(a.value3) } }
        : { key: `${KEY}.imbue` };
    case 'stealth':
      return { key: `${KEY}.stealth`, nums: { pct: pctFromMult(a.value) } };
    case 'form_bear':
      return { key: `${KEY}.formBear` };
    case 'form_cat':
      return { key: `${KEY}.formCat` };
    case 'form_travel':
      return { key: `${KEY}.formTravel`, nums: { pct: pctFromMult(a.value) } };
    case 'defensive_stance':
      return { key: `${KEY}.defensiveStance` };
    case 'righteous_fury':
      return { key: `${KEY}.righteousFury` };

    // Fiesta power-ups: value is a body-size / jump-height multiplier.
    case 'buff_scale':
      return { key: `${KEY}.scale`, nums: { pct: pctFromMult(a.value) } };
    case 'buff_jump':
      return { key: `${KEY}.jump`, nums: { pct: pctFromMult(a.value) } };

    default:
      return null;
  }
}
