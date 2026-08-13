import { describe, expect, it } from 'vitest';
import { averageHunterDps } from '../scripts/hunter_dps_probe';

// PR-tier diet vs the nightly full sweep (docs/qa-gate.md, "The
// balance-harness diet"): the PR long-sims lane averages two of the five
// fixed seeds (seed VALUES never change, only the count);
// WOC_FULL_BALANCE_SWEEP=1 (nightly only) restores all five. Bands are
// pinned per configuration via band(full, diet); re-pin each from its own
// printed actuals.
const FULL_SWEEP = process.env.WOC_FULL_BALANCE_SWEEP === '1';
const SEEDS = FULL_SWEEP ? [29001, 29002, 29003, 29004, 29005] : [29001, 29002];
const band = (full: number, diet: number): number => (FULL_SWEEP ? full : diet);
// Keep the release gate representative without making its wall time depend on runner load.
// The CLI probe retains the full 120-second fixture used for the PR balance evidence.
const SECONDS = 90;
// Full sweep: sized for the long-sims lane's slow-quartile runner (run
// 31296160254 ran these at 219s and 209s against the old 180s bound, sharing
// the runner with a harness marathon at workers=2). Diet: two-fifths the
// seeds (~43s per test measured local), budgeted with the same proportional
// slow-runner margin.
const TEST_TIMEOUT_MS = FULL_SWEEP ? 480_000 : 200_000;

function matrix(targets: number): Record<string, number> {
  return Object.fromEntries(
    (['beast_mastery', 'marksmanship', 'survival'] as const).map((spec) => [
      spec,
      averageHunterDps(spec, targets, SECONDS, SEEDS).dps,
    ]),
  );
}

// 2026-08-09 120s band round: MM and SV ability values were raised to land the
// gear-tier BiS bench inside the 150-200 band (MM 141 to 167.6, SV 136.8 to
// 167.7 at 120s BiS, BM unchanged at 200.7). This no-rows level-20 probe
// scenario weights the raised base literals far more heavily than the BiS
// bench does (AP riders are small in blues), so its ratios moved much further
// than the BiS ones (BiS single-target still has BM ahead: 200.7 vs 167.6 and
// 167.7). The acknowledged debt stands (owner 2026-08-09): the hunter
// kit-item pass closes the spread from BELOW by lifting BM.
//
// Band shape (review, PR 3201): every edge below either pins the DESIGN
// target or catches drift AWAY from it, and none goes red when the BM lift
// lands. Design intent: single-target parity within about five percent
// (ratios near 1.0) and a 1.10 to 1.15 Packlord three-target lead. The
// ceilings on mm/bm and sv/bm sit at this round's measured values (further
// MM/SV runaway fails); the floors sit just under the design parity band
// (paying the BM debt lands the ratios inside, still green); the 3T ceiling
// IS the design 1.15 and its floor is this round's measured value. After the
// kit-item pass, collapse these back to the design bands.
describe('Hunter v0.29 deterministic DPS alignment', () => {
  it(
    'holds the single-target loops between design parity and the band-round ceiling',
    () => {
      const dps = matrix(1);
      // Measured this round: mm/bm 1.5227 (116.3 / 76.4), sv/bm 1.2010 (the
      // survival percent arm is apPct after review round 3). Lane-diet
      // re-measure at two seeds: mm/bm 1.5073, sv/bm 1.2003. The floors are
      // DESIGN parity bounds (configuration-independent, so the BM lift
      // lands green in both configs); the ceilings are measurement-anchored
      // and re-pin at the same relative margins: mm/bm 1.56, sv/bm 1.29
      // (unchanged at two decimals).
      expect(dps.marksmanship / dps.beast_mastery).toBeGreaterThanOrEqual(0.95);
      expect(dps.marksmanship / dps.beast_mastery).toBeLessThanOrEqual(band(1.58, 1.56));
      expect(dps.survival / dps.beast_mastery).toBeGreaterThanOrEqual(0.92);
      expect(dps.survival / dps.beast_mastery).toBeLessThanOrEqual(1.29);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'holds the Packlord three-target lead under the design 1.15 ceiling',
    () => {
      const dps = matrix(3);
      const nextBest = Math.max(dps.marksmanship, dps.survival);
      // Measured this round: 0.8455 (BM 98.3 / MM 116.3). The design lead is
      // 1.10 to 1.15; the floor catches further MM/SV cleave runaway and the
      // ceiling stays the design bound so the BM lift lands inside it.
      // Lane-diet re-measure at two seeds: 0.8768, so the
      // measurement-anchored floor re-pins to 0.83 at the same relative
      // margin; the 1.15 ceiling is the design bound in both configs.
      expect(dps.beast_mastery / nextBest).toBeGreaterThanOrEqual(band(0.8, 0.83));
      expect(dps.beast_mastery / nextBest).toBeLessThanOrEqual(1.15);
    },
    TEST_TIMEOUT_MS,
  );
});
