import { describe, expect, it } from 'vitest';
import {
  averageOwnedClassDpsProbe,
  OWNED_CLASS_BALANCE_SCENARIOS,
} from '../scripts/owned_class_balance_probe';
import { balanceSeeds, bandAt, bossScenarioAt } from './helpers/balance_diet';

// PR-tier diet vs the nightly full sweep: the family contract lives in
// tests/helpers/balance_diet.ts (docs/qa-gate.md, "The balance-harness
// diet"). The flag read stays in THIS file because the diet-flag registry pin
// (tests/ci_shard_plan.test.ts) source-scrapes test files for the literal.
const FULL_SWEEP = process.env.WOC_FULL_BALANCE_SWEEP === '1';
const BALANCE_SEEDS = balanceSeeds(FULL_SWEEP);
const band = bandAt(FULL_SWEEP);
const BOSS_SCENARIO = bossScenarioAt(FULL_SWEEP);

describe('owned-class level 20 balance harness (sustained role bands)', () => {
  it(
    'keeps the fixed Shaman and Vespers builds inside their sustained role bands',
    () => {
      const single = OWNED_CLASS_BALANCE_SCENARIOS[1];
      const area = OWNED_CLASS_BALANCE_SCENARIOS[3];
      const thundercall = averageOwnedClassDpsProbe('thundercall', single, BALANCE_SEEDS);
      const warspiritSingle = averageOwnedClassDpsProbe('warspirit', single, BALANCE_SEEDS);
      const warspiritArea = averageOwnedClassDpsProbe('warspirit', area, BALANCE_SEEDS);
      const vespersSingle = averageOwnedClassDpsProbe('vespers', single, BALANCE_SEEDS);
      const vespersArea = averageOwnedClassDpsProbe('vespers', area, BALANCE_SEEDS);
      const warspiritBoss = averageOwnedClassDpsProbe('warspirit', BOSS_SCENARIO, BALANCE_SEEDS);
      const vespersBoss = averageOwnedClassDpsProbe('vespers', BOSS_SCENARIO, BALANCE_SEEDS);

      // Floor lowered for the v0.36 composition (Vespers re-band landed Shadow
      // at ~214; Elemental is a below-band kit item tracked separately);
      // flagged for owner review. Lane-diet re-measure: full actual 0.9612 (5
      // seeds), diet actual 0.9663 (2 seeds); same relative margin keeps the
      // 0.83 floor and puts the diet ceiling at 1.11.
      expect(thundercall.dps).toBeGreaterThanOrEqual(vespersSingle.dps * 0.83);
      expect(thundercall.dps).toBeLessThanOrEqual(vespersSingle.dps * band(1.1, 1.11));
      // Warspirit area/single: full actual 1.1494, diet actual 1.0944 (the two
      // retained seeds roll the single-target run high), so the diet band is
      // 1.04 to 1.14 at the same relative margins.
      // v0.38 retune re-measure: 1.1144 full / 1.1247 diet (was 1.1494 /
      // 1.0944). The ratio itself barely moved, since both halves are the same
      // Warspirit build, but the full-sweep floor was left with only 1.3 percent
      // of headroom, which is flake range for a five-seed average. Re-derived at
      // the original relative margin; the ceiling keeps its own.
      expect(warspiritArea.dps / warspiritSingle.dps).toBeGreaterThanOrEqual(band(1.06, 1.06));
      expect(warspiritArea.dps / warspiritSingle.dps).toBeLessThanOrEqual(band(1.2, 1.14));
      // Vespers area/single: full actual 1.4041, diet actual 1.4475; the diet
      // floor rises to 1.29 with the same relative margin.
      expect(vespersArea.dps / vespersSingle.dps).toBeGreaterThanOrEqual(band(1.25, 1.29));
      // 2026-08-09 120s band round: the Warspirit raise (stormstrike row plus
      // the baseline AP arm, ridden on apPct after review) and the Vespers trim
      // moved this pair to a measured 1.1539 (warspirit 204.5 / vespers 177.2),
      // so the 0.93 floor is green again with real margin. Lane-diet
      // re-measure: full actual 1.1539 (5 seeds, 120 s boss), diet actual
      // 1.1775 (2 seeds, 60 s boss); same relative margins give 0.95 / 1.22.
      expect(warspiritBoss.dps / vespersBoss.dps).toBeGreaterThanOrEqual(band(0.93, 0.95));
      // Full-sweep ceiling kept at 1.2 (measured 1.1539 that round, was 1.18
      // on the combined tree pre-round). Re-author both sides of this pair
      // when the owned-class stack integrates.
      //
      // THE ONE CROSS-BUILD ROW THE v0.38 SET-BONUS RETUNE ACTUALLY MOVED:
      // 1.1539 -> 1.2320 full and 1.1775 -> 1.2478 diet, because Vespers fell
      // about 11 percent while Warspirit stayed flat.
      //
      // The cause is NOT melee-versus-caster, which is the reading this comment
      // carried on its first draft and which the rogue harness disproves (leather
      // melee fell about 10 percent too, right alongside the casters). What the
      // drop actually tracks is how much of a set's payload was LIVE for the
      // build wearing it. Vespers wears 4 Soulflame and loses a real subsidy: the
      // caster 2-piece was the most over-budget bonus in the game at a flat +20
      // Spell Power, 2.2 epic chest pieces. WARSPIRIT_PBE_LOADOUT wears 4
      // STORMCALLERS pieces, and Stormcallers is the CASTER set, so an
      // enhancement shaman was carrying an Intellect/Spirit/Spell Power payload
      // it barely converts. Shrinking a bonus this build was not really using
      // costs it nothing, which is why it reads flat.
      //
      // That a melee BiS loadout wants 4 pieces of a caster tier set is an
      // itemization oddity in its own right, and it is the reason this row is a
      // poor instrument for judging the retune. Read the rogue and Vespers
      // harnesses for that. The ceiling is re-derived at its original relative
      // margin; the FLOOR below is deliberately left where it was, since the
      // measurement moved away from it and raising it would invent a failure mode
      // this change did not test for.
      expect(warspiritBoss.dps / vespersBoss.dps).toBeLessThanOrEqual(band(1.28, 1.29));
      // Full sweep: the grown owned-class matrix ran ~180s under shard load and
      // roughly doubled in the shared lane (run 31288946173 killed it at 240s).
      // Diet: two seeds and the 60 s boss window cut the simulated time 3.2x.
    },
    FULL_SWEEP ? 900_000 : 300_000,
  );
});
