// Pure policy tests for the buyback keeper (server/payout_policy.ts): batch
// trigger (threshold / cadence / fee floor), TWAP chunking + conservation, and
// the season-close trigger. No I/O.
import { describe, it, expect } from 'vitest';
import { DEFAULT_PAYOUT_POLICY, planTwapChunks, shouldCloseSeason, shouldRunBatch } from '../server/payout_policy';

const usdc = (d: number) => BigInt(Math.round(d * 1_000_000));
const NOW = 1_000_000_000_000;
const P = DEFAULT_PAYOUT_POLICY;

describe('shouldRunBatch', () => {
  it('runs immediately once the pool reaches the threshold', () => {
    expect(shouldRunBatch({ availableUsdc: usdc(250), lastBurnAt: NOW, now: NOW, policy: P })).toBe(true);
  });
  it('runs below threshold once cadence has elapsed (and pool clears the floor)', () => {
    expect(shouldRunBatch({ availableUsdc: usdc(30), lastBurnAt: NOW - P.cadenceMs, now: NOW, policy: P })).toBe(true);
  });
  it('waits below threshold while still within cadence', () => {
    expect(shouldRunBatch({ availableUsdc: usdc(30), lastBurnAt: NOW - 60_000, now: NOW, policy: P })).toBe(false);
  });
  it('never runs below the fee floor, even long past cadence', () => {
    expect(shouldRunBatch({ availableUsdc: usdc(10), lastBurnAt: NOW - 100 * P.cadenceMs, now: NOW, policy: P })).toBe(false);
  });
  it('treats a never-run keeper (lastBurnAt null) as cadence-elapsed', () => {
    expect(shouldRunBatch({ availableUsdc: usdc(30), lastBurnAt: null, now: NOW, policy: P })).toBe(true);
  });
});

describe('planTwapChunks', () => {
  it('returns a single chunk at or below the split threshold', () => {
    expect(planTwapChunks(usdc(1000), P)).toEqual([usdc(1000)]);
  });
  it('splits a large pool into capped chunks with the remainder last', () => {
    expect(planTwapChunks(usdc(1075), P)).toEqual([usdc(250), usdc(250), usdc(250), usdc(250), usdc(75)]);
  });
  it('conserves the total exactly', () => {
    const chunks = planTwapChunks(usdc(3333), P);
    expect(chunks.reduce((a, b) => a + b, 0n)).toBe(usdc(3333));
  });
  it('returns nothing for a non-positive pool', () => {
    expect(planTwapChunks(0n, P)).toEqual([]);
    expect(planTwapChunks(-5n, P)).toEqual([]);
  });
});

describe('shouldCloseSeason', () => {
  it('never closes an open-ended season (null end)', () => {
    expect(shouldCloseSeason({ now: NOW, endsAtMs: null })).toBe(false);
  });
  it('stays open before the end time', () => {
    expect(shouldCloseSeason({ now: NOW, endsAtMs: NOW + 1 })).toBe(false);
  });
  it('closes exactly at and after the end time', () => {
    expect(shouldCloseSeason({ now: NOW, endsAtMs: NOW })).toBe(true);
    expect(shouldCloseSeason({ now: NOW + 1, endsAtMs: NOW })).toBe(true);
  });
});
