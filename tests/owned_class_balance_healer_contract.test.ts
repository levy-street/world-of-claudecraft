import { describe, expect, it } from 'vitest';
import { averageOwnedHealerProbe } from '../scripts/owned_class_balance_probe';
import { balanceSeeds, bandAt } from './helpers/balance_diet';

// PR-tier diet vs the nightly full sweep: the family contract lives in
// tests/helpers/balance_diet.ts (docs/qa-gate.md, "The balance-harness
// diet"). The flag read stays in THIS file because the diet-flag registry pin
// (tests/ci_shard_plan.test.ts) source-scrapes test files for the literal.
const FULL_SWEEP = process.env.WOC_FULL_BALANCE_SWEEP === '1';
const BALANCE_SEEDS = balanceSeeds(FULL_SWEEP);
const band = bandAt(FULL_SWEEP);

describe('owned-class level 20 balance harness (healer contract)', () => {
  it(
    'keeps each healer build inside its seed-averaged role and mana contract',
    () => {
      const spiritmendSingle = averageOwnedHealerProbe('spiritmend', 1, BALANCE_SEEDS);
      const spiritmendGroup = averageOwnedHealerProbe('spiritmend', 3, BALANCE_SEEDS);
      const doctrineSingle = averageOwnedHealerProbe('doctrine', 1, BALANCE_SEEDS);
      const doctrineGroup = averageOwnedHealerProbe('doctrine', 3, BALANCE_SEEDS);
      const benisonSingle = averageOwnedHealerProbe('benison', 1, BALANCE_SEEDS);
      const benisonGroup = averageOwnedHealerProbe('benison', 3, BALANCE_SEEDS);

      // Lane-diet re-measure (full actuals at 5 seeds / diet at 2): the healer
      // probes are nearly seed-stable, so most same-relative-margin re-pins
      // land back on the full values at the diet's granularity: benison
      // recovery 4.75 in both, benisonGroup/spiritmendGroup hps ratio 1.0874 /
      // 1.0837 (floor stays 0.8), benison resourceEnd 924.0+982.2 / 924.0+986.5
      // (floors stay 250), spiritmendGroup resourceEnd 2234.2 / 2249.5 (floor
      // stays 1_200), doctrineSingle hps+dps 155.31 / 154.48 (floor stays 140),
      // doctrineGroup resourceEnd 719.6 / 727.5 (floor stays 150). The one
      // mover: doctrineGroup hps+dps+absorbed/60 measured 168.06 full / 182.28
      // diet, so the diet floor is 130.
      expect(benisonGroup.emergencyRecoverySeconds).toBeLessThan(
        spiritmendGroup.emergencyRecoverySeconds,
      );
      expect(benisonGroup.hps).toBeGreaterThanOrEqual(spiritmendGroup.hps * 0.8);
      expect(benisonSingle.resourceEnd).toBeGreaterThanOrEqual(250);
      expect(benisonGroup.resourceEnd).toBeGreaterThanOrEqual(250);
      expect(spiritmendGroup.resourceEnd).toBeGreaterThanOrEqual(1_200);
      expect(doctrineSingle.hps + doctrineSingle.dps).toBeGreaterThanOrEqual(140);
      expect(
        doctrineGroup.hps + doctrineGroup.dps + doctrineGroup.absorbedDamage / 60,
      ).toBeGreaterThanOrEqual(band(120, 130));
      expect(doctrineGroup.resourceEnd).toBeGreaterThanOrEqual(150);
      expect(spiritmendSingle.hps).toBeGreaterThan(0);
      // Same owned-class matrix growth as the DPS metric test in
      // owned_class_balance_dps_metrics, same long-sims lane contention
      // doubling; the diet runs two of the five seeds (~50s measured local).
    },
    FULL_SWEEP ? 720_000 : 240_000,
  );
});
