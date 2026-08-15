import { describe, expect, it } from 'vitest';
import { averageOwnedClassDpsProbe } from '../scripts/owned_class_balance_probe';
import { balanceSeeds, bandAt, raidScenariosUnderTest } from './helpers/balance_diet';

// PR-tier diet vs the nightly full sweep: the family contract lives in
// tests/helpers/balance_diet.ts (docs/qa-gate.md, "The balance-harness
// diet"); the raid diet fights only the level-24 boss over two of the five
// fixed seeds and keeps the 120 s window in BOTH configurations, because the
// mana-sustain (resourceEnd), cast-cadence (readyIdleSeconds, buttonsPressed),
// and rare-avoidance assertions here are long-fight guards a shorter window
// would hollow out. The flag read stays in THIS file because the diet-flag
// registry pin (tests/ci_shard_plan.test.ts) source-scrapes test files for
// the literal.
const FULL_SWEEP = process.env.WOC_FULL_BALANCE_SWEEP === '1';
const RAID_BALANCE_SEEDS = balanceSeeds(FULL_SWEEP);
const RAID_SCENARIOS_UNDER_TEST = raidScenariosUnderTest(FULL_SWEEP);
const band = bandAt(FULL_SWEEP);

describe('owned-class raid-level balance harness (sustain bands)', () => {
  it(
    'pins a Thundercall raid sustain floor against Vespers and keeps Warspirit in a stable band, cast cadence included',
    () => {
      for (const scenario of RAID_SCENARIOS_UNDER_TEST) {
        const thundercall = averageOwnedClassDpsProbe('thundercall', scenario, RAID_BALANCE_SEEDS);
        const warspirit = averageOwnedClassDpsProbe('warspirit', scenario, RAID_BALANCE_SEEDS);
        const vespers = averageOwnedClassDpsProbe('vespers', scenario, RAID_BALANCE_SEEDS);
        // Re-authored on the owned-class stack integration (#2328 landed here;
        // 0.6922 was that round's whole-sweep figure). Lane-diet re-measure at
        // L24: full-sweep actual 0.7827 (5 seeds), diet actual 0.7830 (2
        // seeds), so the same relative margin lands both floors on 0.69.
        // Floor only, deliberately: Thundercall has no matching ceiling here
        // pending the Shaman kit-item pass, so a real upside swing is allowed
        // to pass.
        expect(thundercall.dps).toBeGreaterThanOrEqual(vespers.dps * 0.69);
        // Cadence actuals are identical at both configurations (readyIdle 0.00,
        // buttons 72.0), so these bounds carry over unchanged.
        expect(thundercall.readyIdleSeconds).toBeLessThanOrEqual(15);
        expect(thundercall.buttonsPressed).toBeGreaterThanOrEqual(65);
        // 2026-08-09 120s band round measured 1.0568 / 1.0266 / 0.9776 by
        // target level at five seeds, backing the full-sweep 0.81 floor.
        // Lane-diet re-measure at L24: full actual 0.9776, diet actual 0.9143
        // (seeds 29_930/29_931 roll Warspirit low), so the diet floor is 0.76
        // and ceiling 1.05, the same relative margins at the diet actual.
        expect(warspirit.dps).toBeGreaterThanOrEqual(vespers.dps * band(0.81, 0.76));
        // Full-sweep ceiling kept at 1.12 (level-22 measured 1.0568 that
        // round). Re-author the pair when the owned-class stack integrates.
        expect(warspirit.dps).toBeLessThanOrEqual(vespers.dps * band(1.12, 1.05));
        // Warspirit readyIdle actuals 19.40 full / 19.00 diet; buttons 72.0 /
        // 72.5; vespers resourceEnd 2201.0 / 2133.5. Same-relative-margin
        // re-pins at the diet actuals.
        expect(warspirit.readyIdleSeconds).toBeLessThanOrEqual(band(40, 39));
        expect(warspirit.buttonsPressed).toBeGreaterThanOrEqual(55);
        expect(vespers.resourceEnd).toBeGreaterThanOrEqual(band(800, 775));
        // Nonzero avoidance pins hold with margin at the diet configuration
        // too (resist 15.5 / 1.5 averaged, miss+dodge 29).
        expect(thundercall.outcomes.resist).toBeGreaterThan(0);
        expect(warspirit.outcomes.miss + warspirit.outcomes.dodge).toBeGreaterThan(0);
        expect(vespers.outcomes.resist).toBeGreaterThan(0);
      }
      // Full sweep: 3 scenarios x 3 specs x 5 seeds of raid-length sim, ~510s
      // measured on the integrated tree solo; in a lane at workers=2 it shared
      // the runner with the level-20 harness marathon and run 31288946173
      // killed it at 600s. Diet: 1 scenario x 3 specs x 2 seeds, ~56s measured
      // local.
    },
    FULL_SWEEP ? 1_800_000 : 240_000,
  );
});
