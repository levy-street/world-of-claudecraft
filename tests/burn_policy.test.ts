import { describe, expect, it } from 'vitest';
import { shouldRunBatch, planTwapChunks, DEFAULT_BURN_POLICY, type BurnPolicy } from '../server/burn_policy';

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

  it('fires at EXACTLY the cadence boundary (>=, not >)', () => {
    const now = 100 * HOUR;
    expect(shouldRunBatch({ availableUsdc: usdc(50), lastBurnAt: now - P.cadenceMs, now, policy: P })).toBe(true); // sinceLast === cadenceMs
    expect(shouldRunBatch({ availableUsdc: usdc(50), lastBurnAt: now - P.cadenceMs + 1, now, policy: P })).toBe(false); // one ms short
  });

  it('the floor takes precedence over the threshold when misconfigured (floor > threshold)', () => {
    const skewed: BurnPolicy = { ...P, thresholdUsdc: usdc(250), minBatchUsdc: usdc(300) };
    // $260 clears the threshold but sits below the (higher) floor → still blocked.
    expect(shouldRunBatch({ availableUsdc: usdc(260), lastBurnAt: 0, now: 1000 * HOUR, policy: skewed })).toBe(false);
    expect(shouldRunBatch({ availableUsdc: usdc(300), lastBurnAt: 0, now: 1000 * HOUR, policy: skewed })).toBe(true);
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

  it('splits an exact multiple into N full chunks with NO trailing zero remainder', () => {
    const chunks = planTwapChunks(usdc(1250), P);
    expect(chunks).toEqual([usdc(250), usdc(250), usdc(250), usdc(250), usdc(250)]);
    expect(chunks).toHaveLength(5);
    expect(chunks.reduce((a, b) => a + b, 0n)).toBe(usdc(1250));
  });

  it('the split fires the moment the pool exceeds the split threshold by one base unit', () => {
    expect(planTwapChunks(P.twapSplitAboveUsdc, P)).toEqual([P.twapSplitAboveUsdc]); // at threshold: single chunk
    expect(planTwapChunks(P.twapSplitAboveUsdc + 1n, P)).toEqual([usdc(250), usdc(250), usdc(250), usdc(250), 1n]); // +1: splits, dust last
  });

  it('falls back to a single whole-amount chunk when twapChunkUsdc is misconfigured to 0', () => {
    const zeroChunk: BurnPolicy = { ...P, twapChunkUsdc: 0n };
    const amount = P.twapSplitAboveUsdc + 1n; // above split threshold, so it would otherwise chunk
    expect(planTwapChunks(amount, zeroChunk)).toEqual([amount]); // chunk size 0 -> whole amount (never an infinite loop)
  });
});
