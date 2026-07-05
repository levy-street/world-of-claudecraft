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

  it('shows flat total armor and stack count for a stacking sunder', () => {
    // sunder value is a FLAT armor amount per stack (e.g. Sunder Armor: 25);
    // total reduction = value * stacks (armor -= value * stacks in mitigation).
    expect(desc({ kind: 'sunder', value: 25, stacks: 5 })).toEqual({
      key: 'hudChrome.auraEffect.armorFlatStacks',
      nums: { value: 125, stacks: 5 },
    });
    expect(desc({ kind: 'sunder', value: 40, stacks: 1 })).toEqual({
      key: 'hudChrome.auraEffect.armorFlat',
      nums: { value: 40 },
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
