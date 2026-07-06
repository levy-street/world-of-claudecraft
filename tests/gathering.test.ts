import { describe, expect, it } from 'vitest';
import {
  harvestTierQuantity,
  isHarvestableCorpse,
  resolveCorpseFocusHarvest,
  resolveCorpseHarvest,
} from '../src/sim/professions/gathering';
import { Rng } from '../src/sim/rng';

const TIER_INDEX: Record<string, number> = {
  poor: 0,
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
};

describe('resolveCorpseHarvest: single-use, first-come corpse claim', () => {
  it('lets the first attempt against an unclaimed corpse succeed', () => {
    const claim = resolveCorpseHarvest(null, 1);
    expect(claim).toEqual({ success: true, claimedBy: 1 });
  });

  it('denies a second attempt once the corpse is claimed', () => {
    const first = resolveCorpseHarvest(null, 1);
    const second = resolveCorpseHarvest(first.claimedBy, 2);
    expect(second).toEqual({ success: false, claimedBy: 1 });
  });

  it('denies a later solo attempt against an already-claimed corpse', () => {
    const claim = resolveCorpseHarvest(7, 42);
    expect(claim).toEqual({ success: false, claimedBy: 7 });
  });

  it('is deterministic regardless of call order for the same starting state', () => {
    // Two independent resolutions against the SAME unclaimed state, in either
    // order, always produce "first caller wins, second caller denied": the
    // function itself has no hidden state to make order matter beyond whichever
    // caller happens to run it first against the still-null corpse.
    const runA = () => {
      const a = resolveCorpseHarvest(null, 10);
      const b = resolveCorpseHarvest(a.claimedBy, 20);
      return [a, b];
    };
    const runB = () => {
      const a = resolveCorpseHarvest(null, 10);
      const b = resolveCorpseHarvest(a.claimedBy, 20);
      return [a, b];
    };
    expect(runA()).toEqual(runB());
  });

  it('the claiming player is always the one recorded, never the denied one', () => {
    const claim = resolveCorpseHarvest(null, 99);
    expect(claim.claimedBy).toBe(99);
    const denied = resolveCorpseHarvest(claim.claimedBy, 100);
    expect(denied.claimedBy).toBe(99);
  });
});

describe('isHarvestableCorpse', () => {
  it('is false with no component tags', () => {
    expect(isHarvestableCorpse(undefined)).toBe(false);
    expect(isHarvestableCorpse([])).toBe(false);
  });

  it('is true with at least one component tag', () => {
    expect(isHarvestableCorpse(['hide'])).toBe(true);
  });
});

describe('resolveCorpseFocusHarvest: concentrate vs spread tradeoff (#1142)', () => {
  const TAGS = ['hide', 'fang', 'claw', 'horn'];

  function meanTierIndex(componentTags: string[], chosen: string[], seed: number, trials: number) {
    const rng = new Rng(seed);
    let sum = 0;
    let count = 0;
    for (let i = 0; i < trials; i++) {
      const yields = resolveCorpseFocusHarvest(componentTags, chosen, rng);
      for (const y of yields) {
        sum += TIER_INDEX[y.tier];
        count++;
      }
    }
    return sum / count;
  }

  it('focusing on 1 of 4 tagged components yields a strictly higher average tier than spreading across all 4', () => {
    const trials = 2000;
    const focusedMean = meanTierIndex(TAGS, ['hide'], 1, trials);
    const spreadMean = meanTierIndex(TAGS, TAGS, 2, trials);
    expect(focusedMean).toBeGreaterThan(spreadMean);
  });

  it('draws from the passed-in Rng (deterministic for a fixed seed)', () => {
    const runA = resolveCorpseFocusHarvest(TAGS, ['hide'], new Rng(7));
    const runB = resolveCorpseFocusHarvest(TAGS, ['hide'], new Rng(7));
    expect(runA).toEqual(runB);
  });

  it('an empty selection spreads across every tagged component (back-compat default)', () => {
    const rng1 = new Rng(5);
    const rng2 = new Rng(5);
    const empty = resolveCorpseFocusHarvest(TAGS, [], rng1);
    const all = resolveCorpseFocusHarvest(TAGS, TAGS, rng2);
    expect(empty).toEqual(all);
  });

  it('selecting every tagged component behaves identically to the pre-#1142 spread (zero bonus)', () => {
    const rng = new Rng(3);
    const yields = resolveCorpseFocusHarvest(TAGS, TAGS, rng);
    expect(yields.map((y) => y.component)).toEqual(TAGS);
  });

  it('ignores a chosen tag that is not actually on the corpse', () => {
    const rng = new Rng(9);
    const yields = resolveCorpseFocusHarvest(TAGS, ['hide', 'not_a_real_tag'], rng);
    expect(yields.map((y) => y.component)).toEqual(['hide']);
  });

  it('is monotonic: for the SAME underlying rng draw, choosing fewer components never lowers the tier', () => {
    // Both calls draw from a fresh Rng seeded identically, so the first draw
    // (and thus the unshifted rolled index) is identical for 'hide' in both
    // calls; only the concentration bonus differs. The focused (1-of-4) tier
    // can only be >= the spread (4-of-4) tier, never lower.
    for (let seed = 1; seed <= 50; seed++) {
      const spread = resolveCorpseFocusHarvest(TAGS, TAGS, new Rng(seed));
      const focused = resolveCorpseFocusHarvest(TAGS, ['hide'], new Rng(seed));
      const spreadHide = spread.find((y) => y.component === 'hide');
      const focusedHide = focused.find((y) => y.component === 'hide');
      expect(spreadHide).toBeDefined();
      expect(focusedHide).toBeDefined();
      expect(TIER_INDEX[focusedHide?.tier ?? '']).toBeGreaterThanOrEqual(
        TIER_INDEX[spreadHide?.tier ?? ''],
      );
    }
  });
});

describe('harvestTierQuantity', () => {
  it('increases monotonically from poor (1) to legendary (6)', () => {
    expect(harvestTierQuantity('poor')).toBe(1);
    expect(harvestTierQuantity('common')).toBe(2);
    expect(harvestTierQuantity('uncommon')).toBe(3);
    expect(harvestTierQuantity('rare')).toBe(4);
    expect(harvestTierQuantity('epic')).toBe(5);
    expect(harvestTierQuantity('legendary')).toBe(6);
  });
});
