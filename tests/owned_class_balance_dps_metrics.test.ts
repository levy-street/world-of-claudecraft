import { describe, expect, it } from 'vitest';
import {
  OWNED_CLASS_BALANCE_SCENARIOS,
  OWNED_CLASS_PBE_LOADOUTS,
  OWNED_CLASS_PBE_TALENTS,
  OWNED_DPS_SPECS,
  runOwnedClassDpsMatrix,
  runOwnedClassDpsProbe,
} from '../scripts/owned_class_balance_probe';

// PR-tier diet vs the nightly full sweep: the family contract lives in
// tests/helpers/balance_diet.ts (docs/qa-gate.md, "The balance-harness
// diet"). The flag read stays in THIS file because the diet-flag registry pin
// (tests/ci_shard_plan.test.ts) source-scrapes test files for the literal.
const FULL_SWEEP = process.env.WOC_FULL_BALANCE_SWEEP === '1';

describe('owned-class level 20 balance harness (DPS metrics)', () => {
  it('defines the required one-target and three-target burst and sustained scenarios', () => {
    expect(OWNED_CLASS_BALANCE_SCENARIOS).toEqual([
      { targets: 1, seconds: 15, window: 'burst' },
      { targets: 1, seconds: 60, window: 'sustained' },
      { targets: 3, seconds: 15, window: 'burst' },
      { targets: 3, seconds: 60, window: 'sustained' },
    ]);
  });

  it(
    'records every requested damage metric for all six owned DPS specs',
    () => {
      // Diet: the two sustained scenarios carry every band assertion in this
      // suite, so the PR tripwire runs them alone; the 15 s burst scenarios
      // (metadata-only variants of the same rotation loop) ride the nightly
      // full matrix through runOwnedClassDpsMatrix, which also keeps the
      // exported matrix entry point itself covered nightly.
      const metricScenarios = FULL_SWEEP
        ? OWNED_CLASS_BALANCE_SCENARIOS
        : [OWNED_CLASS_BALANCE_SCENARIOS[1], OWNED_CLASS_BALANCE_SCENARIOS[3]];
      const results = FULL_SWEEP
        ? runOwnedClassDpsMatrix(29_900, 'test-head')
        : OWNED_DPS_SPECS.flatMap((spec) =>
            metricScenarios.map((scenario) =>
              runOwnedClassDpsProbe(spec, scenario, 29_900, 'test-head'),
            ),
          );
      // Literal 8, not OWNED_DPS_SPECS.length: the diet arm builds results
      // FROM that constant, so a derived expectation would move with any
      // accidental spec-list shrink instead of catching it (the raid harness
      // pins its cardinality the same way).
      expect(results).toHaveLength(8 * metricScenarios.length);
      expect(new Set(results.map((result) => result.spec))).toEqual(new Set(OWNED_DPS_SPECS));
      for (const result of results) {
        expect(result.head).toBe('test-head');
        expect(result.totalDamage).toBeGreaterThan(0);
        expect(result.dps).toBe(result.totalDamage / result.scenario.seconds);
        expect(Object.values(result.damageByTarget)).toHaveLength(result.scenario.targets);
        expect(Object.values(result.damageByTarget).reduce((sum, value) => sum + value, 0)).toBe(
          result.totalDamage,
        );
        expect(Object.keys(result.damageBySource).length).toBeGreaterThan(0);
        expect(Object.keys(result.castsByAbility).length).toBeGreaterThan(0);
        expect(result.buttonsPressed).toBeGreaterThan(0);
        expect(result.resource.end).toBeGreaterThanOrEqual(0);
        expect(result.resource.end).toBeLessThanOrEqual(result.resource.max);
        expect(Object.keys(result.equipment).length).toBeGreaterThan(0);
        expect(result.equipment).toEqual(OWNED_CLASS_PBE_LOADOUTS[result.spec]);
        const talents = OWNED_CLASS_PBE_TALENTS[result.spec];
        if (talents) expect(result.talents).toEqual(talents);
        expect(result.dualWielding).toBe(result.spec === 'warspirit');
      }
      const vespersArea = results.find(
        (result) =>
          result.spec === 'vespers' &&
          result.scenario.targets === 3 &&
          result.scenario.seconds === 60,
      );
      expect(vespersArea?.damageByTarget.target_2).toBeGreaterThan(0);
      expect(vespersArea?.damageByTarget.target_3).toBeGreaterThan(0);
      const thundercallArea = results.find(
        (result) =>
          result.spec === 'thundercall' &&
          result.scenario.targets === 3 &&
          result.scenario.seconds === 60,
      );
      expect(thundercallArea?.damageByTarget.target_2).toBeGreaterThan(0);
      expect(thundercallArea?.damageByTarget.target_3).toBeGreaterThan(0);
      expect(thundercallArea?.castsByAbility.Skybranch).toBeGreaterThan(0);
      const moongroveArea = results.find(
        (result) =>
          result.spec === 'moongrove' &&
          result.scenario.targets === 3 &&
          result.scenario.seconds === 60,
      );
      expect(moongroveArea?.damageByTarget.target_2).toBeGreaterThan(0);
      expect(moongroveArea?.damageByTarget.target_3).toBeGreaterThan(0);
      // The payoff is a CHOICE (Moonsurge or Sunwake) since Moongrove v3, so a
      // short window may legitimately never pick the sun; both-arm coverage is
      // pinned by the druid_engines parity scenario, which presses each.
      expect(
        (moongroveArea?.castsByAbility.Moonsurge ?? 0) +
          (moongroveArea?.castsByAbility.Sunwake ?? 0),
      ).toBeGreaterThan(0);
      const wildfangSustained = results.find(
        (result) =>
          result.spec === 'wildfang' &&
          result.scenario.targets === 1 &&
          result.scenario.seconds === 60,
      );
      expect(wildfangSustained?.castsByAbility.Redharvest).toBeGreaterThan(0);
      // The Stampede cooldown tripwire rides the sustained window at PR time
      // (a 60 s window contains the opener the burst window pinned); the burst
      // window's own copy runs on the nightly full matrix.
      const packlordSustained = results.find(
        (result) =>
          result.spec === 'packlord' &&
          result.scenario.targets === 1 &&
          result.scenario.seconds === 60,
      );
      expect(packlordSustained?.castsByAbility.Stampede).toBeGreaterThan(0);
      expect(packlordSustained?.damageBySource.Stampede).toBeGreaterThan(0);
      if (FULL_SWEEP) {
        const packlordBurst = results.find(
          (result) =>
            result.spec === 'packlord' &&
            result.scenario.targets === 1 &&
            result.scenario.seconds === 15,
        );
        expect(packlordBurst?.castsByAbility.Stampede).toBeGreaterThan(0);
        expect(packlordBurst?.damageBySource.Stampede).toBeGreaterThan(0);
      }
      // OWNED_DPS_SPECS grew 6 -> 8 with the druid overhaul (moongrove/wildfang).
      // Diet budget: ~67s measured local; 300s keeps the ~2.5x fast-runner
      // margin plus lane headroom.
    },
    FULL_SWEEP ? 480_000 : 300_000,
  );
});
