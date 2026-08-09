// The farmer's watch fee planner (src/sim/professions/farm_watch_fee.ts):
// the D9 fee predicate as a pure module. The consumption side (the exact
// produce leaving the bags through plantCrop) is pinned in
// tests/professions_farming.test.ts; this file owns the table, the
// eligibility order, and the plan arithmetic.

import { describe, expect, it } from 'vitest';
import { FARM_CROPS, type FarmCropDef } from '../src/sim/content/farm_crops';
import {
  eligibleWatchFeeItemIds,
  FARM_WATCH_FEE_BY_TIER,
  planWatchFee,
  watchFeeAmount,
} from '../src/sim/professions/farm_watch_fee';

// A synthetic multi-tier catalog for the injectable-crops arms below. The
// shipped table carries ONE crop, so against live data the tier ordering,
// the higher-tier exclusion, and the dedupe literally cannot fail (the QA
// round proved it: deleting the Set left every suite green). These rows make
// all three falsifiable today instead of when the crop ladder lands.
// Authored OUT of tier order on purpose (the walk must sort, never trust
// insertion order), with one deliberate collision: 'twinberry' names the
// SAME id for its base and fine grades, so a double-listing would count one
// bag stack twice.
const SYNTH_LADDER: readonly FarmCropDef[] = [
  {
    id: 'frostroot',
    tier: 3,
    durationMs: 60_000,
    seedItemId: 'frostroot_seed',
    produceItemId: 'frostroot',
    fineProduceItemId: 'fine_frostroot',
  },
  {
    id: 'twinberry',
    tier: 1,
    durationMs: 60_000,
    seedItemId: 'twinberry_seed',
    produceItemId: 'twinberry_fruit',
    fineProduceItemId: 'twinberry_fruit',
  },
  {
    id: 'amberleaf',
    tier: 1,
    durationMs: 60_000,
    seedItemId: 'amberleaf_seed',
    produceItemId: 'amberleaf',
    fineProduceItemId: 'fine_amberleaf',
  },
];

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
    // for projection-style callers reading persisted rows. Non-finite floors
    // to tier 1 rather than returning undefined behind the number return
    // type (NaN survives Math.max/Math.min).
    expect(watchFeeAmount(0)).toBe(2);
    expect(watchFeeAmount(99)).toBe(6);
    expect(watchFeeAmount(2.9)).toBe(3);
    expect(watchFeeAmount(Number.NaN)).toBe(2);
    expect(watchFeeAmount(Number.POSITIVE_INFINITY)).toBe(6);
    expect(watchFeeAmount(undefined as unknown as number)).toBe(2);
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

  it('orders a multi-tier catalog tier-ascending, then id, base before fine (synthetic)', () => {
    // The comparator's tier arm exercised for real: amberleaf and twinberry
    // (both tier 1, id order) come before frostroot (tier 3), whatever the
    // authoring order, and the twinberry collision lists once.
    expect(eligibleWatchFeeItemIds(3, SYNTH_LADDER)).toEqual([
      'amberleaf',
      'fine_amberleaf',
      'twinberry_fruit',
      'frostroot',
      'fine_frostroot',
    ]);
  });

  it('EXCLUDES a higher-tier crop from a lower-tier plant (the D9 predicate, synthetic)', () => {
    // The actual fee predicate direction: a tier-1 plant may not be paid in
    // tier-3 produce. Never exercisable against the one-crop live catalog.
    expect(eligibleWatchFeeItemIds(1, SYNTH_LADDER)).toEqual([
      'amberleaf',
      'fine_amberleaf',
      'twinberry_fruit',
    ]);
  });

  it('keeps every live seed id OUT of the fee-eligible produce set (the aliasing pin)', () => {
    // Seeds are not produce: the plant command counts and spends the seed
    // separately from the fee legs, and the plan is made before any payment
    // runs, so a crop whose seed id aliased any produce id would let one bag
    // stack answer both gates and under-collect at spend time. This pin is
    // what stops the crop-ladder phase authoring that row by accident; it
    // walks the LIVE catalog, so the seven new crops join it for free.
    const produceIds = new Set(
      Object.values(FARM_CROPS).flatMap((c) => [c.produceItemId, c.fineProduceItemId]),
    );
    for (const crop of Object.values(FARM_CROPS)) {
      expect(produceIds.has(crop.seedItemId), crop.id).toBe(false);
    }
  });
});

describe('planWatchFee', () => {
  it('plans a single-kind payment from the base grade before the fine twin', () => {
    const counts: Record<string, number> = { vale_wheat: 5, fine_vale_wheat: 5 };
    expect(planWatchFee(1, (id) => counts[id] ?? 0)).toEqual([{ itemId: 'vale_wheat', count: 2 }]);
  });

  it('mixes kinds when no single stack covers the fee, in the fixed order', () => {
    // One base unit plus fine twins: the fee of two takes the base unit FIRST
    // and tops up from the fine stack, never the reverse (within a crop the
    // more valuable fine twin is spent last; across tiers the order is
    // tier-ascending, per the module banner).
    const counts: Record<string, number> = { vale_wheat: 1, fine_vale_wheat: 5 };
    expect(planWatchFee(1, (id) => counts[id] ?? 0)).toEqual([
      { itemId: 'vale_wheat', count: 1 },
      { itemId: 'fine_vale_wheat', count: 1 },
    ]);
  });

  it('never lists one item id twice, whatever the catalog does (the double-count guard)', () => {
    // planWatchFee reads countOf once per listed id and treats every entry as
    // an independent stack, so a duplicated id would count one bag stack
    // twice, pass the affordability gate on produce the player does not have,
    // and under-consume at payment time. The dedupe in eligibleWatchFeeItemIds
    // is the guard; this pin is what makes the crop-ladder phase's seven new
    // rows answer to it.
    for (const tier of [1, 2, 3, 4]) {
      const ids = eligibleWatchFeeItemIds(tier);
      expect(new Set(ids).size, `tier ${tier}`).toBe(ids.length);
    }
  });

  it('cannot fund a fee by counting one collided stack twice (synthetic)', () => {
    // The double-count guard proven at the PLANNER, with the collision the
    // live catalog cannot produce: one twinberry fruit against a fee of two
    // must come up short. A dropped dedupe lists the id twice, reads the same
    // stack twice, and funds a plan the bags cannot pay.
    const counts: Record<string, number> = { twinberry_fruit: 1 };
    expect(planWatchFee(1, (id) => counts[id] ?? 0, SYNTH_LADDER)).toBeNull();
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
