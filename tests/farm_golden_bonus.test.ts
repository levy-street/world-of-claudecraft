// The golden-harvest BONUS (masterwrought Phase 11f, decisions C and D): the
// pure partition in src/sim/professions/farm_golden_bonus.ts, plus the two
// claims about it that only a driven harvest can make.
//
// The partition gets its own suite because it is the rare piece of this feature
// that can be tested EXHAUSTIVELY. It is a pure function of one value in
// [0, 1), so the arms below sweep the interval directly instead of hunting
// seeds through a Sim, which is the whole reason it lives in a leaf. The draw
// COUNT contract stays where it belongs, in tests/professions_farming.test.ts.
//
// The binding acceptance from decision D is asserted here too: the pattern
// arm's expected rate must be strictly SLOWER than the deterministic
// quartermaster route, or the luck channel outruns the channel that exists to
// make luck safe. That check is arithmetic over shipped constants, not a
// recorded number, so a retune of the mark prices, the lockout rewards, or the
// pattern weight re-runs it rather than invalidating a comment.
import { describe, expect, it } from 'vitest';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { FARM_CROPS } from '../src/sim/content/farm_crops';
import { FARM_PATTERN_ITEMS } from '../src/sim/content/farm_patterns';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { ITEMS } from '../src/sim/data';
import {
  FARM_GOLDEN_BONUS_PATTERN_CHANCE,
  FARM_GOLDEN_BONUS_PATTERN_IDS,
  FARM_TOP_CROP_TIER,
  farmGoldenBonusSeedTier,
  farmSeedIdsOfTier,
  resolveFarmGoldenBonus,
} from '../src/sim/professions/farm_golden_bonus';
import { GATHER_RARE_EVENT_CHANCE } from '../src/sim/professions/gather_events';

const ALL_TIERS = [...new Set(Object.values(FARM_CROPS).map((crop) => crop.tier))].sort(
  (a, b) => a - b,
);

describe('the golden bonus partition', () => {
  it('answers a SHIPPED item id for every roll in [0, 1), at every crop tier', () => {
    // Totality, swept rather than sampled: 10 000 evenly spaced rolls per tier.
    // A partition with a gap would answer undefined somewhere in the interval
    // and a live harvest would then grant nothing at all, silently.
    for (const tier of ALL_TIERS) {
      for (let i = 0; i < 10_000; i++) {
        const id = resolveFarmGoldenBonus(i / 10_000, tier);
        expect(ITEMS[id], `tier ${tier} roll ${i / 10_000} answered ${id}`).toBeDefined();
      }
    }
  });

  it('pays a SEED of the next tier up, and holds at the top tier', () => {
    // The upward drift, which is the reason the seed arm exists at all.
    for (const tier of ALL_TIERS) {
      const expectedTier = tier < FARM_TOP_CROP_TIER ? tier + 1 : FARM_TOP_CROP_TIER;
      expect(farmGoldenBonusSeedTier(tier), `tier ${tier} drifts to`).toBe(expectedTier);
      const expectedSeeds = new Set(farmSeedIdsOfTier(expectedTier));
      expect(expectedSeeds.size, `tier ${expectedTier} must have seeds`).toBeGreaterThan(0);
      // Every roll in the seed band pays a seed of exactly that tier.
      for (let i = 0; i < 2000; i++) {
        const roll =
          FARM_GOLDEN_BONUS_PATTERN_CHANCE + (i / 2000) * (1 - FARM_GOLDEN_BONUS_PATTERN_CHANCE);
        const id = resolveFarmGoldenBonus(Math.min(roll, 0.999999), tier);
        expect(expectedSeeds.has(id), `tier ${tier} roll ${roll} paid ${id}`).toBe(true);
      }
    }
    // Non-vacuity for the drift claim: at least one tier really drifts UP, so
    // the rule is not just the hold-at-top arm passing everywhere.
    expect(ALL_TIERS.some((t) => farmGoldenBonusSeedTier(t) !== t)).toBe(true);
    expect(farmGoldenBonusSeedTier(FARM_TOP_CROP_TIER)).toBe(FARM_TOP_CROP_TIER);
  });

  it('pays a PATTERN only inside the low band, and reaches every pattern there', () => {
    const patterns = new Set(FARM_GOLDEN_BONUS_PATTERN_IDS);
    expect(patterns.size, 'the pattern list must be non-empty').toBe(6);
    // Sorted, for the same draw-contract reason the rift list is: the
    // partition indexes this array.
    expect([...FARM_GOLDEN_BONUS_PATTERN_IDS]).toEqual([...FARM_GOLDEN_BONUS_PATTERN_IDS].sort());
    expect([...FARM_GOLDEN_BONUS_PATTERN_IDS].sort()).toEqual(
      Object.keys(FARM_PATTERN_ITEMS).sort(),
    );

    const seen = new Set<string>();
    const STEPS = 6000;
    for (let i = 0; i < STEPS; i++) {
      const roll = i / STEPS;
      const id = resolveFarmGoldenBonus(roll, 1);
      const isPattern = patterns.has(id);
      // The band boundary, asserted in BOTH directions at every step: inside
      // the band it is always a pattern, outside it never is. A boundary that
      // drifted by one step would fail here rather than only shifting a rate.
      expect(isPattern, `roll ${roll} pattern=${isPattern}`).toBe(
        roll < FARM_GOLDEN_BONUS_PATTERN_CHANCE,
      );
      if (isPattern) seen.add(id);
    }
    // Every pattern is reachable, so no entry is dead weight in the list.
    expect([...seen].sort()).toEqual([...FARM_GOLDEN_BONUS_PATTERN_IDS].sort());
  });

  it('distributes the band evenly, so no pattern and no seed is rarer than its siblings', () => {
    // The partition is a uniform re-scale, so an even sweep must land an equal
    // count on each member. Exact equality is the right assertion for a sweep
    // this regular, and it is what would catch an off-by-one in the index math
    // that a tolerance band would wave through.
    const STEPS = 60_000;
    const counts = new Map<string, number>();
    for (let i = 0; i < STEPS; i++) {
      const id = resolveFarmGoldenBonus(i / STEPS, 1);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const patternCounts = FARM_GOLDEN_BONUS_PATTERN_IDS.map((id) => counts.get(id) ?? 0);
    expect(new Set(patternCounts).size, `pattern counts ${patternCounts}`).toBe(1);
    const seedCounts = farmSeedIdsOfTier(farmGoldenBonusSeedTier(1)).map(
      (id) => counts.get(id) ?? 0,
    );
    expect(new Set(seedCounts).size, `seed counts ${seedCounts}`).toBe(1);
    // And the two bands are sized as the constant says.
    const patternTotal = patternCounts.reduce((a, b) => a + b, 0);
    expect(patternTotal / STEPS).toBeCloseTo(FARM_GOLDEN_BONUS_PATTERN_CHANCE, 4);
  });

  it('clamps a roll outside [0, 1) instead of throwing or answering undefined', () => {
    // Unreachable from ctx.rng.next(), which is half-open on exactly this
    // interval, and deliberately defensive anyway: the caller is a live
    // harvest and a bad value must never destroy a reward the player earned.
    for (const roll of [-1, -0.0001, 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const id = resolveFarmGoldenBonus(roll, 2);
      expect(ITEMS[id], `roll ${roll} answered ${id}`).toBeDefined();
    }
  });
});

describe('DECISION D acceptance: the golden pattern arm is slower than the marks route', () => {
  // The binding constraint, computed from shipped constants rather than
  // recorded as prose. If a mark price, a lockout reward, or the pattern
  // weight moves, this re-derives and either still holds or reds.
  const patternMarkPrice = (): number => {
    const prices = Object.keys(FARM_PATTERN_ITEMS).map(
      (id) => HEROIC_VENDOR_STOCK.find((o) => o.itemId === id)?.marks ?? Number.NaN,
    );
    expect(new Set(prices).size, 'the farming patterns must share one mark price').toBe(1);
    return prices[0];
  };

  /** Marks a player can earn in one realm-reset day: every heroic dungeon
   *  carries its own daily lockout, so the ceiling is the sum of the whole
   *  table's per-participant rewards. Derived, so a sixth heroic raises it. */
  const marksPerDay = (): number =>
    Object.values(HEROIC_DUNGEON_TUNING).reduce((sum, t) => sum + t.marksPerParticipant, 0);

  it('the quartermaster route is the fast one, under every farming cadence', () => {
    const marksRoutePatternsPerDay = marksPerDay() / patternMarkPrice();
    expect(marksRoutePatternsPerDay, 'the deterministic route must pay at all').toBeGreaterThan(0);

    // Three harvest cadences, weakest to most absurd. The last is physically
    // impossible (all 23 beds across four zones, the fastest crop's cycle,
    // no travel, 24 hours) and is included precisely so the claim holds even
    // for a player nobody can actually be.
    const CADENCES: Record<string, number> = {
      reference: 46, // two sessions a day over the 23 beds
      grinder: 246, // one 6-bed patch, 35-minute cycles, around the clock
      impossibleCeiling: 946, // every bed, every cycle, no travel
    };
    for (const [name, harvestsPerDay] of Object.entries(CADENCES)) {
      // Survival 1.0 is the CONSERVATIVE direction: survival below 1 only
      // reduces golden events, since a withered harvest spends its golden
      // draw and ignores the result.
      const goldenPerDay = harvestsPerDay * GATHER_RARE_EVENT_CHANCE;
      const patternsPerDay = goldenPerDay * FARM_GOLDEN_BONUS_PATTERN_CHANCE;
      expect(
        patternsPerDay,
        `${name}: golden pays ${patternsPerDay.toFixed(3)} patterns/day against the ` +
          `quartermaster's ${marksRoutePatternsPerDay.toFixed(3)}`,
      ).toBeLessThan(marksRoutePatternsPerDay);
    }
  });

  it('the seed arm is the COMMON one, so golden is a seed faucet with a pattern tail', () => {
    // The shape decision D describes: a seed by default, a pattern at a much
    // lower weight. Stated as a ratio rather than a literal so a reweight has
    // to keep the shape or say so.
    expect(FARM_GOLDEN_BONUS_PATTERN_CHANCE).toBeGreaterThan(0);
    expect(1 - FARM_GOLDEN_BONUS_PATTERN_CHANCE).toBeGreaterThan(
      FARM_GOLDEN_BONUS_PATTERN_CHANCE * 10,
    );
  });
});
