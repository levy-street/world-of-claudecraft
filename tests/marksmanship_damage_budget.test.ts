import { describe, expect, it } from 'vitest';
import { runMarksmanBalanceProbe } from '../scripts/marksmanship_balance_probe';
import baselineReceipts from './fixtures/marksmanship_balance_baseline.json';

type Receipt = ReturnType<typeof runMarksmanBalanceProbe>;
// Captured from the release before changing production values, using the
// identical real-combat harness. Never regenerate from the candidate.
const baseline = baselineReceipts as unknown as { base: string; records: Receipt[] };
const fullSweep = process.env.WOC_FULL_BALANCE_SWEEP === '1';
const records = baseline.records.filter((row) => fullSweep || row.seed <= 29902);

describe('MM-only damage budget against the release combat receipts', () => {
  it('retains the complete, unique before-change matrix and both sibling controls', () => {
    expect(baseline.base).toBe('55de7ffe926d781df7b2caee4314318c7ff730ac');
    const expected: string[] = [];
    for (const seed of [29901, 29902, 29903, 29904, 29905]) {
      for (const targets of [1, 3]) {
        for (const spec of ['packlord', 'fieldcraft']) {
          expected.push(`${seed}/${targets}/${spec}/pbe/stationary`);
        }
        for (const gear of ['pbe', 'coldsight-4pc', 'naked']) {
          for (const profile of ['stationary', 'moving', 'mobile-read', 'without-cold-focus']) {
            if (gear === 'naked' && profile !== 'stationary') continue;
            expected.push(`${seed}/${targets}/coldsight/${gear}/${profile}`);
          }
        }
      }
    }
    const actual = baseline.records.map((row) => {
      expect(row.totalDamage).toBeGreaterThan(0);
      return `${row.seed}/${row.scenario.targets}/${row.spec}/${row.gear}/${row.profile}`;
    });
    expect(actual.sort()).toEqual(expected.sort());
    expect(new Set(actual).size).toBe(110);
    expect(records).toHaveLength(fullSweep ? 110 : 44);
  });
  for (const before of records) {
    const { seed, spec, gear, profile } = before;
    const targets = before.scenario.targets;
    it(`${spec} ${seed} ${targets} targets ${gear} ${profile}`, () => {
      if (spec !== 'coldsight' && spec !== 'packlord' && spec !== 'fieldcraft') {
        throw new Error(`invalid hunter receipt: ${spec}`);
      }
      const after = runMarksmanBalanceProbe(spec, seed, targets, gear, profile);
      if (spec !== 'coldsight') {
        // Whole receipts: damage, casts, resources, outcomes, gear and stats.
        expect(after).toEqual(before);
        return;
      }
      const ratio = after.totalDamage / before.totalDamage;
      expect(ratio).toBeGreaterThanOrEqual(1.25);
      expect(ratio).toBeLessThanOrEqual(1.35);
      expect(after.stats).toEqual(before.stats);
      expect(after.resource).toEqual(before.resource);
      expect(after.castsByAbility).toEqual(before.castsByAbility);
      expect(after.outcomes).toEqual(before.outcomes);
      expect(after.damageBySource['Auto Shot']).toBe(before.damageBySource['Auto Shot']);
      expect(after.damageBySource['Auto Attack']).toBe(before.damageBySource['Auto Attack']);
      expect(after.distanceMoved).toBe(before.distanceMoved);
      if (profile === 'moving' || profile === 'mobile-read')
        expect(after.distanceMoved).toBeGreaterThan(100);
      else expect(after.distanceMoved).toBe(0);
      if (profile === 'mobile-read') expect(after.castsByAbility['Fell Shot']).toBeGreaterThan(0);
      if (profile === 'without-cold-focus') expect(after.cooldownUses['Cold Focus'] ?? 0).toBe(0);
      else expect(after.cooldownUses['Cold Focus']).toBeGreaterThan(0);
      if (targets === 3) {
        expect(after.damageBySource.Volley).toBeGreaterThan(0);
        expect(after.damageByTarget.target_2).toBeGreaterThan(0);
        expect(after.damageByTarget.target_3).toBeGreaterThan(0);
      }
    }, 30_000);
  }
});
