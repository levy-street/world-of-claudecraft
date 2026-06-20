import { describe, expect, it } from 'vitest';
import { shouldRunBatch, planTwapChunks, minOut, DEFAULT_BURN_POLICY, type BurnPolicy } from '../server/burn_policy';

const P: BurnPolicy = DEFAULT_BURN_POLICY;
const usdc = (d: number) => BigInt(Math.round(d * 1_000_000));
const HOUR = 3600 * 1000;

describe('shouldRunBatch — threshold / cadence / fee floor', () => {
  it('runs immediately once the pool reaches the threshold ($250)', () => {
    expect(shouldRunBatch({ availableUsdc: usdc(250), lastBurnAt: Date.now(), now: Date.now(), policy: P })).toBe(true);
    expect(shouldRunBatch({ availableUsdc: usdc(1000), lastBurnAt: Date.now(), now: Date.now(), policy: P })).toBe(true);
  });

  it('runs below threshold once the cadence (6h) has elapsed, if above the floor', () => {
    const now = 100 * HOUR;
    expect(shouldRunBatch({ availableUsdc: usdc(50), lastBurnAt: now - 7 * HOUR, now, policy: P })).toBe(true);
    expect(shouldRunBatch({ availableUsdc: usdc(50), lastBurnAt: now - 5 * HOUR, now, policy: P })).toBe(false); // cadence not elapsed
  });

  it('NEVER runs below the fee-aware floor ($25), even long past cadence', () => {
    const now = 1000 * HOUR;
    expect(shouldRunBatch({ availableUsdc: usdc(24.99), lastBurnAt: 0, now, policy: P })).toBe(false);
    expect(shouldRunBatch({ availableUsdc: usdc(25), lastBurnAt: 0, now, policy: P })).toBe(true); // exactly the floor + cadence elapsed
  });

  it('treats a never-burned vault (lastBurnAt null) as cadence-elapsed', () => {
    expect(shouldRunBatch({ availableUsdc: usdc(30), lastBurnAt: null, now: 0, policy: P })).toBe(true);
    expect(shouldRunBatch({ availableUsdc: usdc(10), lastBurnAt: null, now: 0, policy: P })).toBe(false); // still below floor
  });
});

describe('planTwapChunks — split large pools, conserve the total', () => {
  it('returns a single chunk at or below the split threshold ($1000)', () => {
    expect(planTwapChunks(usdc(1000), P)).toEqual([usdc(1000)]);
    expect(planTwapChunks(usdc(250), P)).toEqual([usdc(250)]);
  });

  it('splits a large pool into <=$250 chunks with the remainder last, conserving the sum', () => {
    const chunks = planTwapChunks(usdc(1075), P);
    expect(chunks).toEqual([usdc(250), usdc(250), usdc(250), usdc(250), usdc(75)]);
    expect(chunks.reduce((a, b) => a + b, 0n)).toBe(usdc(1075));
    expect(chunks.every((c) => c <= P.twapChunkUsdc)).toBe(true);
  });

  it('returns nothing for a non-positive amount', () => {
    expect(planTwapChunks(0n, P)).toEqual([]);
    expect(planTwapChunks(-5n, P)).toEqual([]);
  });
});

describe('minOut — slippage floor', () => {
  it('applies the bps ceiling (1% off 1,000,000 = 990,000)', () => {
    expect(minOut(1_000_000n, 100n)).toBe(990_000n);
  });
  it('is the identity at zero slippage', () => {
    expect(minOut(12_345n, 0n)).toBe(12_345n);
  });
});
