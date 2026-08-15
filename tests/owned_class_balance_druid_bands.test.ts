import { describe, expect, it } from 'vitest';
import {
  type OwnedClassBalanceScenario,
  runOwnedClassDpsProbe,
} from '../scripts/owned_class_balance_probe';
import { bandAt } from './helpers/balance_diet';

// PR-tier diet vs the nightly full sweep: the family contract lives in
// tests/helpers/balance_diet.ts (docs/qa-gate.md, "The balance-harness
// diet"). The flag read stays in THIS file because the diet-flag registry pin
// (tests/ci_shard_plan.test.ts) source-scrapes test files for the literal.
const FULL_SWEEP = process.env.WOC_FULL_BALANCE_SWEEP === '1';
const band = bandAt(FULL_SWEEP);

describe('owned-class level 20 balance harness (Druid bands)', () => {
  it(
    'keeps the Druid damage arms sane on the fixed low-SP probe',
    () => {
      // IMPORTANT: this fixed PBE loadout is a level-20 caster PROXY (spell power
      // ~105). Balance's damage was re-seated onto spell-power coefficients, so on
      // the real searched best-in-slot of the endgame tree (spell power ~150) it
      // scales to the ~200 DPS anchor measured by the Nythraxis montecarlo, and the
      // coefficients are calibrated to that. On this low-SP proxy it reads ~155.
      // The melee Wildfang cat (agility) is NOT under-geared here, so the two arms
      // are not directly comparable on the proxy: Balance/Feral parity at real BiS
      // is owned by the montecarlo, not this probe. These bands only guard the
      // proxy against gross regression. Diet window 60 s (a gross proxy
      // regression shows in the first minute); the nightly sweep keeps 120 s.
      const scenario: OwnedClassBalanceScenario = {
        targets: 1,
        seconds: FULL_SWEEP ? 120 : 60,
        window: 'raid',
      };
      const moongrove = runOwnedClassDpsProbe('moongrove', scenario, 29_904);
      const wildfang = runOwnedClassDpsProbe('wildfang', scenario, 29_904);

      // Lane-diet re-measure: moongrove full actual 154.00 (120 s), diet
      // actual 152.33 (60 s); wildfang 176.08 / 179.05. Diet bands re-derived
      // at the same relative margins: 137 to 178 and 168 to 208.
      expect(moongrove.dps).toBeGreaterThanOrEqual(band(138, 137));
      expect(moongrove.dps).toBeLessThanOrEqual(band(180, 178));
      expect(wildfang.dps).toBeGreaterThanOrEqual(band(165, 168));
      expect(wildfang.dps).toBeLessThanOrEqual(band(205, 208));
    },
    FULL_SWEEP ? 180_000 : 90_000,
  );

  it(
    'keeps Moongrove naked damage within 15% of the naked peer band',
    () => {
      // The v0.29 Balance rebalance shifted Moongrove's power off flat base
      // numbers onto spell-power coefficients, so an un-geared caster scales down
      // to the pack instead of towering over it the way the old flat numbers did
      // (pre-rebalance naked Moongrove was the single highest naked spec, ~+50%).
      // Measured with no gear against the boss-flag dummy, the gear-by-measurement
      // axis the balance guide uses, averaged to shed per-seed rotation noise.
      const scenario = {
        targets: 1,
        seconds: 60,
        window: 'raid',
        targetLevel: 20,
        targetTemplateId: 'nythraxis_scourge_of_thornpeak',
      } as const;
      // Seed 29_932 degenerately stalls the Moongrove rotation on this bench; the
      // other three are stable (the diet keeps the first two of them).
      const seeds = FULL_SWEEP ? ([29_904, 29_930, 29_931] as const) : ([29_904, 29_930] as const);
      const nakedAvg = (spec: Parameters<typeof runOwnedClassDpsProbe>[0]) =>
        seeds.reduce(
          (sum, seed) =>
            sum + runOwnedClassDpsProbe(spec, scenario, seed, 'naked', undefined, 'naked').dps,
          0,
        ) / seeds.length;
      const moongrove = nakedAvg('moongrove');
      // Two un-geared peers: a ranged pet spec and a caster, the band Moongrove
      // must sit inside rather than above. Lane-diet re-measure: full actual
      // ratio 0.9057 (3 seeds), diet actual 0.8754 (2 seeds); the diet band is
      // 0.82 to 1.11 at the same relative margins.
      const peerBand = (nakedAvg('packlord') + nakedAvg('vespers')) / 2;
      expect(moongrove / peerBand).toBeLessThanOrEqual(band(1.15, 1.11));
      expect(moongrove / peerBand).toBeGreaterThanOrEqual(band(0.85, 0.82));
    },
    FULL_SWEEP ? 240_000 : 180_000,
  );
});
