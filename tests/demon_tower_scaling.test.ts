// The Demon Tower's design promise is "ten floors, each more impossible than the
// last". That promise is testable, and this file is where it is enforced: every
// difficulty axis must STRICTLY increase floor over floor, the summit must clear
// the existing top rung of the rift ladder (heroic S), and the arena must
// tighten as you climb. A future tuning pass that flattens a step fails here.

import { describe, expect, it } from 'vitest';
import { RIFT_HEROIC_TUNING } from '../src/sim/rift/ranks';
import {
  clampTowerFloorIndex,
  DEMON_TOWER_FLOOR_COUNT,
  DEMON_TOWER_MAX_LIVE_DEMONS,
  demonTowerArenaRadius,
  demonTowerFloorTuning,
  isDemonTowerBossFloor,
} from '../src/sim/rift/tower_scaling';

const FLOORS = Array.from({ length: DEMON_TOWER_FLOOR_COUNT }, (_, i) => i);

describe('demon tower scaling: the escalation is real', () => {
  it('runs exactly ten floors', () => {
    expect(DEMON_TOWER_FLOOR_COUNT).toBe(10);
  });

  it('starts floor 1 at the untuned rift baseline', () => {
    const first = demonTowerFloorTuning(0);
    expect(first.floor).toBe(1);
    expect(first.healthMultiplier).toBe(1);
    expect(first.damageMultiplier).toBe(1);
    expect(first.addDamageMultiplier).toBe(1);
    expect(first.armorMultiplier).toBe(1);
  });

  // The core promise. Every axis, every adjacent pair, strictly greater.
  it.each([
    ['healthMultiplier'],
    ['damageMultiplier'],
    ['addDamageMultiplier'],
    ['armorMultiplier'],
  ] as const)('%s strictly increases on every one of the nine steps', (key) => {
    for (let k = 1; k < DEMON_TOWER_FLOOR_COUNT; k++) {
      const prev = demonTowerFloorTuning(k - 1)[key];
      const cur = demonTowerFloorTuning(k)[key];
      expect(cur, `floor ${k + 1} ${key} must exceed floor ${k}`).toBeGreaterThan(prev);
    }
  });

  it('summit exceeds heroic S on both health and damage, the previous top rung', () => {
    const summit = demonTowerFloorTuning(DEMON_TOWER_FLOOR_COUNT - 1);
    const s = RIFT_HEROIC_TUNING.S;
    expect(s).toBeDefined();
    expect(summit.healthMultiplier).toBeGreaterThan(s!.healthMultiplier);
    expect(summit.damageMultiplier).toBeGreaterThan(s!.damageMultiplier);
  });

  it('health outruns damage, so the summit is a wall and not a one-shot', () => {
    const summit = demonTowerFloorTuning(DEMON_TOWER_FLOOR_COUNT - 1);
    expect(summit.healthMultiplier).toBeGreaterThan(summit.damageMultiplier * 2);
  });

  it('mid-tower (floor 5) has passed A rank', () => {
    const mid = demonTowerFloorTuning(4);
    const a = RIFT_HEROIC_TUNING.A;
    expect(mid.healthMultiplier).toBeGreaterThan(a!.healthMultiplier);
    expect(mid.damageMultiplier).toBeGreaterThan(a!.damageMultiplier);
  });

  it('waves and pack size grow but never breach the live-demon cap', () => {
    for (let k = 1; k < DEMON_TOWER_FLOOR_COUNT; k++) {
      expect(demonTowerFloorTuning(k).waveCount).toBeGreaterThanOrEqual(
        demonTowerFloorTuning(k - 1).waveCount,
      );
      expect(demonTowerFloorTuning(k).packSize).toBeGreaterThan(
        demonTowerFloorTuning(k - 1).packSize,
      );
    }
    // The cap is what keeps a raid-scale floor from becoming a spawn storm.
    for (const k of FLOORS) {
      expect(demonTowerFloorTuning(k).packSize).toBeLessThanOrEqual(DEMON_TOWER_MAX_LIVE_DEMONS);
    }
    expect(demonTowerFloorTuning(0).waveCount).toBe(3);
    expect(demonTowerFloorTuning(9).waveCount).toBe(7);
    expect(demonTowerFloorTuning(0).packSize).toBe(5);
    expect(demonTowerFloorTuning(9).packSize).toBe(14);
  });

  it('boss mechanic budget widens with height and tops out at the full kit', () => {
    expect(demonTowerFloorTuning(0).mechanicLimit).toBe(1);
    expect(demonTowerFloorTuning(9).mechanicLimit).toBe(4);
    for (let k = 1; k < DEMON_TOWER_FLOOR_COUNT; k++) {
      expect(demonTowerFloorTuning(k).mechanicLimit).toBeGreaterThanOrEqual(
        demonTowerFloorTuning(k - 1).mechanicLimit,
      );
    }
  });

  it('gates on floors 3, 5, 7 and the summit, nowhere else', () => {
    // A raid should meet a real check roughly every other floor rather than
    // climbing five quiet floors to the first one.
    expect(FLOORS.filter(isDemonTowerBossFloor)).toEqual([2, 4, 6, 9]);
  });

  it('tightens the arena on every floor', () => {
    for (let k = 1; k < DEMON_TOWER_FLOOR_COUNT; k++) {
      expect(demonTowerArenaRadius(k)).toBeLessThan(demonTowerArenaRadius(k - 1));
    }
    expect(demonTowerArenaRadius(0)).toBe(34);
    expect(demonTowerArenaRadius(9)).toBe(22);
  });

  it('clamps out-of-range and non-finite floor indices instead of producing NaN', () => {
    expect(clampTowerFloorIndex(-5)).toBe(0);
    expect(clampTowerFloorIndex(99)).toBe(DEMON_TOWER_FLOOR_COUNT - 1);
    expect(clampTowerFloorIndex(Number.NaN)).toBe(0);
    expect(clampTowerFloorIndex(3.7)).toBe(3);
    for (const bad of [-1, 10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const t = demonTowerFloorTuning(bad);
      expect(Number.isFinite(t.healthMultiplier)).toBe(true);
      expect(Number.isFinite(demonTowerArenaRadius(bad))).toBe(true);
    }
  });
});
