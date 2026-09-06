import { describe, expect, it } from 'vitest';
import {
  allocateGroupEchoEmergencyBonusRates,
  GROUP_ECHO_EMERGENCY_HEALTH_THRESHOLD,
} from '../src/sim/combat/chronomancy_echo_distribution';

describe('Chronomancy group Echo emergency distribution', () => {
  it('weights by missing-health fraction independent of health pool and input order', () => {
    const targets = [
      { id: 1, hp: 200, maxHp: 1_000, baseRate: 0.13, contributesToPool: true },
      { id: 2, hp: 5_000, maxHp: 10_000, baseRate: 0.13, contributesToPool: true },
      { id: 3, hp: 350, maxHp: 500, baseRate: 0.13, contributesToPool: true },
    ];
    const bonus = allocateGroupEchoEmergencyBonusRates(targets);
    const reversed = allocateGroupEchoEmergencyBonusRates([...targets].reverse());

    expect(GROUP_ECHO_EMERGENCY_HEALTH_THRESHOLD).toBe(0.6);
    expect(bonus.get(1)).toBeCloseTo(0.24, 10);
    expect(bonus.get(2)).toBeCloseTo(0.15, 10);
    expect(bonus.has(3)).toBe(false);
    expect([...bonus.values()].reduce((sum, rate) => sum + rate, 0)).toBeCloseTo(0.39, 10);
    for (const { id } of targets) expect(reversed.get(id)).toBe(bonus.get(id));
  });

  it('concentrates the whole reserve on the only low-health ally', () => {
    const bonus = allocateGroupEchoEmergencyBonusRates([
      { id: 1, hp: 500, maxHp: 1_000, baseRate: 0.13, contributesToPool: true },
      { id: 2, hp: 700, maxHp: 1_000, baseRate: 0.13, contributesToPool: true },
    ]);

    expect(bonus).toEqual(new Map([[1, 0.26]]));
  });

  it('lets any marked ally receive a reserve funded only by group Echoes', () => {
    const bonus = allocateGroupEchoEmergencyBonusRates([
      { id: 1, hp: 500, maxHp: 1_000, baseRate: 0.4, contributesToPool: false },
      { id: 2, hp: 700, maxHp: 1_000, baseRate: 0.13, contributesToPool: true },
    ]);

    expect(bonus).toEqual(new Map([[1, 0.13]]));
  });

  it('does not spend the reserve when every marked ally is at or above 60 percent health', () => {
    const bonus = allocateGroupEchoEmergencyBonusRates([
      { id: 1, hp: 600, maxHp: 1_000, baseRate: 0.13, contributesToPool: true },
      { id: 2, hp: 900, maxHp: 1_000, baseRate: 0.13, contributesToPool: true },
    ]);

    expect(bonus.size).toBe(0);
  });
});
