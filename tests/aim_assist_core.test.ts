// Pure-core tests for the M7B skill smart-cast helpers: eligibility (offensive
// targeted + AoE, friendly/self excluded) and the range-ring radius fallback.

import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../src/sim/types';
import {
  AIM_DEFAULT_PBAOE_RANGE_YD,
  aimRangeFor,
  isAimEligibleAbility,
} from '../src/ui/aim_assist_core';

function ability(opts: Partial<AbilityDef> = {}): AbilityDef {
  return {
    id: 'test',
    name: 'Test',
    class: 'mage',
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'arcane',
    requiresTarget: false,
    learnLevel: 1,
    effects: [],
    description: '',
    ...opts,
  } as AbilityDef;
}

describe('isAimEligibleAbility', () => {
  it('accepts a targeted ranged offensive spell (range > 0)', () => {
    expect(isAimEligibleAbility(ability({ range: 30, requiresTarget: true }))).toBe(true);
  });

  it('accepts a point-blank offensive AoE (range 0, AoE effect)', () => {
    const arcaneExplosion = ability({
      range: 0,
      effects: [{ type: 'aoeDamage', min: 10, max: 20, radius: 10 }],
    });
    expect(isAimEligibleAbility(arcaneExplosion)).toBe(true);
  });

  it('accepts an enemy ground AoE and an attack-power debuff shout', () => {
    expect(
      isAimEligibleAbility(
        ability({
          effects: [{ type: 'groundAoE', min: 5, max: 8, radius: 8, duration: 6, interval: 1 }],
        }),
      ),
    ).toBe(true);
    expect(
      isAimEligibleAbility(
        ability({ effects: [{ type: 'aoeAttackPower', amount: 40, duration: 30, radius: 10 }] }),
      ),
    ).toBe(true);
  });

  it('rejects a friendly-target ability even with a cast range', () => {
    expect(
      isAimEligibleAbility(ability({ range: 40, requiresTarget: true, targetType: 'friendly' })),
    ).toBe(false);
  });

  it('rejects a self buff with no range and no AoE', () => {
    expect(
      isAimEligibleAbility(
        ability({
          range: 0,
          effects: [{ type: 'selfBuff', kind: 'buff_ap', value: 50, duration: 30 }],
        }),
      ),
    ).toBe(false);
  });
});

describe('aimRangeFor', () => {
  it('uses the cast range when present', () => {
    expect(aimRangeFor(ability({ range: 35 }))).toBe(35);
  });

  it('falls back to the widest AoE radius for a point-blank AoE', () => {
    expect(
      aimRangeFor(
        ability({ range: 0, effects: [{ type: 'aoeDamage', min: 1, max: 2, radius: 12 }] }),
      ),
    ).toBe(12);
  });

  it('falls back to a small default when nothing declares a size', () => {
    expect(aimRangeFor(ability({ range: 0 }))).toBe(AIM_DEFAULT_PBAOE_RANGE_YD);
  });
});
