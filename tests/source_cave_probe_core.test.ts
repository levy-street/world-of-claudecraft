import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  aggregateProbeRuns,
  DEFAULT_SOURCE_CAVE_PROBE_SEEDS,
  hunterProbePosition,
  parseProbeSeeds,
  SOURCE_CAVE_PROBE_PROFILES,
  validateProbeWaveActivation,
} from '../scripts/source_cave_probe_core';
import { runProbe } from '../scripts/source_cave_raid_probe';

describe('source cave probe profiles and seeds', () => {
  it('defines four full-raid profiles with explicit AoE and pet policies', () => {
    expect(Object.keys(SOURCE_CAVE_PROBE_PROFILES).sort()).toEqual([
      'aoe',
      'single-target-hunter',
      'single-target-melee',
      'single-target-mixed',
    ]);
    for (const profile of Object.values(SOURCE_CAVE_PROBE_PROFILES)) {
      expect(profile.dpsClasses.length).toBe(6);
    }
    expect(SOURCE_CAVE_PROBE_PROFILES.aoe.allowPlayerAoe).toBe(true);
    expect(SOURCE_CAVE_PROBE_PROFILES['single-target-mixed'].allowPlayerAoe).toBe(false);
    expect(SOURCE_CAVE_PROBE_PROFILES['single-target-melee'].dpsClasses).toEqual(
      Array.from({ length: 6 }, () => 'rogue'),
    );
    expect(SOURCE_CAVE_PROBE_PROFILES['single-target-hunter']).toMatchObject({
      dpsClasses: Array.from({ length: 6 }, () => 'hunter'),
      controlledHunterPets: true,
      allowPlayerAoe: false,
    });
  });

  it('provides at least 20 unique deterministic seeds and preserves single-seed compatibility', () => {
    expect(DEFAULT_SOURCE_CAVE_PROBE_SEEDS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(DEFAULT_SOURCE_CAVE_PROBE_SEEDS).size).toBe(
      DEFAULT_SOURCE_CAVE_PROBE_SEEDS.length,
    );
    expect(parseProbeSeeds({ PROBE_SEED: '42' })).toEqual([42]);
    expect(parseProbeSeeds({ PROBE_SEEDS: '7, 42,1234,9001' })).toEqual([7, 42, 1234, 9001]);
    expect(parseProbeSeeds({})).toEqual(DEFAULT_SOURCE_CAVE_PROBE_SEEDS);
  });
});

describe('source cave probe pacing validation', () => {
  const base = {
    before: new Set([0]),
    after: new Set([0, 1]),
    livingWaveIndexes: [] as number[],
    nextWaveAt: 10,
    time: 9.95,
    dt: 0.05,
    totalWaves: 7,
    breached: false,
  };

  it('accepts exactly the next sequential wave when its timer expires', () => {
    expect(validateProbeWaveActivation(base)).toEqual({ valid: true });
  });

  it.each([
    [{ ...base, time: 9 }, 'before the pacing timer'],
    [{ ...base, livingWaveIndexes: [0] }, 'while another wave is alive'],
    [{ ...base, after: new Set([0, 2]) }, 'non-sequential wave'],
    [{ ...base, after: new Set([0, 1, 2]) }, 'multiple waves'],
    [{ ...base, breached: true }, 'breach'],
  ])('rejects %s', (input, reason) => {
    const result = validateProbeWaveActivation(input);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain(reason);
  });

  it('snapshots activation state before the runner makes any combat decision', () => {
    const source = readFileSync(
      new URL('../scripts/source_cave_raid_probe.ts', import.meta.url),
      'utf8',
    );
    const snapshot = source.indexOf('const activatedBeforeDecision');
    const combatDecision = source.indexOf('const mobs = activeMobs()');
    const tick = source.indexOf('const events = sim.tick()', combatDecision);
    const validation = source.indexOf('validateProbeWaveActivation', tick);
    expect(snapshot).toBeGreaterThan(0);
    expect(snapshot).toBeLessThan(combatDecision);
    expect(tick).toBeGreaterThan(combatDecision);
    expect(validation).toBeGreaterThan(tick);
  });
});

describe('source cave hunter probe positioning', () => {
  it('stays inside the seal and outside the hunter dead zone', () => {
    const centre = { x: 0, z: 0 };
    for (const target of [
      { x: 0, z: 0 },
      { x: 3, z: 4 },
      { x: -4, z: 2 },
    ]) {
      const position = hunterProbePosition(centre, target, 2);
      expect(Math.hypot(position.x, position.z)).toBeLessThan(10);
      expect(Math.hypot(position.x - target.x, position.z - target.z)).toBeGreaterThanOrEqual(8);
    }
  });
});

describe('source cave probe aggregation', () => {
  it('excludes invalid pacing runs and reports distribution metrics', () => {
    const result = aggregateProbeRuns([
      { outcome: 'cleared', seconds: 100, deaths: 1, minHealerManaPct: 8 },
      { outcome: 'cleared', seconds: 120, deaths: 2, minHealerManaPct: 4 },
      { outcome: 'wipe', seconds: 140, deaths: 10, minHealerManaPct: 0 },
      { outcome: 'invalid', seconds: 20, deaths: 0, minHealerManaPct: 100 },
    ]);
    expect(result).toMatchObject({
      validRuns: 3,
      invalidRuns: 1,
      clears: 2,
      clearRate: 2 / 3,
      medianClearSeconds: 110,
      p90Deaths: 10,
      p10MinHealerManaPct: 0,
    });
  });

  // The two real-raid runs simulate minutes of a 10-player fight, so they carry
  // their own budget instead of the 5 s default. It has been raised twice as the
  // sim got heavier per tick: the v0.29 combat retune, then the v0.32.0 base
  // (rift systems on the shared tick). They take ~15 s each on an idle machine,
  // and the whole point of the budget is to survive a fully parallel suite, so it
  // is sized for contention, not for the isolated time.
  it('runs a real controlled-hunter raid without an early pull', () => {
    const result = runProbe(7, SOURCE_CAVE_PROBE_PROFILES['single-target-hunter']);
    expect(result.outcome).toBe('cleared');
    expect(result.invalidReason).toBeNull();
    expect(result.hunterRepositions).toBeGreaterThan(0);
    expect(result.petDamageEvents).toBeGreaterThan(0);
  }, 60_000);

  it('runs a real AoE raid that casts AoE without waking a dormant wave', () => {
    const result = runProbe(7, SOURCE_CAVE_PROBE_PROFILES.aoe);
    expect(result.outcome).toBe('cleared');
    expect(result.invalidReason).toBeNull();
    expect(result.aoeCasts).toBeGreaterThan(0);
  }, 60_000);
});
