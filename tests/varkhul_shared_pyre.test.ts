import { describe, expect, it } from 'vitest';

import {
  VARKHUL_SHARED_PYRE_AURA_ID,
  VARKHUL_SHARED_PYRE_CAST_SECONDS,
  VARKHUL_SHARED_PYRE_EVERY_SECONDS,
  VARKHUL_SHARED_PYRE_FIRST_SECONDS,
  VARKHUL_SHARED_PYRE_RADIUS,
  VARKHUL_SHARED_PYRE_RAID_DAMAGE_PER_MISSING,
  VARKHUL_SHARED_PYRE_REQUIRED_PLAYERS,
  varkhulSharedPyreDamageFraction,
  varkhulSharedPyreEligibleTargets,
  varkhulSharedPyreRaidDamageFraction,
  varkhulSharedPyreRequiredPlayers,
  varkhulSharedPyreTotalDamageFraction,
} from '../src/sim/varkhul_shared_pyre';

describe('Varkhul Shared Pyre', () => {
  it('prices the intended raid split separately for Normal and Heroic', () => {
    expect(VARKHUL_SHARED_PYRE_AURA_ID).toBe('varkhul_shared_pyre');
    expect(VARKHUL_SHARED_PYRE_CAST_SECONDS).toBe(6);
    expect(VARKHUL_SHARED_PYRE_FIRST_SECONDS).toBe(20);
    expect(VARKHUL_SHARED_PYRE_EVERY_SECONDS).toBe(38);
    expect(VARKHUL_SHARED_PYRE_RADIUS).toBe(5.5);
    expect(VARKHUL_SHARED_PYRE_REQUIRED_PLAYERS).toBe(4);
    expect(varkhulSharedPyreRequiredPlayers('normal')).toBe(4);
    expect(varkhulSharedPyreRequiredPlayers('heroic')).toBe(4);
    expect(varkhulSharedPyreDamageFraction('normal', 4)).toBeCloseTo(0.35, 10);
    expect(varkhulSharedPyreDamageFraction('heroic', 4)).toBeCloseTo(0.5, 10);
    expect(varkhulSharedPyreDamageFraction('heroic', 1)).toBe(2);
    expect(varkhulSharedPyreTotalDamageFraction('normal')).toBe(1.4);
    expect(varkhulSharedPyreTotalDamageFraction('heroic')).toBe(2);
  });

  it('prices raid damage at fifteen percent per missing soaker', () => {
    expect(VARKHUL_SHARED_PYRE_RAID_DAMAGE_PER_MISSING).toBe(0.15);
    expect(varkhulSharedPyreRaidDamageFraction(5)).toBe(0);
    expect(varkhulSharedPyreRaidDamageFraction(4)).toBe(0);
    expect(varkhulSharedPyreRaidDamageFraction(3)).toBeCloseTo(0.15, 10);
    expect(varkhulSharedPyreRaidDamageFraction(2)).toBeCloseTo(0.3, 10);
    expect(varkhulSharedPyreRaidDamageFraction(1)).toBeCloseTo(0.45, 10);
    expect(varkhulSharedPyreRaidDamageFraction(0)).toBeCloseTo(0.6, 10);
  });

  it('waits rather than selecting a non-tank with an uncleared fire mark', () => {
    const marked = [
      { id: 1, dead: false, auras: [{ id: 'varkhul_red_hot_metal' }] },
      { id: 2, dead: false, auras: [{ id: 'varkhul_red_hot_metal_absorb' }] },
    ];
    expect(varkhulSharedPyreEligibleTargets(marked, new Set())).toEqual([]);
  });

  it('excludes tanks and players still carrying either Red-hot Metal effect', () => {
    const players = [
      { id: 1, dead: false, auras: [] },
      { id: 2, dead: false, auras: [] },
      { id: 3, dead: false, auras: [{ id: 'varkhul_red_hot_metal' }] },
      { id: 4, dead: false, auras: [{ id: 'varkhul_red_hot_metal_absorb' }] },
      { id: 5, dead: true, auras: [] },
    ];
    expect(
      varkhulSharedPyreEligibleTargets(players, new Set([1])).map((player) => player.id),
    ).toEqual([2]);
  });
});
