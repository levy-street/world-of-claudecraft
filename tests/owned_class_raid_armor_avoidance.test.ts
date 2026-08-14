import { describe, expect, it } from 'vitest';
import {
  OWNED_CLASS_RAID_SCENARIOS,
  OWNED_DPS_SPECS,
  runOwnedClassDpsProbe,
  runOwnedClassRaidMatrix,
} from '../scripts/owned_class_balance_probe';
import { raidScenariosUnderTest } from './helpers/balance_diet';

// PR-tier diet vs the nightly full sweep: the family contract lives in
// tests/helpers/balance_diet.ts (docs/qa-gate.md, "The balance-harness
// diet"); the raid diet fights only the level-24 boss and keeps the 120 s
// window in BOTH configurations, because the mana-sustain, cast-cadence, and
// rare-avoidance assertions in this family are long-fight guards a shorter
// window would hollow out. The flag read stays in THIS file because the
// diet-flag registry pin (tests/ci_shard_plan.test.ts) source-scrapes test
// files for the literal.
const FULL_SWEEP = process.env.WOC_FULL_BALANCE_SWEEP === '1';
const RAID_SCENARIOS_UNDER_TEST = raidScenariosUnderTest(FULL_SWEEP);

describe('owned-class raid-level balance harness (armor and avoidance)', () => {
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
});
