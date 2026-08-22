// The golden-harvest BONUS table (masterwrought Phase 11f, decisions C and D):
// what the one extra draw a golden harvest reads actually pays.
//
// A PURE LEAF, no SimContext and no rng of its own, for the same reason the
// survival ramp lives in farm_projection.ts: a Vitest can drive the whole
// partition directly over the [0, 1) interval instead of hunting seeds through
// a Sim, and farming.ts re-exports the surface so callers and tests still reach
// for one engine module. The constants are flagged HERE, at their definition,
// in farming's own idiom.
//
// WHAT IT PAYS. Exactly ONE extra item, and never a new item id:
//   - a SEED, the default arm. At tiers 1 to 3 it is a seed of the NEXT tier
//     up, at tier 4 the same tier's, so the golden event is itself an
//     UPWARD-DRIFT faucet: a lucky tier-2 farmer's first tier-3 seed becomes a
//     moment rather than a purchase, and a tier-4 farmer is paid in the tier
//     they are already working.
//   - a PATTERN, at a much lower weight, from this phase's six-row farming set.
//
// ONE DRAW DECIDES BOTH, which is the constraint that shapes this file. The
// draw contract (farming.ts) allows exactly one new ctx.rng value, so the
// single roll is PARTITIONED: the low band picks a pattern and the rest picks a
// seed, and within each band the roll is re-scaled to index its own list. A
// second draw for "which one" would have broken the contract; a hash of the
// roll would have been a second source in disguise.
//
// THE PATTERN WEIGHT IS DERIVED, not chosen, in two steps. Its VALUE is the
// shipped per-pattern rollGroup point (0.04), the same number the raid and
// five-man channels use, so the phase mints no new rate anywhere. Its
// ACCEPTABILITY is the binding constraint from decision D: the pattern arm's
// expected rate must be strictly SLOWER than the deterministic quartermaster
// route, or the luck channel would outrun the channel that exists to make luck
// safe. That is checked against three cadence models, not one, and it clears
// all three including a physically impossible ceiling:
//
//   the quartermaster route: five heroic five-mans at 1 mark plus the heroic
//     raid at 3, each on its own realm-reset lockout, is 8 marks a day against
//     a 12-mark pattern: 0.67 patterns/day, one every 1.5 days.
//   a reference farmer (two sessions a day over the 23 beds, so at most one
//     harvest per bed per session): 46 harvests/day, 0.51 golden events/day,
//     0.020 patterns/day, one every ~49 days.
//   a dedicated grinder (one patch of 6 beds, the fastest crop's 35-minute
//     cycle, around the clock): 246 harvests/day, 2.7 golden/day, 0.11
//     patterns/day, one every ~9 days.
//   the impossible ceiling (all 23 beds across all four zones, 35-minute
//     cycles, no travel time, 24 hours): 946 harvests/day, 10.5 golden/day,
//     0.42 patterns/day, one every ~2.4 days. Still slower than 0.67.
//
// Seeds per day for the same three: 0.49, 2.6 and 10.1. Recorded here so
// Phase 15 and the R19 calendar model read numbers somebody computed. The
// harvest cadence uses survival 1.0, which is the CONSERVATIVE direction for
// this check: survival below 1 only reduces golden events, since a withered
// harvest spends its golden draw and ignores the result.
import { FARM_CROPS } from '../content/farm_crops';
import { FARM_PATTERN_ITEMS } from '../content/farm_patterns';

/** The share of the golden bonus roll that pays a PATTERN instead of a seed.
 *  The shipped per-pattern drop point (0.04), reused; see the derivation and
 *  the binding rate comparison in the header. */
export const FARM_GOLDEN_BONUS_PATTERN_CHANCE = 0.04;

/** The pattern ids the bonus can pay, SORTED. The order is part of the draw
 *  contract exactly as RIFT_PATTERN_ITEM_IDS' is: the partition below indexes
 *  this array, so a re-sort is a determinism change, not a tidy-up. Derived
 *  from the shipped table so a seventh pattern joins by existing. */
export const FARM_GOLDEN_BONUS_PATTERN_IDS: readonly string[] =
  Object.keys(FARM_PATTERN_ITEMS).sort();

/** The top crop tier the catalog ships, derived rather than the literal 4, so
 *  a fifth tier would raise the drift ceiling by existing. */
export const FARM_TOP_CROP_TIER = Math.max(...Object.values(FARM_CROPS).map((crop) => crop.tier));

/** The seed tier a golden harvest of `cropTier` pays: one tier UP, held at the
 *  top tier. The upward drift is the whole point of the seed arm. */
export function farmGoldenBonusSeedTier(cropTier: number): number {
  return Math.min(FARM_TOP_CROP_TIER, Math.max(1, cropTier) + 1);
}

/** The seed ids of one tier, SORTED, for the same draw-contract reason the
 *  pattern list is sorted. */
export function farmSeedIdsOfTier(tier: number): readonly string[] {
  return Object.values(FARM_CROPS)
    .filter((crop) => crop.tier === tier)
    .map((crop) => crop.seedItemId)
    .sort();
}

/** Resolve ONE golden-harvest bonus item from ONE roll in [0, 1).
 *
 *  Pure and total: every roll in range answers, and the answer is a shipped
 *  item id. A roll outside [0, 1) is clamped rather than throwing, because the
 *  caller is a live harvest and a bad value must never destroy a reward; the
 *  clamp is unreachable from ctx.rng.next(), which is half-open on exactly this
 *  interval.
 *
 *  The partition, and why it is written as a re-scale rather than a second
 *  draw: the pattern band is [0, FARM_GOLDEN_BONUS_PATTERN_CHANCE) and the seed
 *  band is the rest, and inside each band the roll is stretched back over [0, 1)
 *  to index that band's own list. One value therefore decides both which ARM
 *  pays and which ITEM it pays, which is what keeps the harvest at exactly one
 *  new draw. */
export function resolveFarmGoldenBonus(roll: number, cropTier: number): string {
  const r = Number.isFinite(roll) ? Math.min(0.9999999999, Math.max(0, roll)) : 0;
  if (r < FARM_GOLDEN_BONUS_PATTERN_CHANCE) {
    const within = r / FARM_GOLDEN_BONUS_PATTERN_CHANCE;
    const index = Math.min(
      FARM_GOLDEN_BONUS_PATTERN_IDS.length - 1,
      Math.floor(within * FARM_GOLDEN_BONUS_PATTERN_IDS.length),
    );
    return FARM_GOLDEN_BONUS_PATTERN_IDS[index];
  }
  const seeds = farmSeedIdsOfTier(farmGoldenBonusSeedTier(cropTier));
  const within = (r - FARM_GOLDEN_BONUS_PATTERN_CHANCE) / (1 - FARM_GOLDEN_BONUS_PATTERN_CHANCE);
  const index = Math.min(seeds.length - 1, Math.floor(within * seeds.length));
  return seeds[index];
}
