// Exactness tests for the 80/20 talent/treasury split (server/talent_split.ts)
// and the per-currency human-to-base conversion (server/talent_config.ts). Pure,
// no DB or RPC.
import { describe, expect, it } from 'vitest';
import { humanToBase } from '../server/talent_config';
import { talentSplit } from '../server/talent_split';

describe('talentSplit (80/20)', () => {
  it('splits a clean amount exactly 80/20 at the default 2000 bps', () => {
    const { talentBase, treasuryBase } = talentSplit(1000n);
    expect(treasuryBase).toBe(200n);
    expect(talentBase).toBe(800n);
    expect(talentBase + treasuryBase).toBe(1000n);
  });

  it('never shorts the talent: rounding dust goes to the talent leg', () => {
    // 2000 bps of 1001 = 200.2 -> floor 200 treasury, 801 to talent.
    const { talentBase, treasuryBase } = talentSplit(1001n);
    expect(treasuryBase).toBe(200n);
    expect(talentBase).toBe(801n);
    expect(talentBase + treasuryBase).toBe(1001n);
  });

  it('sums to exactly the price for a range of amounts and bps', () => {
    for (const price of [1n, 2n, 7n, 999n, 12_345n, 250_000_000_000n]) {
      for (const bps of [1, 500, 2000, 3333, 5000]) {
        const { talentBase, treasuryBase } = talentSplit(price, bps);
        expect(talentBase + treasuryBase).toBe(price);
        expect(treasuryBase).toBe((price * BigInt(bps)) / 10000n);
        expect(talentBase).toBeGreaterThanOrEqual(treasuryBase === price ? 0n : 0n);
      }
    }
  });

  it('is zero for a non-positive price', () => {
    expect(talentSplit(0n)).toEqual({ talentBase: 0n, treasuryBase: 0n });
    expect(talentSplit(-5n)).toEqual({ talentBase: 0n, treasuryBase: 0n });
  });
});

describe('humanToBase (per-currency decimals)', () => {
  it('converts whole USDC at 6 decimals', () => {
    expect(humanToBase(25, 'usdc')).toBe(25_000_000n);
  });

  it('converts fractional SOL at 9 decimals without float drift', () => {
    expect(humanToBase(0.15, 'sol')).toBe(150_000_000n);
    expect(humanToBase(1.5, 'sol')).toBe(1_500_000_000n);
  });

  it('converts whole $WOC at 6 decimals', () => {
    expect(humanToBase(20000, 'woc')).toBe(20_000_000_000n);
  });

  it('clamps a negative or non-finite amount to zero', () => {
    expect(humanToBase(-1, 'usdc')).toBe(0n);
    expect(humanToBase(Number.NaN, 'sol')).toBe(0n);
  });
});
