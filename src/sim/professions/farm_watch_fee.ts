// The farmer's watch fee (D9): paying in kind for the watch knob at plant
// time. The fee predicate, stated once and owned here: ANY farming produce
// whose crop tier is at or below the planted crop's tier qualifies, base and
// fine grades alike (a fine twin IS produce; spending it is the payer's
// choice). The fee is consumed from bags as part of the plant command (no NPC
// range gate: paying is front-loaded at the bed per D8; the farmer NPCs are
// the flavor of the service, not its gate).
//
// A sibling module rather than more plantCrop body: the eligibility walk and
// the payment plan are pure functions of the crop catalog and a bag-count
// reader, so a Vitest drives them directly and the command stays a thin
// consumer. Content import only (farm_crops is data); no SimContext, no rng,
// no clock.

import { FARM_CROPS } from '../content/farm_crops';

// The fee per planted-crop tier, in produce units. TUNING, PROVISIONAL,
// FLAGGED FOR THE MAINTAINER: scaled with the tier so the watch stays a real
// produce sink (D9: watch fees support crop prices) without ever approaching
// the harvest floor of 3 picks; even the tier-4 fee is below one guaranteed
// harvest.
export const FARM_WATCH_FEE_BY_TIER: Readonly<Record<1 | 2 | 3 | 4, number>> = {
  1: 2,
  2: 3,
  3: 4,
  4: 6,
};

/** The fee for a planted crop of this tier. A tier outside the authored 1..4
 *  band clamps to the nearest edge (infinities included), and a NaN tier
 *  floors to 1 (NaN survives Math.max/Math.min, so without the guard the
 *  record read would return undefined behind the number return type):
 *  unreachable through the plant gate (the catalog types tier as 1|2|3|4),
 *  kept genuinely total for the projection-style callers that read persisted
 *  rows. */
export function watchFeeAmount(cropTier: number): number {
  const floored = Math.floor(cropTier);
  const tier = Math.max(1, Math.min(4, Number.isNaN(floored) ? 1 : floored)) as 1 | 2 | 3 | 4;
  return FARM_WATCH_FEE_BY_TIER[tier];
}

/** Every produce id the fee accepts for a planted crop of `cropTier`, in the
 *  DETERMINISTIC consumption order: ascending crop tier, then catalog id,
 *  base grade before fine WITHIN a crop. Note what that order does NOT
 *  promise: it is tier-ascending, not value-ascending, so once the crop
 *  ladder ships a lower tier's fine twin is spent before a higher tier's
 *  base produce; the payer has no per-stack choice on the wire (the frame
 *  carries only the watch boolean), so the rule worth keeping is that the
 *  order is FIXED and predictable, and the crop-ladder phase re-reads this
 *  banner when tier 2 makes it visible. Like every walk that can precede an
 *  rng draw it must be identical on all three hosts, so it is sorted
 *  explicitly rather than trusting record insertion order, and DEDUPED so a
 *  future catalog row sharing an item id with another crop (or a crop whose
 *  base and fine ids collide) cannot count one bag stack twice and let the
 *  affordability gate pass a plan the bags cannot fund. Derived from the
 *  catalog: the crop-ladder phase's crops join with no edit here. */
export function eligibleWatchFeeItemIds(cropTier: number): readonly string[] {
  const crops = Object.values(FARM_CROPS)
    .filter((c) => c.tier <= cropTier)
    .sort((a, b) => a.tier - b.tier || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return [...new Set(crops.flatMap((c) => [c.produceItemId, c.fineProduceItemId]))];
}

// One leg of a fee payment: consume `count` of `itemId`.
export interface WatchFeeLeg {
  readonly itemId: string;
  readonly count: number;
}

/** Plan the watch-fee payment for a planted crop of `cropTier` against the
 *  payer's bags, or null when the qualifying produce falls short. MIXED
 *  payment is allowed (two of one produce and one of another satisfy a fee
 *  of three): the fee is a produce sink, not a single-stack tax, and a
 *  farmer holding enough produce across kinds must never be refused. The
 *  plan is a pure read; the caller consumes the legs only after every other
 *  gate has passed, so a refused plant spends nothing. */
export function planWatchFee(
  cropTier: number,
  countOf: (itemId: string) => number,
): readonly WatchFeeLeg[] | null {
  let remaining = watchFeeAmount(cropTier);
  const legs: WatchFeeLeg[] = [];
  for (const itemId of eligibleWatchFeeItemIds(cropTier)) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Math.max(0, countOf(itemId)));
    if (take > 0) {
      legs.push({ itemId, count: take });
      remaining -= take;
    }
  }
  return remaining <= 0 ? legs : null;
}
