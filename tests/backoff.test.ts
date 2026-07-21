import { describe, expect, it } from 'vitest';
import { computeBackoffDelay } from '../src/net/backoff';

// The full-jitter reconnect backoff. The un-jittered step for an attempt is
// min(maxMs, baseMs * 2 ** (attempt - 1)); the returned delay spreads that step
// across a 0.5x to 1.5x band (min(maxMs, step * (0.5 + rng()))) so a fleet
// dropped by one server blip does not retry on the same beat. rng is injected,
// so these cases pin the schedule exactly at the band edges and midline with the
// client's real base (1000 ms), cap (15000 ms), and max attempt count (40).
const BASE = 1_000;
const MAX = 15_000;
const RNG_FLOOR = () => 0; // 0.5x band edge
const RNG_MID = () => 0.5; // 1.0x un-jittered midline
const RNG_CEIL = () => 0.999999; // just under the 1.5x band edge

describe('computeBackoffDelay', () => {
  it('runs the exponential schedule at the 0.5x jitter floor', () => {
    expect(computeBackoffDelay(1, BASE, MAX, RNG_FLOOR)).toBe(500);
    expect(computeBackoffDelay(2, BASE, MAX, RNG_FLOOR)).toBe(1_000);
    expect(computeBackoffDelay(3, BASE, MAX, RNG_FLOOR)).toBe(2_000);
    expect(computeBackoffDelay(4, BASE, MAX, RNG_FLOOR)).toBe(4_000);
    // a deep attempt whose un-jittered step is already capped at MAX: 15000 * 0.5
    expect(computeBackoffDelay(10, BASE, MAX, RNG_FLOOR)).toBe(7_500);
  });

  it('never exceeds maxMs even as rng approaches 1', () => {
    // attempt 1 lands just under the 1.5x band (1000 * 1.499999)
    const first = computeBackoffDelay(1, BASE, MAX, RNG_CEIL);
    expect(first).toBeLessThan(1_500);
    expect(first).toBeGreaterThan(1_499);
    // a deep attempt is clamped exactly at the cap: min(15000, 15000 * 1.499999)
    expect(computeBackoffDelay(10, BASE, MAX, RNG_CEIL)).toBe(15_000);
    // across the client's real attempt range every delay stays in (0, maxMs] at
    // both jitter extremes
    for (let attempt = 1; attempt <= 40; attempt++) {
      const low = computeBackoffDelay(attempt, BASE, MAX, RNG_FLOOR);
      const high = computeBackoffDelay(attempt, BASE, MAX, RNG_CEIL);
      expect(low).toBeGreaterThan(0);
      expect(low).toBeLessThanOrEqual(MAX);
      expect(high).toBeGreaterThan(0);
      expect(high).toBeLessThanOrEqual(MAX);
    }
  });

  it('returns the un-jittered step at the rng midline', () => {
    expect(computeBackoffDelay(1, BASE, MAX, RNG_MID)).toBe(1_000);
    expect(computeBackoffDelay(4, BASE, MAX, RNG_MID)).toBe(8_000);
  });

  it('stays strictly positive at the smallest attempt and the jitter floor', () => {
    expect(computeBackoffDelay(1, BASE, MAX, RNG_FLOOR)).toBeGreaterThan(0);
  });

  it('brackets a fixed attempt between 0.5x and just under 1.5x of the un-jittered step', () => {
    // attempt 3's un-jittered step, written as a literal (never computed via the
    // function under test): min(15000, 1000 * 2 ** 2) = 4000, uncapped so the full
    // band is observable.
    const step = 4_000;
    expect(computeBackoffDelay(3, BASE, MAX, RNG_FLOOR)).toBe(step * 0.5);
    const high = computeBackoffDelay(3, BASE, MAX, RNG_CEIL);
    expect(high).toBeLessThan(step * 1.5);
    expect(high).toBeGreaterThan(step * 1.4999);
  });
});
