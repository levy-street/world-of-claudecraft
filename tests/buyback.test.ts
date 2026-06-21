// server/buyback.ts batching decision — the pure gate that keeps the engine from
// swapping dust. (The Jupiter swap + SPL burn need a funded keeper wallet and
// live RPC, so they're exercised on devnet, not here.)
import { describe, it, expect } from 'vitest';
import { minBatchBase, shouldRunBuyback } from '../server/buyback';

describe('buyback batching gate', () => {
  it('derives the minimum batch in USDC base units (default 50 USDC, 6 decimals)', () => {
    expect(minBatchBase()).toBe(50_000_000n);
  });

  it('runs only at or above the minimum batch', () => {
    expect(shouldRunBuyback(49_999_999n)).toBe(false);
    expect(shouldRunBuyback(50_000_000n)).toBe(true);
    expect(shouldRunBuyback(123_456_789n)).toBe(true);
  });

  it('never runs on an empty vault', () => {
    expect(shouldRunBuyback(0n)).toBe(false);
  });
});
