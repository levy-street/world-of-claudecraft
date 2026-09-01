import { describe, expect, it } from 'vitest';
import {
  dropTaughtRecipe,
  type PatternChannelTables,
  patternChannelSets,
  patternItemIdFor,
  recipeAcquisitionChannel,
  vendorTaughtRecipe,
} from '../scripts/wiki/vendor_channel.mjs';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { MOBS } from '../src/sim/data';
import { FARM_RIFT_DROP_ITEM_IDS, RIFT_PATTERN_ITEM_IDS } from '../src/sim/rift/progression';

// The wiki's pattern-CHANNEL classification, driven directly.
//
// scripts/wiki/vendor_channel.mjs is the single expression the content
// generator and the guide accuracy guard both call. Before phase 18 there were
// two copies of it and the only thing pinning either was the other. This suite
// drives the module off SYNTHETIC tables so its behaviour is nailed down
// independently of live content: a table edit can change which recipes land in
// which arm, but it can never change what the arms MEAN, and that is what a
// shared derivation has to keep stable.
//
// The live-data arm at the end is the non-vacuity floor: all five values must
// actually occur in the shipped catalog, or the four callers above would be
// pinning a classification the game never produces.

const table = (over: Partial<PatternChannelTables> = {}): PatternChannelTables => ({
  mobs: {},
  heroicBossLoot: {},
  riftPatternItemIds: [],
  farmRiftDropItemIds: [],
  heroicVendorStock: [],
  ...over,
});

const recipe = (resultItemId: string, acquisition?: string[]) => ({ resultItemId, acquisition });

describe('wiki pattern channel derivation', () => {
  it('spells the teaching-pattern id convention exactly once', () => {
    expect(patternItemIdFor('harvest_feast')).toBe('pattern_harvest_feast');
  });

  it('collects dropped pattern ids from all four live drop sources', () => {
    const sets = patternChannelSets(
      table({
        mobs: {
          // A loot row with no itemId (a coin or xp roll) must be skipped, not
          // collected as `undefined`.
          nythraxis: { loot: [{ itemId: 'pattern_from_mob' }, {}] },
          boarling: {},
        },
        heroicBossLoot: { some_boss: [{ itemId: 'pattern_from_heroic' }] },
        riftPatternItemIds: ['pattern_from_rift'],
        farmRiftDropItemIds: ['pattern_from_farm_rift'],
      }),
    );
    expect([...sets.dropped].sort()).toEqual([
      'pattern_from_farm_rift',
      'pattern_from_heroic',
      'pattern_from_mob',
      'pattern_from_rift',
    ]);
  });

  it('collects vendor pattern ids from the marks stock', () => {
    const sets = patternChannelSets(table({ heroicVendorStock: [{ itemId: 'pattern_sold' }] }));
    expect([...sets.vendor]).toEqual(['pattern_sold']);
  });

  it('gates both taught-by predicates on the recipe actually being drop-acquisition', () => {
    // A trainer recipe whose output happens to share a name with a stocked
    // pattern is NOT drop-taught or vendor-taught. Without the acquisition
    // gate the trainer ladder would start claiming found patterns.
    const sets = patternChannelSets(
      table({
        heroicVendorStock: [{ itemId: 'pattern_thing' }],
        riftPatternItemIds: ['pattern_thing'],
      }),
    );
    expect(vendorTaughtRecipe(recipe('thing', ['trainer']), sets)).toBe(false);
    expect(dropTaughtRecipe(recipe('thing', ['trainer']), sets)).toBe(false);
    expect(vendorTaughtRecipe(recipe('thing', ['drop']), sets)).toBe(true);
    expect(dropTaughtRecipe(recipe('thing', ['drop']), sets)).toBe(true);
  });

  it('classifies all five channels, each on its own distinguishing input', () => {
    const sets = patternChannelSets(
      table({
        riftPatternItemIds: ['pattern_both', 'pattern_dropped'],
        heroicVendorStock: [{ itemId: 'pattern_both' }, { itemId: 'pattern_sold' }],
      }),
    );
    // trainer wins outright, even when its pattern sits in both tables.
    expect(recipeAcquisitionChannel(recipe('both', ['trainer', 'drop']), sets)).toBe('trainer');
    // Both channels: the value that exists because either single label is a
    // lie about the other channel.
    expect(recipeAcquisitionChannel(recipe('both', ['drop']), sets)).toBe('dropAndVendor');
    // Sold and NOT dropped.
    expect(recipeAcquisitionChannel(recipe('sold', ['drop']), sets)).toBe('vendor');
    // Dropped and NOT sold.
    expect(recipeAcquisitionChannel(recipe('dropped', ['drop']), sets)).toBe('drop');
    // Drop-acquisition with no table carrying the pattern at all still says
    // drop: the acquisition field is the claim, the tables only refine it.
    expect(recipeAcquisitionChannel(recipe('orphan', ['drop']), sets)).toBe('drop');
    // No acquisition channel at all: the grandfathered known-from-the-start set.
    expect(recipeAcquisitionChannel(recipe('starter'), sets)).toBe('known');
    expect(recipeAcquisitionChannel(recipe('starter', []), sets)).toBe('known');
  });

  it('produces every one of the five channels over the LIVE catalog', () => {
    // Non-vacuity: a classification with an arm the shipped content never
    // reaches is an arm nobody is really testing. Counted, not just present,
    // so a content edit that collapses a channel to a single row is visible.
    const sets = patternChannelSets({
      mobs: MOBS,
      heroicBossLoot: HEROIC_BOSS_LOOT,
      riftPatternItemIds: RIFT_PATTERN_ITEM_IDS,
      farmRiftDropItemIds: FARM_RIFT_DROP_ITEM_IDS,
      heroicVendorStock: HEROIC_VENDOR_STOCK,
    });
    const counts: Record<string, number> = {};
    for (const r of ALL_RECIPES) {
      const channel = recipeAcquisitionChannel(r, sets);
      counts[channel] = (counts[channel] ?? 0) + 1;
    }
    for (const channel of ['trainer', 'dropAndVendor', 'vendor', 'drop', 'known']) {
      expect(counts[channel] ?? 0, `live recipes on the "${channel}" channel`).toBeGreaterThan(0);
    }
  });
});
