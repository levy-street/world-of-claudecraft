// The Riftbound band item-level ladder (src/sim/rift/band_ladder.ts): the
// numbers the whole band economy hangs on, pinned against the item-level and
// budget primitives the rest of the catalog is priced with, and against the
// raid ring line the ladder must stay under.
import { describe, expect, it } from 'vitest';
import { RIFT_GEM_IDS } from '../src/sim/content/rift/items';
import { ITEMS } from '../src/sim/data';
import { primaryStatBudget } from '../src/sim/item_budget';
import { itemLevel, primaryStatSum } from '../src/sim/item_level';
import {
  RIFT_BAND_GEM_SLOTS,
  RIFT_BAND_ILVL_CAP,
  RIFT_BAND_MAX_UPGRADE,
  RIFT_BAND_TIER_BASE_ILVL,
  RIFT_GEM_RATING,
  RIFT_GEM_RATING_STAT,
  riftBandItemLevel,
  riftBandPrimaryStats,
  riftBandRolledStats,
  riftGemRatings,
} from '../src/sim/rift/band_ladder';
import type { RiftTier } from '../src/sim/types';

const TIERS: readonly RiftTier[] = ['C', 'B', 'A', 'S'];
const MIGHT = { primary: 'str', secondary: 'sta' } as const;

/** The raid ring line the ladder is priced under: an Ignivar epic ring. */
const RAID_RING_ID = 'seal_of_the_forgewall';

describe('rift band ladder: item level', () => {
  it('every essence upgrade raises the item level by exactly one until the cap', () => {
    for (const tier of TIERS) {
      for (let level = 0; level < RIFT_BAND_MAX_UPGRADE; level++) {
        const here = riftBandItemLevel(tier, level);
        const next = riftBandItemLevel(tier, level + 1);
        expect(next - here, `${tier} +${level} -> +${level + 1}`).toBe(
          here >= RIFT_BAND_ILVL_CAP ? 0 : 1,
        );
      }
    }
  });

  it('the S ladder ends exactly on the cap and no rank climbs past it', () => {
    expect(riftBandItemLevel('S', RIFT_BAND_MAX_UPGRADE)).toBe(RIFT_BAND_ILVL_CAP);
    for (const tier of TIERS) {
      expect(riftBandItemLevel(tier, RIFT_BAND_MAX_UPGRADE)).toBeLessThanOrEqual(
        RIFT_BAND_ILVL_CAP,
      );
      // Out-of-range inputs clamp rather than escape the ladder.
      expect(riftBandItemLevel(tier, 99)).toBe(riftBandItemLevel(tier, RIFT_BAND_MAX_UPGRADE));
      expect(riftBandItemLevel(tier, -3)).toBe(RIFT_BAND_TIER_BASE_ILVL[tier]);
    }
  });

  it('a maxed band sits strictly under the current raid ring line', () => {
    const raidRingLevel = itemLevel(ITEMS[RAID_RING_ID]);
    expect(raidRingLevel).toBeDefined();
    expect(RIFT_BAND_ILVL_CAP).toBe((raidRingLevel ?? 0) - 1);
  });

  it('ranks climb in item level and every rank starts under the next', () => {
    for (let i = 1; i < TIERS.length; i++) {
      expect(RIFT_BAND_TIER_BASE_ILVL[TIERS[i]]).toBeGreaterThan(
        RIFT_BAND_TIER_BASE_ILVL[TIERS[i - 1]],
      );
    }
  });
});

describe('rift band ladder: primary stats', () => {
  it('a band at item level N carries exactly the epic ring budget at N', () => {
    for (const tier of TIERS) {
      for (let level = 0; level <= RIFT_BAND_MAX_UPGRADE; level++) {
        const ilvl = riftBandItemLevel(tier, level);
        const stats = riftBandPrimaryStats(MIGHT, ilvl);
        const sum = (stats.str ?? 0) + (stats.sta ?? 0);
        expect(sum, `${tier} +${level} (item level ${ilvl})`).toBe(
          primaryStatBudget(ilvl, 'epic', 'ring'),
        );
        // The shell's identity: primary leads, secondary follows, both present.
        expect(stats.str ?? 0).toBeGreaterThanOrEqual(stats.sta ?? 0);
        expect(stats.sta ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('a maxed S band never out-stats the raid ring it is priced under', () => {
    const maxed = riftBandPrimaryStats(MIGHT, riftBandItemLevel('S', RIFT_BAND_MAX_UPGRADE));
    const sum = (maxed.str ?? 0) + (maxed.sta ?? 0);
    expect(sum).toBeLessThan(primaryStatSum(ITEMS[RAID_RING_ID]));
  });

  it('the rolled aggregate is the primary line plus the gem ratings and nothing else', () => {
    const rolled = riftBandRolledStats(MIGHT, 'S', 2, ['rift_gem_verdant', 'rift_gem_crimson']);
    const ilvl = riftBandItemLevel('S', 2);
    expect(rolled).toEqual({
      ...riftBandPrimaryStats(MIGHT, ilvl),
      hitRating: RIFT_GEM_RATING,
      critRating: RIFT_GEM_RATING,
    });
  });
});

describe('rift band ladder: gems', () => {
  it('every gem colour maps to one distinct combat rating', () => {
    const ratings = RIFT_GEM_IDS.map((id) => RIFT_GEM_RATING_STAT[id]);
    expect(new Set(ratings).size).toBe(RIFT_GEM_IDS.length);
    expect(ratings.sort()).toEqual(['critRating', 'hasteRating', 'hitRating']);
  });

  it('a full S band (two gems) stays under the single rating line a raid ring carries', () => {
    const raidRing = ITEMS[RAID_RING_ID];
    const raidLine = Math.max(
      raidRing.hitRating ?? 0,
      raidRing.critRating ?? 0,
      raidRing.hasteRating ?? 0,
    );
    expect(raidLine).toBeGreaterThan(0);
    const maxSockets = Math.max(...TIERS.map((tier) => RIFT_BAND_GEM_SLOTS[tier]));
    expect(maxSockets).toBe(2);
    expect(RIFT_GEM_RATING * maxSockets).toBeLessThan(raidLine);
  });

  it('sums same-colour gems and ignores anything that is not a rift gem', () => {
    expect(riftGemRatings(['rift_gem_azure', 'rift_gem_azure'])).toEqual({
      hasteRating: 2 * RIFT_GEM_RATING,
    });
    expect(riftGemRatings(['not_a_gem', ''])).toEqual({});
    expect(riftGemRatings([])).toEqual({});
  });
});
