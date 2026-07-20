import { beforeEach, describe, expect, it } from 'vitest';
import {
  dailyFinalizeGuardSizeForTests,
  hasFinalized,
  recordFinalized,
  resetDailyFinalizeGuardForTests,
} from '../server/daily_finalize_guard';

describe('daily finalize guard', () => {
  beforeEach(() => {
    resetDailyFinalizeGuardForTests();
  });

  it('reports a day as unfinalized until it is recorded', () => {
    expect(hasFinalized('2026-07-01', 'Claudemoon')).toBe(false);
    recordFinalized('2026-07-01', 'Claudemoon');
    expect(hasFinalized('2026-07-01', 'Claudemoon')).toBe(true);
  });

  it('holds multiple (day, realm) pairs at once, gated independently', () => {
    // today AND yesterday for one realm, plus a second realm for the same day.
    recordFinalized('2026-07-01', 'Claudemoon');
    recordFinalized('2026-06-30', 'Claudemoon');
    recordFinalized('2026-07-01', 'Emberfall');

    expect(hasFinalized('2026-07-01', 'Claudemoon')).toBe(true);
    expect(hasFinalized('2026-06-30', 'Claudemoon')).toBe(true);
    expect(hasFinalized('2026-07-01', 'Emberfall')).toBe(true);

    // A pair that was never recorded stays a miss even though its day and its
    // realm each appear in a recorded pair (no cross-field collision).
    expect(hasFinalized('2026-06-30', 'Emberfall')).toBe(false);
  });

  it('recording the same pair twice does not grow the memo', () => {
    recordFinalized('2026-07-01', 'Claudemoon');
    recordFinalized('2026-07-01', 'Claudemoon');
    expect(dailyFinalizeGuardSizeForTests()).toBe(1);
  });

  it('stays bounded and evicts oldest-first under many distinct days', () => {
    // Record far more distinct days than any real process would ever hold live.
    const total = 400;
    for (let i = 0; i < total; i++) {
      recordFinalized(`2026-01-${String(i).padStart(4, '0')}`, 'Claudemoon');
    }
    const size = dailyFinalizeGuardSizeForTests();
    // The memo did not grow to `total`: it is bounded (backstop is 64 entries).
    expect(size).toBeLessThan(total);
    expect(size).toBeLessThanOrEqual(64);
    // Evict-oldest: the first-recorded key is gone, the last-recorded survives.
    expect(hasFinalized('2026-01-0000', 'Claudemoon')).toBe(false);
    expect(hasFinalized(`2026-01-${String(total - 1).padStart(4, '0')}`, 'Claudemoon')).toBe(true);
  });

  it('reset clears the memo', () => {
    recordFinalized('2026-07-01', 'Claudemoon');
    resetDailyFinalizeGuardForTests();
    expect(hasFinalized('2026-07-01', 'Claudemoon')).toBe(false);
    expect(dailyFinalizeGuardSizeForTests()).toBe(0);
  });
});
