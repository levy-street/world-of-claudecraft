import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRIZE_TABLE,
  PrizeTier,
  totalWeight,
  validatePrizeTable,
  selectPrize,
  expectedValueLamports,
  maxPayoutLamports,
  winProbability,
  scaleTableForTier,
} from '../server/spin_prizes';
import { LAMPORTS_PER_SOL } from '../server/engagement_config';

const CAP = 100_000_000n; // 0.1 SOL

describe('DEFAULT_PRIZE_TABLE', () => {
  it('weights sum to 1000 and it validates under the 0.1 SOL cap', () => {
    expect(totalWeight(DEFAULT_PRIZE_TABLE)).toBe(1000);
    expect(validatePrizeTable(DEFAULT_PRIZE_TABLE, CAP)).toEqual({ ok: true });
  });

  it('max payout is the 0.1 SOL jackpot', () => {
    expect(maxPayoutLamports(DEFAULT_PRIZE_TABLE)).toBe(100_000_000n);
  });

  it('win probability is 40% (600/1000 land on nothing)', () => {
    expect(winProbability(DEFAULT_PRIZE_TABLE)).toBeCloseTo(0.4, 10);
  });

  it('expected value is well under the per-spin payout cap', () => {
    const ev = expectedValueLamports(DEFAULT_PRIZE_TABLE);
    expect(ev).toBeGreaterThan(0n);
    expect(ev).toBeLessThan(CAP);
    // Hand-computed: 250*5e5 + 100*1e6 + 40*5e6 + 9*2e7 + 1*1e8 = 7.05e8 over 1000.
    expect(ev).toBe(705_000n);
  });
});

describe('validatePrizeTable', () => {
  it('rejects empty, duplicate-key, bad-weight, negative and over-cap tables', () => {
    expect(validatePrizeTable([], CAP)).toEqual({ ok: false, reason: 'empty_table' });
    expect(
      validatePrizeTable(
        [
          { key: 'a', lamports: 0n, weight: 1 },
          { key: 'a', lamports: 1n, weight: 1 },
        ],
        CAP,
      ).reason,
    ).toBe('duplicate_key:a');
    expect(validatePrizeTable([{ key: 'z', lamports: 0n, weight: 0 }], CAP).reason).toBe('bad_weight:z');
    expect(validatePrizeTable([{ key: 'z', lamports: 0n, weight: -1 }], CAP).reason).toBe('bad_weight:z');
    expect(validatePrizeTable([{ key: 'z', lamports: -1n, weight: 1 }], CAP).reason).toBe('negative_payout:z');
    expect(validatePrizeTable([{ key: 'z', lamports: CAP + 1n, weight: 1 }], CAP).reason).toBe('over_cap:z');
  });
});

describe('selectPrize', () => {
  // A simple two-tier table: 30% nothing, 70% a 1 SOL prize.
  const table: PrizeTier[] = [
    { key: 'none', lamports: 0n, weight: 30 },
    { key: 'win', lamports: LAMPORTS_PER_SOL, weight: 70 },
  ];

  it('maps unit ranges to the correct cumulative slice', () => {
    expect(selectPrize(table, 0).key).toBe('none');
    expect(selectPrize(table, 0.29).key).toBe('none');
    expect(selectPrize(table, 0.3).key).toBe('win'); // boundary belongs to the next tier
    expect(selectPrize(table, 0.99).key).toBe('win');
  });

  it('clamps out-of-range units into the table rather than indexing past it', () => {
    expect(selectPrize(table, -0.5).key).toBe('none');
    expect(selectPrize(table, 1).key).toBe('win');
    expect(selectPrize(table, 2).key).toBe('win');
  });

  it('empirically matches the configured weights over many uniform draws', () => {
    let win = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      // Deterministic uniform sweep so the test is not flaky.
      const u = (i + 0.5) / n;
      if (selectPrize(table, u).key === 'win') win++;
    }
    expect(win / n).toBeCloseTo(0.7, 2);
  });

  it('throws on an empty table (configuration bug, not a runtime path)', () => {
    expect(() => selectPrize([], 0.5)).toThrow(/empty prize table/);
  });
});

describe('scaleTableForTier', () => {
  it('leaves tier 0 unchanged and raises win probability monotonically with tier', () => {
    const t0 = scaleTableForTier(DEFAULT_PRIZE_TABLE, 0);
    expect(winProbability(t0)).toBeCloseTo(winProbability(DEFAULT_PRIZE_TABLE), 10);

    const p4 = winProbability(scaleTableForTier(DEFAULT_PRIZE_TABLE, 4));
    const p10 = winProbability(scaleTableForTier(DEFAULT_PRIZE_TABLE, 10));
    expect(p4).toBeGreaterThan(winProbability(DEFAULT_PRIZE_TABLE));
    expect(p10).toBeGreaterThan(p4);
  });

  it('keeps the zero tier weight fixed and scales only prize tiers', () => {
    const scaled = scaleTableForTier(DEFAULT_PRIZE_TABLE, 10); // factor 1.5
    const none = scaled.find((t) => t.key === 'none')!;
    const jackpot = scaled.find((t) => t.key === 'jackpot')!;
    expect(none.weight).toBe(600);
    expect(jackpot.weight).toBeCloseTo(1.5, 10);
  });

  it('does not mutate the source table', () => {
    const before = totalWeight(DEFAULT_PRIZE_TABLE);
    scaleTableForTier(DEFAULT_PRIZE_TABLE, 8);
    expect(totalWeight(DEFAULT_PRIZE_TABLE)).toBe(before);
  });
});
