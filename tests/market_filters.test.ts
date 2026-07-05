import { describe, expect, it } from 'vitest';
import type { MarketListingView } from '../src/world_api';
import {
  MARKET_ARMOR_TYPE_FILTERS,
  MARKET_ITEM_TYPE_FILTERS,
  MARKET_RARITY_FILTERS,
  MARKET_WEAPON_TYPE_FILTERS,
  filterMarketListings,
  paginateMarketListings,
} from '../src/ui/market_filters';

function listing(itemId: string): MarketListingView {
  return {
    id: itemId.length,
    sellerName: 'Seller',
    itemId,
    count: 1,
    price: 100,
    mine: false,
    house: false,
  };
}

describe('World Market filters', () => {
  const listings = [
    listing('wolf_fang'),
    listing('bone_fragments'),
    listing('keen_dirk'),
    listing('greyjaw_pelt_cloak'),
    listing('roasted_boar'),
    listing('minor_healing_potion'),
    listing('elixir_of_the_bear'),
  ];

  it('exposes stable item type and rarity filter options for the browse UI', () => {
    expect(MARKET_ITEM_TYPE_FILTERS).toEqual(['all', 'weapon', 'armor', 'consumable', 'material', 'cosmetic', 'other']);
    expect(MARKET_ARMOR_TYPE_FILTERS).toEqual(['all', 'helmet', 'shoulder', 'chest', 'waist', 'legs', 'gloves', 'feet']);
    expect(MARKET_WEAPON_TYPE_FILTERS).toEqual(['all', 'sword', 'dagger', 'staff', 'mace', 'axe', 'other']);
    expect(MARKET_RARITY_FILTERS).toEqual(['all', 'poor', 'common', 'uncommon', 'rare', 'epic']);
  });

  it('groups wearable armor separately from weapons and consumables', () => {
    expect(filterMarketListings(listings, { itemType: 'armor', rarity: 'all' }).map((l) => l.itemId))
      .toEqual(['greyjaw_pelt_cloak']);
    expect(filterMarketListings(listings, { itemType: 'weapon', rarity: 'all' }).map((l) => l.itemId))
      .toEqual(['keen_dirk']);
    expect(filterMarketListings(listings, { itemType: 'consumable', rarity: 'all' }).map((l) => l.itemId))
      .toEqual(['roasted_boar', 'minor_healing_potion', 'elixir_of_the_bear']);
  });

  it('groups mech cosmetics separately from ordinary materials', () => {
    const mixed = [
      listing('amber_crimson_armor_plate'),
      listing('alien_armor_plate'),
      listing('simple_fishing_pole'),
      listing('bone_fragments'),
    ];

    expect(filterMarketListings(mixed, { itemType: 'cosmetic', rarity: 'all' }).map((l) => l.itemId))
      .toEqual(['amber_crimson_armor_plate', 'alien_armor_plate']);
    expect(filterMarketListings(mixed, { itemType: 'material', rarity: 'all' }).map((l) => l.itemId))
      .toEqual(['simple_fishing_pole', 'bone_fragments']);
  });

  it('matches rarities by the game quality names', () => {
    expect(filterMarketListings(listings, { itemType: 'all', rarity: 'poor' }).map((l) => l.itemId))
      .toEqual(['wolf_fang', 'bone_fragments']);
    expect(filterMarketListings(listings, { itemType: 'all', rarity: 'common' }).map((l) => l.itemId))
      .toEqual(['roasted_boar', 'minor_healing_potion']);
    expect(filterMarketListings(listings, { itemType: 'all', rarity: 'uncommon' }).map((l) => l.itemId))
      .toEqual(['keen_dirk', 'greyjaw_pelt_cloak', 'elixir_of_the_bear']);
  });

  it('combines item type and rarity filters', () => {
    expect(filterMarketListings(listings, { itemType: 'armor', rarity: 'uncommon' }).map((l) => l.itemId))
      .toEqual(['greyjaw_pelt_cloak']);
    expect(filterMarketListings(listings, { itemType: 'armor', rarity: 'common' })).toEqual([]);
  });

  it('narrows armor filters by wearable slot', () => {
    const armor = [
      listing('acolytes_circlet'),
      listing('greyjaw_pelt_cloak'),
      listing('recruit_tunic'),
    ];

    expect(filterMarketListings(armor, { itemType: 'armor', subtype: 'helmet', rarity: 'all' }).map((l) => l.itemId))
      .toEqual(['acolytes_circlet']);
    expect(filterMarketListings(armor, { itemType: 'armor', subtype: 'legs', rarity: 'all' }).map((l) => l.itemId))
      .toEqual(['greyjaw_pelt_cloak']);
    expect(filterMarketListings(armor, { itemType: 'armor', subtype: 'chest', rarity: 'all' }).map((l) => l.itemId))
      .toEqual(['recruit_tunic']);
  });

  it('narrows weapon filters by weapon family', () => {
    const weapons = [
      listing('worn_sword'),
      listing('keen_dirk'),
      listing('gnarled_staff'),
      listing('training_mace'),
      listing('rusty_hatchet'),
    ];

    expect(filterMarketListings(weapons, { itemType: 'weapon', subtype: 'sword', rarity: 'all' }).map((l) => l.itemId))
      .toEqual(['worn_sword']);
    expect(filterMarketListings(weapons, { itemType: 'weapon', subtype: 'dagger', rarity: 'all' }).map((l) => l.itemId))
      .toEqual(['keen_dirk']);
    expect(filterMarketListings(weapons, { itemType: 'weapon', subtype: 'staff', rarity: 'all' }).map((l) => l.itemId))
      .toEqual(['gnarled_staff']);
    expect(filterMarketListings(weapons, { itemType: 'weapon', subtype: 'mace', rarity: 'all' }).map((l) => l.itemId))
      .toEqual(['training_mace']);
    expect(filterMarketListings(weapons, { itemType: 'weapon', subtype: 'axe', rarity: 'all' }).map((l) => l.itemId))
      .toEqual(['rusty_hatchet']);
  });

  it('paginates filtered listings at 50 items per market page', () => {
    const manyListings = Array.from({ length: 121 }, (_, index) => ({
      ...listing('wolf_fang'),
      id: index + 1,
    }));

    expect(paginateMarketListings(manyListings, 0)).toMatchObject({
      page: 0,
      pageCount: 3,
      total: 121,
      start: 0,
      end: 50,
    });
    expect(paginateMarketListings(manyListings, 0).items).toHaveLength(50);
    expect(paginateMarketListings(manyListings, 1).items[0].id).toBe(51);
    expect(paginateMarketListings(manyListings, 99)).toMatchObject({
      page: 2,
      start: 100,
      end: 121,
    });
  });
});
