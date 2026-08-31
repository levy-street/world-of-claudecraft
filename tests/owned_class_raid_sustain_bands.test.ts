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
        // The floors deliberately stay at that low-rolling round after the
        // 2026-08-26 re-measure below: re-authoring them off a high-rolling
        // shuffle would flap the next time these seeds roll Warspirit low.
        expect(warspirit.dps).toBeGreaterThanOrEqual(vespers.dps * band(0.81, 0.76));
        // 2026-08-26 Ignivar raid consolidation re-measure: the raid's content
        // adds reshuffled the shared-rng draws at the fixed seeds (the known
        // content-add class; no owned-class code moved and the cast cadence
        // actuals are identical, readyIdle 0.00 / buttons 72 and about 45 / 54),
        // lifting the full-sweep actuals to 1.1223 / 1.1030 / 1.0717 by target
        // level and the L24 diet actual to 1.0113. Ceilings re-authored at each
        // configuration's own prior margin over its own actual (full about 3
        // percent over the 1.1223 max, diet the looser PR-time margin over
        // 1.0113, which also clears the 1.0570 mid-consolidation roll).
        expect(warspirit.dps).toBeLessThanOrEqual(vespers.dps * band(1.16, 1.16));
        // 200 DPS convergence package re-measure (echo 0.25, baseline apPct
        // 0.05, Ancestral Strike 0.5, BiS-anchored fixture with the Unleash
        // weave): readyIdle actuals 44.6 to 45.5 full / 45.05 diet, buttons
        // 54.0 to 54.6 full / 54.5 diet; the trimmed AP and mana economy
        // waits on the cadence more (proc-and-react idle is the design, per
        // the spec-by-spec study). Bounds re-pinned at about a 10 percent
        // margin instead of the old 2x slack so the tripwire stays meaningful;
        // vespers resourceEnd unchanged (2201.0 / 2133.5).
        expect(warspirit.readyIdleSeconds).toBeLessThanOrEqual(band(50, 50));
        expect(warspirit.buttonsPressed).toBeGreaterThanOrEqual(50);
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
