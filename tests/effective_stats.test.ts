// src/sim/effective_stats.ts: the armor and attack-power reads moved verbatim
// out of sim.ts. Plain entities, no Sim: the percent debuffs max-combine, the
// flat corrode shred stacks, and non-player buffs fold in while a player's do
// not (recalcPlayerStats already folded them).
import { describe, expect, it } from 'vitest';
import { effectiveArmorOf, effectiveAttackPowerOf } from '../src/sim/effective_stats';
import {
  type Aura,
  type Entity,
  FAERIE_FIRE_ARMOR_PCT,
  SUNDER_ARMOR_PCT_PER_STACK,
} from '../src/sim/types';

function entity(kind: 'player' | 'mob', armor: number, attackPower: number, auras: Aura[]): Entity {
  return { kind, stats: { armor }, attackPower, auras } as unknown as Entity;
}

const aura = (kind: string, value: number, stacks?: number): Aura =>
  ({ kind, value, ...(stacks === undefined ? {} : { stacks }) }) as unknown as Aura;

describe('effectiveArmorOf', () => {
  it('max-combines Sunder and Faerie Fire instead of adding them', () => {
    const e = entity('mob', 1000, 0, [aura('sunder', 0, 5), aura('faerie_fire', 0)]);
    const pct = Math.max(SUNDER_ARMOR_PCT_PER_STACK * 5, FAERIE_FIRE_ARMOR_PCT);
    expect(effectiveArmorOf(e)).toBe(1000 * (1 - pct));
  });

  it('subtracts corrode flat per stack before the percent debuffs, floored at zero', () => {
    const e = entity('mob', 100, 0, [aura('corrode', 30, 2), aura('sunder', 0, 5)]);
    expect(effectiveArmorOf(e)).toBe((100 - 60) * (1 - SUNDER_ARMOR_PCT_PER_STACK * 5));
    expect(effectiveArmorOf(entity('mob', 10, 0, [aura('corrode', 50, 1)]))).toBe(0);
  });

  it('folds flat and percent armor buffs for a non-player only', () => {
    const buffs = [aura('buff_armor', 50), aura('buff_armor_pct', 10)];
    expect(effectiveArmorOf(entity('mob', 200, 0, buffs))).toBe(270);
    expect(effectiveArmorOf(entity('player', 200, 0, buffs))).toBe(200);
  });
});

describe('effectiveAttackPowerOf', () => {
  it('folds flat and percent attack-power auras for a non-player only, floored at zero', () => {
    const auras = [aura('buff_ap', 10), aura('debuff_ap', 5), aura('buff_ap_pct', 50)];
    expect(effectiveAttackPowerOf(entity('mob', 0, 100, auras))).toBe(155);
    expect(effectiveAttackPowerOf(entity('player', 0, 100, auras))).toBe(100);
    expect(effectiveAttackPowerOf(entity('mob', 0, 3, [aura('debuff_ap', 9)]))).toBe(0);
  });
});
