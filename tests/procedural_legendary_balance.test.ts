import { describe, expect, it } from 'vitest';
import {
  assertLegendaryBalanceRelease,
  LEGENDARY_BALANCE_CLASSES,
  LEGENDARY_BALANCE_SAMPLE_FLOOR,
  LEGENDARY_BUILD_PROFILES,
  simulateLegendaryBalance,
} from '../scripts/procedural_legendary_balance_core';
import { PROCEDURAL_LEGENDARY_POWERS } from '../src/sim/content/procedural_legendary_powers';

describe('procedural legendary balance campaign', () => {
  it('covers every power, class, and representative build band', () => {
    const report = simulateLegendaryBalance({ samplesPerRollEdge: 250, seed: 7 });

    expect(new Set(report.powerIds)).toEqual(new Set(Object.keys(PROCEDURAL_LEGENDARY_POWERS)));
    expect(new Set(report.playerClasses)).toEqual(new Set(LEGENDARY_BALANCE_CLASSES));
    expect(new Set(report.profileIds)).toEqual(
      new Set(LEGENDARY_BUILD_PROFILES.map((profile) => profile.id)),
    );
    expect(report.fullCoverage).toBe(true);
    expect(report.totalRows).toBe(160);
    expect(report.rows.every((row) => row.samplesPerRollEdge === 250)).toBe(true);
  });

  it('is byte-deterministic for a fixed seed and option set', () => {
    const options = {
      samplesPerRollEdge: 1_000,
      seed: 0x71a9,
      profileIds: ['pre_raid_l20'] as const,
      playerClasses: ['hunter', 'mage'] as const,
      powerIds: ['hushwood_longbow', 'bell_of_the_ninth_peal'] as const,
    };
    const first = simulateLegendaryBalance(options);
    const second = simulateLegendaryBalance(options);

    expect(second).toEqual(first);
    expect(second.deterministicFingerprint).toBe(first.deterministicFingerprint);
  });

  it('runs chance, cadence, cooldown, and roll ranges through the shipped runtime', () => {
    const report = simulateLegendaryBalance({
      samplesPerRollEdge: 100_000,
      seed: 0x51a7,
      profileIds: ['pre_raid_l20'],
      playerClasses: ['hunter'],
      powerIds: ['hushwood_longbow'],
    });
    const row = report.rows[0];

    expect(row.samplesPerRollEdge).toBe(LEGENDARY_BALANCE_SAMPLE_FLOOR);
    expect(row.rngDrawCount.minimum).toBeGreaterThan(0);
    expect(row.triggerCount.minimum).toBeGreaterThan(0);
    expect(row.silenceSecondsPerMinute.minimum).toBeGreaterThan(0);
    expect(row.silenceSecondsPerMinute.maximum).toBeGreaterThan(
      row.silenceSecondsPerMinute.minimum,
    );
  });

  it('separates damage, healing, mitigation, resource, control, cleave, and mobility', () => {
    const report = simulateLegendaryBalance({
      samplesPerRollEdge: 2_000,
      seed: 93,
      profileIds: ['pre_raid_l20'],
    });
    const byPower = Object.fromEntries(report.rows.map((row) => [row.powerId, row]));

    expect(byPower.crown_last_pyre.sustainedDamagePct.maximum).toBeGreaterThan(0);
    expect(byPower.stormwake_idol.cleaveDamagePct.maximum).toBeGreaterThan(0);
    expect(byPower.ysoleis_vigil.sustainedHealingPct.maximum).toBeGreaterThan(0);
    expect(byPower.dawnward_signet.sustainedMitigationPct.maximum).toBeGreaterThan(0);
    expect(byPower.feral_moonclasp.resourcePerMinute.maximum).toBeGreaterThan(0);
    expect(byPower.hushwood_longbow.silenceSecondsPerMinute.maximum).toBeGreaterThan(0);
    expect(byPower.boots_of_the_unbroken_road.movementAveragePct.maximum).toBeGreaterThan(0);
  });

  it('keeps tuned damage powers inside sustained and burst gates', () => {
    const report = simulateLegendaryBalance({
      samplesPerRollEdge: 10_000,
      seed: 0x5a17,
      powerIds: ['crown_last_pyre', 'greyjaws_edge', 'ashbinders_seal', 'bell_of_the_ninth_peal'],
    });

    expect(report.gateFailures).toEqual([]);
  });

  it('makes release enforcement fail closed on sample, coverage, and contribution gaps', () => {
    const report = simulateLegendaryBalance({
      samplesPerRollEdge: 1_000,
      seed: 17,
      profileIds: ['pre_raid_l20'],
      playerClasses: ['mage'],
      powerIds: ['crown_last_pyre'],
    });

    expect(report.sampleFloorMet).toBe(false);
    expect(report.fullCoverage).toBe(false);
    expect(report.verdict).toBe('NOT_READY');
    expect(() => assertLegendaryBalanceRelease(report)).toThrow('legendary balance gate failed');
  });
});
