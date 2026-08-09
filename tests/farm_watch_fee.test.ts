// The farmer's watch fee planner (src/sim/professions/farm_watch_fee.ts):
// the D9 fee predicate as a pure module. The consumption side (the exact
// produce leaving the bags through plantCrop) is pinned in
// tests/professions_farming.test.ts; this file owns the table, the
// eligibility order, and the plan arithmetic.

import { describe, expect, it } from 'vitest';
import {
  eligibleWatchFeeItemIds,
  FARM_WATCH_FEE_BY_TIER,
  planWatchFee,
  watchFeeAmount,
} from '../src/sim/professions/farm_watch_fee';

describe('FARM_WATCH_FEE_BY_TIER', () => {
  it('pins the fee table to its literals', () => {
    // The whole tuning surface of the watch fee, pinned once here (the
    // wire-name-constant rule: every other arm reaches the table through the
    // import, which cannot disagree with itself).
    expect(FARM_WATCH_FEE_BY_TIER).toEqual({ 1: 2, 2: 3, 3: 4, 4: 6 });
  });

  it('keeps every fee below the guaranteed harvest floor of 3 picks per tier-1 cycle', () => {
    // The design bound stated in the module banner: a tier-1 fee above the
    // floor would make the watch a net produce LOSS for a fresh farmer, a
    // punishment rather than a price. Higher tiers pay more but yield more;
    // the tier-1 bound is the one a day-one player feels.
    expect(FARM_WATCH_FEE_BY_TIER[1]).toBeLessThan(3);
  });

  it('clamps watchFeeAmount into the authored 1..4 band', () => {
    expect(watchFeeAmount(1)).toBe(2);
    expect(watchFeeAmount(2)).toBe(3);
    expect(watchFeeAmount(3)).toBe(4);
    expect(watchFeeAmount(4)).toBe(6);
    // Total over junk tiers: unreachable through the plant gate, kept total
    // for projection-style callers reading persisted rows.
    expect(watchFeeAmount(0)).toBe(2);
    expect(watchFeeAmount(99)).toBe(6);
    expect(watchFeeAmount(2.9)).toBe(3);
  });
});

describe('eligibleWatchFeeItemIds', () => {
  it('lists the shipped produce in the deterministic order: base before fine', () => {
    // One crop ships today, so the full order is its base grade then its fine
    // twin, at every planted tier (tier <= cropTier admits the tier-1 crop
    // everywhere). The crop-ladder phase's additions join by derivation and
    // extend this pin deliberately.
    for (const tier of [1, 2, 3, 4]) {
      expect(eligibleWatchFeeItemIds(tier)).toEqual(['vale_wheat', 'fine_vale_wheat']);
    }
  });

  it('admits nothing below tier 1', () => {
    // A zero tier admits no crop (every crop's tier is at least 1): the
    // filter really reads the tier rather than passing everything.
    expect(eligibleWatchFeeItemIds(0)).toEqual([]);
  });
});

describe('planWatchFee', () => {
  it('plans a single-kind payment from the cheapest qualifying produce', () => {
    const counts: Record<string, number> = { vale_wheat: 5, fine_vale_wheat: 5 };
    expect(planWatchFee(1, (id) => counts[id] ?? 0)).toEqual([{ itemId: 'vale_wheat', count: 2 }]);
  });

  it('mixes kinds when no single stack covers the fee, cheapest first', () => {
    // One base unit plus fine twins: the fee of two takes the base unit FIRST
    // and tops up from the fine stack, never the reverse (player-favorable:
    // the more valuable produce is spent last).
    const counts: Record<string, number> = { vale_wheat: 1, fine_vale_wheat: 5 };
    expect(planWatchFee(1, (id) => counts[id] ?? 0)).toEqual([
      { itemId: 'vale_wheat', count: 1 },
      { itemId: 'fine_vale_wheat', count: 1 },
    ]);
  });

  it('returns null when the qualifying produce falls short, planning nothing partial', () => {
    const counts: Record<string, number> = { vale_wheat: 1 };
    expect(planWatchFee(1, (id) => counts[id] ?? 0)).toBeNull();
    // Empty bags are the plain deny.
    expect(planWatchFee(1, () => 0)).toBeNull();
    // A defensive reader returning a negative count contributes nothing
    // rather than crediting the fee backwards.
    expect(planWatchFee(1, () => -5)).toBeNull();
  });

  it('sums the legs to exactly the fee, never more', () => {
    // The arithmetic invariant over a spread of bag shapes: a successful plan
    // pays the fee exactly (no overpayment leg), and every leg is positive.
    const shapes: Record<string, number>[] = [
      { vale_wheat: 2 },
      { vale_wheat: 3 },
      { fine_vale_wheat: 2 },
      { vale_wheat: 1, fine_vale_wheat: 1 },
      { vale_wheat: 1, fine_vale_wheat: 9 },
    ];
    for (const counts of shapes) {
      const plan = planWatchFee(1, (id) => counts[id] ?? 0);
      expect(plan, JSON.stringify(counts)).not.toBeNull();
      const total = (plan ?? []).reduce((sum, leg) => sum + leg.count, 0);
      expect(total, JSON.stringify(counts)).toBe(watchFeeAmount(1));
      for (const leg of plan ?? []) {
        expect(leg.count, `${leg.itemId} leg positive`).toBeGreaterThan(0);
        expect(leg.count, `${leg.itemId} leg within bags`).toBeLessThanOrEqual(
          counts[leg.itemId] ?? 0,
        );
      }
    }
  });
});
