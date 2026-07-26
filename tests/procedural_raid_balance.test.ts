import { describe, expect, it } from 'vitest';
import {
  assertProceduralRaidBalanceRelease,
  RAID_BALANCE_SAMPLE_FLOOR,
  simulateProceduralRaidBalance,
} from '../scripts/procedural_raid_balance_core';

describe('procedural Nythraxis raid balance campaign', () => {
  it('is byte-deterministic and samples the shipped live-drop path', () => {
    const options = { samplesPerDifficulty: 2_000, seed: 71_237 };
    const first = simulateProceduralRaidBalance(options);
    const second = simulateProceduralRaidBalance(options);

    expect(second).toEqual(first);
    expect(first.campaign).toBe('nythraxis-raid-loot-v1');
    expect(first.totalGeneratedItems).toBe(4_000);
    expect(first.difficulties.map((row) => row.difficulty)).toEqual(['normal', 'heroic']);
    expect(first.difficulties.every((row) => row.uniqueUids === 2_000)).toBe(true);
    expect(first.deterministicFingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it('pins natural Legendary tails and deterministic acquisition caps', () => {
    const report = simulateProceduralRaidBalance({ samplesPerDifficulty: 100, seed: 9 });

    expect(report.naturalLegendaryChanceByKills.normal).toContainEqual({
      kills: 50,
      chancePct: 63.583,
    });
    expect(report.naturalLegendaryChanceByKills.heroic).toContainEqual({
      kills: 20,
      chancePct: 64.151,
    });
    expect(report.naturalLegendaryChanceByKills.heroic).toContainEqual({
      kills: 90,
      chancePct: 99.011,
    });
    expect(report.acquisition).toContainEqual({
      reward: 'Exact Raid-forged signature',
      fragments: 60,
      heroicMarks: 45,
      normalOnlyResets: null,
      heroicOnlyResets: 20,
      bothDifficultyResets: 15,
    });
    expect(report.acquisition).toContainEqual({
      reward: 'Legendary power tune',
      fragments: 6,
      heroicMarks: 6,
      normalOnlyResets: null,
      heroicOnlyResets: 2,
      bothDifficultyResets: 2,
    });
  });

  it('observes fixed item levels, rarity tables, and upper-half Heroic powers', () => {
    const report = simulateProceduralRaidBalance({ samplesPerDifficulty: 10_000, seed: 31 });
    const normal = report.difficulties.find((row) => row.difficulty === 'normal')!;
    const heroic = report.difficulties.find((row) => row.difficulty === 'heroic')!;

    expect(normal.expectedRates).toEqual({ rare: 0.65, epic: 0.33, legendary: 0.02 });
    expect(heroic.expectedRates).toEqual({ rare: 0.4, epic: 0.55, legendary: 0.05 });
    expect(normal.itemLevels).toEqual({ rare: 27, epic: 28, legendary: 32 });
    expect(heroic.itemLevels).toEqual({ rare: 31, epic: 32, legendary: 36 });
    expect(normal.violations).toEqual([]);
    expect(heroic.violations).toEqual([]);
    expect(heroic.powerObservations.length).toBeGreaterThan(0);
    expect(
      heroic.powerObservations.every(
        (row) => row.observedMin >= row.requiredMinimum && row.observedMax <= row.authoredMax,
      ),
    ).toBe(true);
  });

  it('fails closed below the release sample floor', () => {
    const report = simulateProceduralRaidBalance({ samplesPerDifficulty: 1_000, seed: 33 });

    expect(RAID_BALANCE_SAMPLE_FLOOR).toBe(100_000);
    expect(report.sampleFloorMet).toBe(false);
    expect(report.verdict).toBe('NOT_READY');
    expect(report.gateFailures).toContain(`sample floor is ${RAID_BALANCE_SAMPLE_FLOOR}`);
    expect(() => assertProceduralRaidBalanceRelease(report)).toThrow(
      'procedural raid balance gate failed',
    );
  });
});
