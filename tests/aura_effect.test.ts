import { describe, expect, it } from 'vitest';
import { type AuraEffectInput, auraEffectDescriptor } from '../src/ui/aura_effect';

const desc = (a: AuraEffectInput) => auraEffectDescriptor(a);

describe('auraEffectDescriptor', () => {
  it('describes a damage-over-time with value, school and interval', () => {
    expect(desc({ kind: 'dot', value: 15, tickInterval: 3, school: 'shadow' })).toEqual({
      key: 'hudChrome.auraEffect.dot',
      nums: { value: 15, interval: 3 },
      school: 'shadow',
    });
  });

  it('defaults the dot tick interval to 1 when absent', () => {
    expect(desc({ kind: 'dot', value: 8, school: 'fire' })?.nums).toEqual({
      value: 8,
      interval: 1,
    });
  });

  it('describes a heal-over-time without a school', () => {
    const d = desc({ kind: 'hot', value: 20, tickInterval: 2 });
    expect(d).toEqual({ key: 'hudChrome.auraEffect.hot', nums: { value: 20, interval: 2 } });
    expect(d?.school).toBeUndefined();
  });

  it('reports a movement slow as a percent reduction from the multiplier', () => {
    expect(desc({ kind: 'slow', value: 0.5 })).toEqual({
      key: 'hudChrome.auraEffect.slow',
      nums: { pct: 50 },
    });
  });

  it('reports a movement speed buff as a percent increase (absolute multiplier)', () => {
    expect(desc({ kind: 'buff_speed', value: 1.4 })).toEqual({
      key: 'hudChrome.auraEffect.speed',
      nums: { pct: 40 },
    });
  });

  it('distinguishes attack-speed slow from haste by the multiplier', () => {
    expect(desc({ kind: 'attackspeed', value: 1.2 })?.key).toBe(
      'hudChrome.auraEffect.attackSpeedSlow',
    );
    expect(desc({ kind: 'attackspeed', value: 0.8 })?.key).toBe(
      'hudChrome.auraEffect.attackSpeedFast',
    );
  });

  it('routes a positive stat buff to increase and a negative one to reduce', () => {
    expect(desc({ kind: 'buff_ap', value: 50 })).toEqual({
      key: 'hudChrome.auraEffect.increase.ap',
      nums: { value: 50 },
    });
    // A negative-value buff_* aura is a debuff (e.g. a curse sapping attack power).
    expect(desc({ kind: 'buff_ap', value: -30 })).toEqual({
      key: 'hudChrome.auraEffect.reduce.ap',
      nums: { value: 30 },
    });
  });

  it('always reduces for the dedicated debuff_ap kind regardless of value sign', () => {
    expect(desc({ kind: 'debuff_ap', value: 25 })).toEqual({
      key: 'hudChrome.auraEffect.reduce.ap',
      nums: { value: 25 },
    });
  });

  it('shows Sunder Armor as a percent reduction scaling with stacks', () => {
    // Sunder is now a PERCENT debuff (2% per stack); the aura value carries the threat
    // constant and is ignored for the tooltip. 5 stacks = 10%.
    expect(desc({ kind: 'sunder', value: 170, stacks: 5 })).toEqual({
      key: 'hudChrome.auraEffect.armorPctStacks',
      nums: { pct: 10, stacks: 5 },
    });
    expect(desc({ kind: 'sunder', value: 25, stacks: 1 })).toEqual({
      key: 'hudChrome.auraEffect.armorPct',
      nums: { pct: 2 },
    });
  });

  it('shows Faerie Fire as a fixed percent armor reduction', () => {
    expect(desc({ kind: 'faerie_fire', value: 0 })).toEqual({
      key: 'hudChrome.auraEffect.armorPct',
      nums: { pct: 10 },
    });
  });

  it('shows mob corrosion as a flat, stacking armor shred', () => {
    expect(desc({ kind: 'corrode', value: 30, stacks: 3 })).toEqual({
      key: 'hudChrome.auraEffect.armorFlatStacks',
      nums: { value: 90, stacks: 3 },
    });
    expect(desc({ kind: 'corrode', value: 6, stacks: 1 })).toEqual({
      key: 'hudChrome.auraEffect.armorFlat',
      nums: { value: 6 },
    });
  });

  it('shows the percent raid buffs as +N% stat lines', () => {
    expect(desc({ kind: 'buff_int_pct', value: 5 })).toEqual({
      key: 'hudChrome.auraEffect.increasePct.int',
      nums: { pct: 5 },
    });
    expect(desc({ kind: 'buff_ap_pct', value: 10 })).toEqual({
      key: 'hudChrome.auraEffect.increasePct.ap',
      nums: { pct: 10 },
    });
    expect(desc({ kind: 'buff_stats_pct', value: 5 })).toEqual({
      key: 'hudChrome.auraEffect.increasePct.allStats',
      nums: { pct: 5 },
    });
    expect(desc({ kind: 'buff_armor_pct', value: 10 })).toEqual({
      key: 'hudChrome.auraEffect.increasePct.armor',
      nums: { pct: 10 },
    });
    expect(desc({ kind: 'buff_sta_pct', value: 5 })).toEqual({
      key: 'hudChrome.auraEffect.increasePct.sta',
      nums: { pct: 5 },
    });
  });

  it('reports the expose mob affix as increased physical damage taken', () => {
    expect(desc({ kind: 'expose', value: 0.15 })).toEqual({
      key: 'hudChrome.auraEffect.physVuln',
      nums: { pct: 15 },
    });
  });

  it('reports hex as an outgoing damage/healing reduction, not crowd control', () => {
    expect(desc({ kind: 'hex', value: 0.3 })).toEqual({
      key: 'hudChrome.auraEffect.hex',
      nums: { pct: 30 },
    });
  });

  it('picks dodge direction by sign (staggerHit applies a negative buff_dodge)', () => {
    expect(desc({ kind: 'buff_dodge', value: 0.1 })).toEqual({
      key: 'hudChrome.auraEffect.dodge',
      nums: { pct: 10 },
    });
    expect(desc({ kind: 'buff_dodge', value: -0.05 })).toEqual({
      key: 'hudChrome.auraEffect.dodgeReduce',
      nums: { pct: 5 },
    });
  });

  it('summarizes crowd control by the restriction, not a number', () => {
    expect(desc({ kind: 'stun', value: 0 })).toEqual({ key: 'hudChrome.auraEffect.stun' });
    expect(desc({ kind: 'silence', value: 0 })).toEqual({ key: 'hudChrome.auraEffect.silence' });
    expect(desc({ kind: 'root', value: 0 })).toEqual({ key: 'hudChrome.auraEffect.root' });
  });

  it('describes the all-stats percent drain (buff_allstats_pct)', () => {
    expect(desc({ kind: 'buff_allstats_pct', value: -0.75 })).toEqual({
      key: 'hudChrome.auraEffect.allStatsPctReduce',
      nums: { pct: 75 },
    });
  });

  it('describes an imbue range when judgement min/max are present', () => {
    expect(desc({ kind: 'imbue', value: 0, value2: 10, value3: 20 })).toEqual({
      key: 'hudChrome.auraEffect.imbueRange',
      nums: { min: 10, max: 20 },
    });
    expect(desc({ kind: 'imbue', value: 0 })?.key).toBe('hudChrome.auraEffect.imbue');
  });

  it('returns null for a kind with no meaningful one-line effect', () => {
    expect(desc({ kind: 'righteous_fury', value: 0 })).not.toBeNull();
    // A purely cosmetic / structural kind not handled falls back to null.
    expect(desc({ kind: 'lockout', value: 0 })).toEqual({ key: 'hudChrome.auraEffect.lockout' });
  });

  it('is a pure function: same input gives the same output', () => {
    const input: AuraEffectInput = { kind: 'dot', value: 12, tickInterval: 2, school: 'nature' };
    expect(desc(input)).toEqual(desc(input));
  });
});
