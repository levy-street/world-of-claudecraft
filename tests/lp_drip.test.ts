// The buyback-drip split: pure conservation math feeding both the settle
// transaction (payout_keeper signTerminal) and the post-settle ledger credits,
// which MUST agree because they call the same function on the same amount.
// Postgres is mocked at the top (hoisted) because payout_keeper transitively
// imports db.ts.
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
});
vi.mock('pg', () => ({
  Pool: class {
    async query() {
      return { rows: [], rowCount: 0 };
    }
    async connect() {
      return { query: async () => ({ rows: [], rowCount: 0 }), release() {} };
    }
    async end() {}
  },
}));

import { splitDrip } from '../server/payout_keeper';

describe('splitDrip', () => {
  it('conserves exactly: main + drip = amount', () => {
    for (const amount of [1n, 3n, 999n, 10_000n, 123_456_789n, 2n ** 63n]) {
      for (const bps of [1, 100, 1_000, 2_500, 5_000]) {
        const { mainBase, dripBase } = splitDrip(amount, bps);
        expect(mainBase + dripBase).toBe(amount);
        expect(dripBase).toBe((amount * BigInt(bps)) / 10_000n);
      }
    }
  });
  it('zero bps or non-positive amounts drip nothing (exact old behavior)', () => {
    expect(splitDrip(1_000n, 0)).toEqual({ mainBase: 1_000n, dripBase: 0n });
    expect(splitDrip(1_000n, -5)).toEqual({ mainBase: 1_000n, dripBase: 0n });
    expect(splitDrip(0n, 500)).toEqual({ mainBase: 0n, dripBase: 0n });
  });
  it('the drip share is hard-capped at 50% no matter the configured bps', () => {
    const { mainBase, dripBase } = splitDrip(1_000n, 9_999);
    expect(dripBase).toBe(500n);
    expect(mainBase).toBe(500n);
  });
  it('rounding always favors the main leg (drip floors)', () => {
    const { mainBase, dripBase } = splitDrip(3n, 5_000);
    expect(dripBase).toBe(1n);
    expect(mainBase).toBe(2n);
  });
});
