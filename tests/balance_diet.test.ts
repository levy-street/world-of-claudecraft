import { describe, expect, it } from 'vitest';
import {
  balanceSeeds,
  bandAt,
  bossScenarioAt,
  raidScenariosUnderTest,
} from './helpers/balance_diet';

// Pins the diet helper's BOTH arms against literals. Every PR-time caller
// passes false, so without this the full-sweep arm executes only nightly and
// a typo there (a dropped seed, the boss window landing on the wrong branch,
// the raid diet drifting off level 24) would silently thin the nightly sweep
// while every band stayed green over a quietly different configuration. The
// expected values are LITERALS on purpose: asserting against the constants
// the helper itself imports would be a constant-self-comparison that can
// never fail.
describe('balance diet helper', () => {
  it('derives the full and diet seed tuples from the fixed seed values', () => {
    expect([...balanceSeeds(true)]).toEqual([29_930, 29_931, 29_932, 29_933, 29_934]);
    expect([...balanceSeeds(false)]).toEqual([29_930, 29_931]);
  });

  it('selects the full band value on the sweep arm and the diet value otherwise', () => {
    expect(bandAt(true)(1.15, 1.11)).toBe(1.15);
    expect(bandAt(false)(1.15, 1.11)).toBe(1.11);
  });

  it('halves the level-20 boss window on the diet arm and only the window', () => {
    const full = bossScenarioAt(true);
    const diet = bossScenarioAt(false);
    expect(full.seconds).toBe(120);
    expect(diet.seconds).toBe(60);
    expect({ ...full, seconds: 0 }).toEqual({ ...diet, seconds: 0 });
  });

  it('keeps all three raid levels on the sweep arm and only level 24 on the diet', () => {
    expect(raidScenariosUnderTest(true).map((s) => s.targetLevel)).toEqual([22, 23, 24]);
    expect(raidScenariosUnderTest(false).map((s) => s.targetLevel)).toEqual([24]);
    // BOTH arms keep the 120 s window and the real boss template: the raid
    // diet reduces levels and seeds only, never the window (the helper's
    // contract; a diet member quietly halving its window would hollow out the
    // long-fight guards while this file stayed green on the sweep arm alone).
    for (const scenario of [...raidScenariosUnderTest(true), ...raidScenariosUnderTest(false)]) {
      expect(scenario.seconds).toBe(120);
      expect(scenario.targetTemplateId).toBe('nythraxis_scourge_of_thornpeak');
    }
  });
});
