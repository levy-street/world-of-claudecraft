import { describe, expect, it } from 'vitest';
import {
  runWarlockBalanceProbe,
  WARLOCK_FULL_BIS_GEAR,
  WARLOCK_LEVEL_20_SCENARIO,
} from '../scripts/warlock_balance_probe';

describe('warlock feedback measurement controls', () => {
  it('uses the declared gear and separates the guardian cooldown from two-target echoes', () => {
    const scenario = {
      ...WARLOCK_LEVEL_20_SCENARIO,
      equipment: { ...WARLOCK_FULL_BIS_GEAR, helmet: 'ruincaller_helmet' },
      isolated: true,
      secondaryTarget: true,
    };
    const without = runWarlockBalanceProbe('destruction', 1337, 40, {
      ...scenario,
      usePyre: false,
    });
    const withPyre = runWarlockBalanceProbe('destruction', 1337, 40, {
      ...scenario,
      usePyre: true,
    });
    expect(without.equipment).toEqual(scenario.equipment);
    expect(without.equipment).not.toBe(scenario.equipment);
    expect(without).toEqual(
      runWarlockBalanceProbe('destruction', 1337, 40, { ...scenario, usePyre: false }),
    );
    expect(without.damageByAbility['Pyre Aura']).toBeUndefined();
    expect(withPyre.damageByAbility['Pyre Aura']).toBeGreaterThan(0);
    expect(without.damageByAbility['Ruinous Brand']).toBeGreaterThan(0);
    expect(without.castsByAbility.chaos_bolt).toBeGreaterThan(0);
    expect(Object.values(without.damageByAbility).reduce((sum, damage) => sum + damage, 0)).toBe(
      without.damage,
    );
    expect(without.dps).toBe(without.damage / 40);
    expect(without.starvedPct).toBeGreaterThanOrEqual(0);
    expect(without.starvedPct).toBeLessThanOrEqual(1);
  });
});
