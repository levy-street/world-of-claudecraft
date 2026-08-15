// Three deliberately authored raids replace the old ten-step formula. This
// suite pins the adapter contract: every runtime knob comes from the floor
// registry, the climb escalates, and invalid indices cannot leak NaN/state.

import { describe, expect, it } from 'vitest';
import { DEMON_TOWER_FLOORS } from '../src/sim/rift/tower_floors';
import {
  clampTowerFloorIndex,
  DEMON_TOWER_BOSS_FLOORS,
  DEMON_TOWER_FLOOR_COUNT,
  DEMON_TOWER_MAX_LIVE_DEMONS,
  demonTowerArenaRadius,
  demonTowerFloorTuning,
  isDemonTowerBossFloor,
} from '../src/sim/rift/tower_scaling';

const FLOORS = Array.from({ length: DEMON_TOWER_FLOOR_COUNT }, (_, i) => i);

describe('demon tower scaling: three authored raids', () => {
  it('derives exactly three floors from the canonical registry', () => {
    expect(DEMON_TOWER_FLOOR_COUNT).toBe(3);
    expect(DEMON_TOWER_FLOOR_COUNT).toBe(DEMON_TOWER_FLOORS.length);
  });

  it('pins the authored tuning curve and mechanic budgets', () => {
    expect(FLOORS.map(demonTowerFloorTuning)).toEqual([
      {
        floor: 1,
        healthMultiplier: 1,
        damageMultiplier: 1,
        addDamageMultiplier: 1,
        armorMultiplier: 1,
        waveCount: 4,
        packSize: 6,
        mechanicLimit: 2,
      },
      {
        floor: 2,
        healthMultiplier: 2,
        damageMultiplier: 1.45,
        addDamageMultiplier: 1.3,
        armorMultiplier: 1.25,
        waveCount: 4,
        packSize: 7,
        mechanicLimit: 3,
      },
      {
        floor: 3,
        healthMultiplier: 4.2,
        damageMultiplier: 2,
        addDamageMultiplier: 1.65,
        armorMultiplier: 1.5,
        waveCount: 5,
        packSize: 6,
        mechanicLimit: 4,
      },
    ]);
  });

  it.each([
    ['healthMultiplier'],
    ['damageMultiplier'],
    ['addDamageMultiplier'],
    ['armorMultiplier'],
    ['mechanicLimit'],
  ] as const)('%s strictly escalates on both ascents', (key) => {
    for (let k = 1; k < DEMON_TOWER_FLOOR_COUNT; k++) {
      expect(demonTowerFloorTuning(k)[key]).toBeGreaterThan(demonTowerFloorTuning(k - 1)[key]);
    }
  });

  it('keeps every authored pack below the shared live-demon ceiling', () => {
    for (const k of FLOORS) {
      expect(demonTowerFloorTuning(k).packSize).toBeLessThanOrEqual(DEMON_TOWER_MAX_LIVE_DEMONS);
    }
    expect(DEMON_TOWER_MAX_LIVE_DEMONS).toBe(18);
  });

  it('makes every floor a boss encounter while only accepting real floor indices', () => {
    expect([...DEMON_TOWER_BOSS_FLOORS]).toEqual([0, 1, 2]);
    expect(FLOORS.filter(isDemonTowerBossFloor)).toEqual([0, 1, 2]);
    for (const invalid of [-1, 3, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isDemonTowerBossFloor(invalid)).toBe(false);
    }
  });

  it('doubles the authored floor diameters while tightening each ascent', () => {
    expect(FLOORS.map(demonTowerArenaRadius)).toEqual([64, 62, 60]);
    for (let k = 1; k < DEMON_TOWER_FLOOR_COUNT; k++) {
      expect(demonTowerArenaRadius(k)).toBeLessThan(demonTowerArenaRadius(k - 1));
    }
  });

  it('clamps out-of-range and non-finite indices deterministically', () => {
    expect(clampTowerFloorIndex(-5)).toBe(0);
    expect(clampTowerFloorIndex(99)).toBe(2);
    expect(clampTowerFloorIndex(Number.NaN)).toBe(0);
    expect(clampTowerFloorIndex(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampTowerFloorIndex(1.9)).toBe(1);
    for (const bad of [-1, 3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(demonTowerFloorTuning(bad)).toEqual(demonTowerFloorTuning(bad));
      expect(Number.isFinite(demonTowerFloorTuning(bad).healthMultiplier)).toBe(true);
      expect(Number.isFinite(demonTowerArenaRadius(bad))).toBe(true);
    }
  });
});
