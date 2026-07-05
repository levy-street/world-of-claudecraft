import { describe, expect, it } from 'vitest';
import { type MarketQuery, marketItemMatches } from '../src/sim/market_query';
import {
  MARKET_ARMOR_TYPE_FILTERS,
  MARKET_ITEM_TYPE_FILTERS,
  MARKET_RARITY_FILTERS,
  MARKET_WEAPON_TYPE_FILTERS,
} from '../src/ui/market_filters';

// A full browse query with sensible defaults; a case varies only what it cares about.
function q(over: Partial<MarketQuery> = {}): MarketQuery {
  return { search: '', itemType: 'all', subtype: 'all', rarity: 'all', page: 0, ...over };
}

// Filter a list of item ids through the shared predicate the SERVER filters with
// (marketItemMatches), so this covers the exact code path the authoritative browse uses.
function filterIds(ids: readonly string[], over: Partial<MarketQuery> = {}): string[] {
  return ids.filter((id) => marketItemMatches(id, q(over)));
}

describe('World Market filters', () => {
  const items = [
    'wolf_fang',
    'bone_fragments',
    'keen_dirk',
    'greyjaw_pelt_cloak',
    'roasted_boar',
    'minor_healing_potion',
    'elixir_of_the_bear',
  ];

  it('exposes stable item type and rarity filter options for the browse UI', () => {
    expect(MARKET_ITEM_TYPE_FILTERS).toEqual([
      'all',
      'weapon',
      'armor',
      'consumable',
      'material',
      'cosmetic',
      'other',
    ]);
    expect(MARKET_ARMOR_TYPE_FILTERS).toEqual([
      'all',
      'helmet',
      'shoulder',
      'chest',
      'waist',
      'legs',
      'gloves',
      'feet',
    ]);
    expect(MARKET_WEAPON_TYPE_FILTERS).toEqual([
      'all',
      'sword',
      'dagger',
      'staff',
      'mace',
      'axe',
      'other',
    ]);
    expect(MARKET_RARITY_FILTERS).toEqual(['all', 'poor', 'common', 'uncommon', 'rare', 'epic']);
  });

  it('groups wearable armor separately from weapons and consumables', () => {
    expect(filterIds(items, { itemType: 'armor' })).toEqual(['greyjaw_pelt_cloak']);
    expect(filterIds(items, { itemType: 'weapon' })).toEqual(['keen_dirk']);
    expect(filterIds(items, { itemType: 'consumable' })).toEqual([
      'roasted_boar',
      'minor_healing_potion',
      'elixir_of_the_bear',
    ]);
  });

  it('groups mech cosmetics separately from ordinary materials', () => {
    const mixed = [
      'amber_crimson_armor_plate',
      'alien_armor_plate',
      'simple_fishing_pole',
      'bone_fragments',
    ];
    expect(filterIds(mixed, { itemType: 'cosmetic' })).toEqual([
      'amber_crimson_armor_plate',
      'alien_armor_plate',
    ]);
    expect(filterIds(mixed, { itemType: 'material' })).toEqual([
      'simple_fishing_pole',
      'bone_fragments',
    ]);
  });

  it('matches rarities by the game quality names', () => {
    expect(filterIds(items, { rarity: 'poor' })).toEqual(['wolf_fang', 'bone_fragments']);
    expect(filterIds(items, { rarity: 'common' })).toEqual([
      'roasted_boar',
      'minor_healing_potion',
    ]);
    expect(filterIds(items, { rarity: 'uncommon' })).toEqual([
      'keen_dirk',
      'greyjaw_pelt_cloak',
      'elixir_of_the_bear',
    ]);
  });

  it('combines item type and rarity filters', () => {
    expect(filterIds(items, { itemType: 'armor', rarity: 'uncommon' })).toEqual([
      'greyjaw_pelt_cloak',
    ]);
    expect(filterIds(items, { itemType: 'armor', rarity: 'common' })).toEqual([]);
  });

  it('narrows armor filters by wearable slot', () => {
    const armor = ['acolytes_circlet', 'greyjaw_pelt_cloak', 'recruit_tunic'];
    expect(filterIds(armor, { itemType: 'armor', subtype: 'helmet' })).toEqual([
      'acolytes_circlet',
    ]);
    expect(filterIds(armor, { itemType: 'armor', subtype: 'legs' })).toEqual([
      'greyjaw_pelt_cloak',
    ]);
    expect(filterIds(armor, { itemType: 'armor', subtype: 'chest' })).toEqual(['recruit_tunic']);
  });

  it('narrows weapon filters by weapon family', () => {
    const weapons = ['worn_sword', 'keen_dirk', 'gnarled_staff', 'training_mace', 'rusty_hatchet'];
    expect(filterIds(weapons, { itemType: 'weapon', subtype: 'sword' })).toEqual(['worn_sword']);
    expect(filterIds(weapons, { itemType: 'weapon', subtype: 'dagger' })).toEqual(['keen_dirk']);
    expect(filterIds(weapons, { itemType: 'weapon', subtype: 'staff' })).toEqual(['gnarled_staff']);
    expect(filterIds(weapons, { itemType: 'weapon', subtype: 'mace' })).toEqual(['training_mace']);
    expect(filterIds(weapons, { itemType: 'weapon', subtype: 'axe' })).toEqual(['rusty_hatchet']);
  });

  it('matches an item name or id substring, and never an unknown item', () => {
    expect(filterIds(items, { search: 'wolf' })).toEqual(['wolf_fang']);
    expect(filterIds(items, { search: 'ZZZNOMATCH' })).toEqual([]);
    // The server drops listings whose item it no longer knows, so the predicate rejects them.
    expect(marketItemMatches('not_a_real_item', q())).toBe(false);
  });
});
