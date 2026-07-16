import { describe, expect, it } from 'vitest';

import {
  commitWager,
  createBetPool,
  placeWager,
  settlePool,
  validateWager,
} from '../src/sim/parimutuel';

const CAPS = { min: 1, max: 1_000_000 };

describe('validateWager', () => {
  it('rejects a non-integer or below-minimum stake as bad-stake', () => {
    const pool = createBetPool();
    expect(validateWager(pool, 1, 'A', 0, CAPS)).toBe('bad-stake');
    expect(validateWager(pool, 1, 'A', 1.5, CAPS)).toBe('bad-stake');
    expect(validateWager(pool, 1, 'A', Number.NaN, CAPS)).toBe('bad-stake');
    expect(validateWager(pool, 1, 'A', 1, CAPS)).toBe('ok');
  });
  it('rejects backing the other side of an existing wager', () => {
    const pool = createBetPool();
    commitWager(pool, 1, 'A', 100);
    expect(validateWager(pool, 1, 'B', 50, CAPS)).toBe('closed-side');
    expect(validateWager(pool, 1, 'A', 50, CAPS)).toBe('ok'); // same side tops up
  });
  it('rejects a cumulative stake over the cap', () => {
    const pool = createBetPool();
    commitWager(pool, 1, 'A', 900);
    expect(validateWager(pool, 1, 'A', 200, { min: 1, max: 1000 })).toBe('over-cap');
    expect(validateWager(pool, 1, 'A', 100, { min: 1, max: 1000 })).toBe('ok');
  });
});

describe('placeWager (validate + commit)', () => {
  it('accumulates same-side stakes into the pool and the wager', () => {
    const pool = createBetPool();
    expect(placeWager(pool, 1, 'A', 100, CAPS)).toBe('ok');
    expect(placeWager(pool, 1, 'A', 50, CAPS)).toBe('ok');
    expect(pool.poolA).toBe(150);
    expect(pool.wagers.get(1)).toEqual({ side: 'A', stake: 150 });
  });
  it('does not mutate the pool on a rejected wager', () => {
    const pool = createBetPool();
    commitWager(pool, 1, 'A', 100);
    expect(placeWager(pool, 1, 'B', 50, CAPS)).toBe('closed-side');
    expect(pool.poolB).toBe(0);
    expect(pool.wagers.get(1)).toEqual({ side: 'A', stake: 100 });
  });
});

describe('settlePool', () => {
  it('pays winners their stake plus a pro-rata share of the losing pool (rake 0)', () => {
    const pool = createBetPool();
    placeWager(pool, 1, 'A', 100, CAPS); // winner
    placeWager(pool, 2, 'A', 300, CAPS); // winner
    placeWager(pool, 3, 'B', 200, CAPS); // loser
    const { rows, rake } = settlePool(pool, 'A');
    expect(rake).toBe(0);
    // winPool 400, losePool 200. pid1: floor(100*200/400)=50 -> 150; pid2: floor(300*200/400)=150 -> 450; pid3: lost.
    expect(rows).toEqual([
      { key: 1, side: 'A', outcome: 'won', stake: 100, payout: 150 },
      { key: 2, side: 'A', outcome: 'won', stake: 300, payout: 450 },
      { key: 3, side: 'B', outcome: 'lost', stake: 200, payout: 0 },
    ]);
  });

  it('refunds all on a draw (null winner) or an unbacked winning side', () => {
    const draw = createBetPool();
    placeWager(draw, 1, 'A', 100, CAPS);
    placeWager(draw, 2, 'B', 200, CAPS);
    expect(settlePool(draw, null).rows.every((r) => r.outcome === 'refunded')).toBe(true);

    const unbacked = createBetPool();
    placeWager(unbacked, 1, 'A', 100, CAPS); // nobody backed B
    const r = settlePool(unbacked, 'B');
    expect(r.rows).toEqual([{ key: 1, side: 'A', outcome: 'refunded', stake: 100, payout: 100 }]);
  });

  it('takes a rake from the losing pool and leaves rounding dust unpaid', () => {
    const pool = createBetPool();
    placeWager(pool, 1, 'A', 100, CAPS); // sole winner
    placeWager(pool, 2, 'B', 1000, CAPS); // loser
    const { rows, rake } = settlePool(pool, 'A', 500); // 5% rake
    // rake = floor(1000 * 500 / 10000) = 50; distributable = 950; winnings = floor(100*950/100)=950.
    expect(rake).toBe(50);
    expect(rows[0]).toEqual({ key: 1, side: 'A', outcome: 'won', stake: 100, payout: 1050 });
  });

  it('is idempotent and marks the pool settled', () => {
    const pool = createBetPool();
    placeWager(pool, 1, 'A', 100, CAPS);
    placeWager(pool, 2, 'B', 100, CAPS);
    const first = settlePool(pool, 'A');
    expect(first.rows).toHaveLength(2);
    expect(pool.settled).toBe(true);
    expect(settlePool(pool, 'A')).toEqual({ rows: [], rake: 0 });
  });

  it('returns an empty result for an empty pool', () => {
    expect(settlePool(createBetPool(), 'A')).toEqual({ rows: [], rake: 0 });
  });
});
