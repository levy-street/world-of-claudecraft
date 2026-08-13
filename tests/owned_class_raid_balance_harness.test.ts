import { describe, expect, it } from 'vitest';
import {
  averageOwnedClassDpsProbe,
  OWNED_CLASS_RAID_SCENARIOS,
  OWNED_DPS_SPECS,
  runOwnedClassDpsProbe,
  runOwnedClassRaidMatrix,
} from '../scripts/owned_class_balance_probe';

// PR-tier diet vs the nightly full sweep (docs/qa-gate.md, "The
// balance-harness diet"). This suite is a regression tripwire, not a
// measurement, so the PR long-sims lane fights only the level-24 boss (the
// tightest FLOOR of the three raid profiles; the warspirit/vespers CEILING
// is tightest at level 22, so that arm's PR-time margin is looser than the
// sweep's tightest and its full-depth copy is nightly-only) over two of the
// five fixed seeds; WOC_FULL_BALANCE_SWEEP=1 (set only by the nightly
// workflow) restores the full three-level, five-seed sweep. The 120 s window stays in BOTH
// configurations: the mana-sustain (resourceEnd), cast-cadence
// (readyIdleSeconds, buttonsPressed), and rare-avoidance assertions here are
// long-fight guards a shorter window would hollow out. Every band is pinned
// to a measurement at ITS OWN configuration via band(full, diet); re-pin both
// from their own printed actuals when balance moves, never one from the
// other.
const FULL_SWEEP = process.env.WOC_FULL_BALANCE_SWEEP === '1';
// Seed VALUES are fixed and never change here; only the count does.
const RAID_BALANCE_SEEDS = FULL_SWEEP
  ? ([29_930, 29_931, 29_932, 29_933, 29_934] as const)
  : ([29_930, 29_931] as const);
const RAID_SCENARIOS_UNDER_TEST = FULL_SWEEP
  ? OWNED_CLASS_RAID_SCENARIOS
  : [OWNED_CLASS_RAID_SCENARIOS[2]];
const band = (full: number, diet: number): number => (FULL_SWEEP ? full : diet);

describe('owned-class raid-level balance harness', () => {
  it('defines 120-second Nythraxis profiles at levels 22 through 24', () => {
    expect(OWNED_CLASS_RAID_SCENARIOS).toEqual([
      {
        targets: 1,
        seconds: 120,
        window: 'raid',
        targetLevel: 22,
        targetTemplateId: 'nythraxis_scourge_of_thornpeak',
      },
      {
        targets: 1,
        seconds: 120,
        window: 'raid',
        targetLevel: 23,
        targetTemplateId: 'nythraxis_scourge_of_thornpeak',
      },
      {
        targets: 1,
        seconds: 120,
        window: 'raid',
        targetLevel: 24,
        targetTemplateId: 'nythraxis_scourge_of_thornpeak',
      },
    ]);
  });

  it(
    'records real boss armor and avoided attacks for every DPS spec',
    () => {
      // Full sweep: the exported matrix runner over all three levels (which
      // also keeps that entry point covered nightly). Diet: the same probes at
      // level 24 only, where avoidance rolls against the +4 boss are the most
      // frequent of the three levels, so the per-spec avoided pins keep the
      // deepest margin the sweep offers.
      const results = FULL_SWEEP
        ? runOwnedClassRaidMatrix(29_930, 'raid-test-head')
        : OWNED_DPS_SPECS.flatMap((spec) =>
            RAID_SCENARIOS_UNDER_TEST.map((scenario) =>
              runOwnedClassDpsProbe(spec, scenario, 29_930, 'raid-test-head'),
            ),
          );
      expect(results).toHaveLength(RAID_SCENARIOS_UNDER_TEST.length * 8);

      const avoidedBySpec = new Map<string, number>();
      for (const result of results) {
        expect(result.scenario.seconds).toBe(120);
        const targetLevel = result.scenario.targetLevel;
        expect(targetLevel).toBeDefined();
        if (!targetLevel) continue;
        // At PR time this pins the formula at the single retained level (a
        // deliberate diet trade: the slope across 22/23/24 is nightly-only,
        // where all three levels still assert it).
        expect(result.targetArmor).toBe(42 * (targetLevel - 1));
        expect(result.dps).toBeGreaterThan(0);
        expect(result.outcomes.hit).toBeGreaterThan(0);
        avoidedBySpec.set(
          result.spec,
          (avoidedBySpec.get(result.spec) ?? 0) +
            result.outcomes.miss +
            result.outcomes.dodge +
            result.outcomes.parry +
            result.outcomes.resist,
        );
      }
      // Avoidance is pinned per SPEC across the scenarios under test: a
      // caster's resist chance against the +2 boss is a rare roll, and
      // demanding one in every single 120-second window turns the pin into a
      // seed lottery. (The diet's single level-24 window is where avoidance
      // rolls are most frequent; measured avoided counts per spec at the diet
      // configuration run 3 to 46, deterministic at the fixed seed, with
      // vespers the 3-count minimum.)
      for (const [spec, avoided] of avoidedBySpec) {
        expect(avoided, spec).toBeGreaterThan(0);
      }

      const warspirit = results.find(
        (result) => result.spec === 'warspirit' && result.scenario.targetLevel === 24,
      );
      expect((warspirit?.outcomes.miss ?? 0) + (warspirit?.outcomes.dodge ?? 0)).toBeGreaterThan(0);

      for (const spec of new Set(results.map((result) => result.spec))) {
        const avoided = results
          .filter((result) => result.spec === spec)
          .reduce(
            (total, result) =>
              total +
              result.outcomes.miss +
              result.outcomes.dodge +
              result.outcomes.parry +
              result.outcomes.resist,
            0,
          );
        expect(avoided, spec).toBeGreaterThan(0);
      }

      for (const targetLevel of RAID_SCENARIOS_UNDER_TEST.map((scenario) => scenario.targetLevel)) {
        const levelResults = results.filter(
          (result) => result.scenario.targetLevel === targetLevel,
        );
        const orderedDps = levelResults
          .map((result) => result.dps)
          .sort((left, right) => left - right);
        const middle = orderedDps.length / 2;
        const medianDps = (orderedDps[middle - 1] + orderedDps[middle]) / 2;
        // Best NON-vespers spec, not the array max: vespers is the top spec
        // at some levels, and vespers <= max(all) * 1.05 is an identity that
        // can never fail (the lane-diet audit caught the old top-of-array
        // form as vacuous). Measured vespers/bestOther at seed 29_930:
        // 0.9196 (L22) / 0.9990 (L23) / 1.0231 (L24), so the 1.05 ceiling
        // binds in both configurations; vespers/median 1.1647 / 1.1436 /
        // 1.1257 backs the 0.95 floor. The retained level-24 window is
        // byte-identical in both configurations (same seed, same 120 s).
        const bestOtherDps = Math.max(
          ...levelResults.filter((result) => result.spec !== 'vespers').map((result) => result.dps),
        );
        const vespersDps = levelResults.find((result) => result.spec === 'vespers')?.dps ?? 0;
        expect(vespersDps).toBeGreaterThanOrEqual(medianDps * 0.95);
        expect(vespersDps).toBeLessThanOrEqual(bestOtherDps * 1.05);
      }
      // OWNED_DPS_SPECS grew 6 -> 8 with the druid overhaul (moongrove/wildfang).
      // Long-sims lane contention (workers=2, run 31288946173) roughly doubles
      // the shard-calibrated wall. Diet budget: ~75s measured local at one
      // scenario; 300s keeps the ~2.5x fast-runner margin plus lane headroom.
    },
    FULL_SWEEP ? 900_000 : 300_000,
  );

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
