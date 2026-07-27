import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { type MarketQuery, marketItemMatches, sanitizeMarketQuery } from '../src/sim/market_query';
import {
  MARKET_ARMOR_CLASS_FILTERS,
  MARKET_ARMOR_TYPE_FILTERS,
  MARKET_BAG_SIZE_FILTERS,
  MARKET_ITEM_TYPE_FILTERS,
  MARKET_PRIMARY_STAT_FILTERS,
  MARKET_RARITY_FILTERS,
  MARKET_WEAPON_TYPE_FILTERS,
} from '../src/ui/market_filters';

// Every bag the content catalog ships, resolved from the merged ITEMS table rather
// than a hand-listed set, so a bag added later is covered by these cases for free.
const CATALOG_BAG_IDS = Object.keys(ITEMS).filter((id) => ITEMS[id]?.kind === 'bag');

// A full browse query with sensible defaults; a case varies only what it cares about.
function q(over: Partial<MarketQuery> = {}): MarketQuery {
  return {
    search: '',
    itemType: 'all',
    subtype: 'all',
    armorClass: 'all',
    primaryStat: 'all',
    rarity: 'all',
    page: 0,
    ...over,
  };
}

// Filter a list of item ids through the shared predicate the SERVER filters with
// (marketItemMatches), so this covers the exact code path the authoritative browse uses.
function filterIds(ids: readonly string[], over: Partial<MarketQuery> = {}): string[] {
  return ids.filter((id) => marketItemMatches(id, q(over)));
}

describe('World Market filters', () => {
  // wolf_fang became a crafting reagent (common, white), so the
  // poor-quality exemplar here is mudfin_scale.
  const items = [
    'mudfin_scale',
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
      'bag',
      'consumable',
      'material',
      'cosmetic',
      'other',
    ]);
    expect(MARKET_ARMOR_TYPE_FILTERS).toEqual([
      'all',
      'offhand',
      'helmet',
      'neck',
      'shoulder',
      'chest',
      'waist',
      'legs',
      'gloves',
      'feet',
      'ring',
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
    expect(MARKET_ARMOR_CLASS_FILTERS).toEqual(['all', 'cloth', 'leather', 'mail']);
    expect(MARKET_PRIMARY_STAT_FILTERS).toEqual(['all', 'str', 'agi', 'int']);
    expect(MARKET_RARITY_FILTERS).toEqual([
      'all',
      'poor',
      'common',
      'uncommon',
      'rare',
      'epic',
      'legendary',
    ]);
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

  // Issue #2189: bags matched no item-type option at all (the 'material' arm is
  // junk|tool, the 'other' arm is quest), so the only way to find one was to know
  // its exact name and type it into the search box.
  it('browses bags as their own category, and never as materials, cosmetics or Other', () => {
    const mixed = ['linen_pouch', 'mistcallers_duffel', 'bone_fragments', 'simple_fishing_pole'];
    expect(filterIds(mixed, { itemType: 'bag' })).toEqual(['linen_pouch', 'mistcallers_duffel']);
    expect(filterIds(mixed, { itemType: 'material' })).toEqual([
      'bone_fragments',
      'simple_fishing_pole',
    ]);
    expect(filterIds(mixed, { itemType: 'other' })).toEqual([]);
    expect(filterIds(mixed, { itemType: 'cosmetic' })).toEqual([]);
    expect(filterIds(mixed, { itemType: 'armor' })).toEqual([]);
    // And exclusivity for EVERY catalog bag against EVERY bucket, not a hand-picked
    // pair against four of them: a bag that also answered 'material' or 'weapon' would
    // put it in two categories at once, which no other item kind does.
    for (const id of CATALOG_BAG_IDS) {
      expect(
        MARKET_ITEM_TYPE_FILTERS.filter(
          (itemType) => itemType !== 'all' && marketItemMatches(id, q({ itemType })),
        ),
        `${id} must answer exactly one browse category`,
      ).toEqual(['bag']);
    }
  });

  // The stat and armor-class filters are no-ops outside armor/weapon, which is the whole
  // reason the bag path deliberately raises no primary-stat menu. Asserted as behavior
  // here so that making either filter apply to bags cannot silently turn the hidden
  // control into one that would have narrowed.
  it('leaves the armor-class and primary-stat filters inert on the bag path', () => {
    expect(CATALOG_BAG_IDS.length).toBeGreaterThanOrEqual(6);
    for (const primaryStat of ['str', 'agi', 'int'] as const)
      expect(filterIds(CATALOG_BAG_IDS, { itemType: 'bag', primaryStat })).toEqual(CATALOG_BAG_IDS);
    for (const armorClass of ['cloth', 'leather', 'mail'] as const)
      expect(filterIds(CATALOG_BAG_IDS, { itemType: 'bag', armorClass })).toEqual(CATALOG_BAG_IDS);
  });

  // The bag arm's comment claims a subtype left over from another item type "matches
  // nothing". That is a live wire path, not a hypothetical: the sanitizer's allowlist is
  // the UNION of the three vocabularies, so it is not scoped to the item type.
  it('drops a subtype belonging to another item type instead of ignoring it', () => {
    expect(sanitizeMarketQuery({ itemType: 'bag', subtype: 'chest' }).subtype).toBe('chest');
    expect(filterIds(CATALOG_BAG_IDS, { itemType: 'bag', subtype: 'chest' })).toEqual([]);
    // The mirror arm: a bag capacity surviving onto an armor browse narrows to nothing
    // too, rather than being ignored and showing the full armor list.
    const armor = ['recruit_tunic', 'oiled_boots'];
    expect(filterIds(armor, { itemType: 'armor' })).toEqual(armor);
    expect(filterIds(armor, { itemType: 'armor', subtype: '12' })).toEqual([]);
  });

  // The guard that would have caught #2189 the day the bag kind was authored: an
  // item nothing but 'All' can reach is invisible to a player who does not already
  // know its name. Fails for a future ItemKind with no arm, which tsc cannot see.
  it('leaves no catalog item reachable only through the All filter', () => {
    const buckets = MARKET_ITEM_TYPE_FILTERS.filter((f) => f !== 'all');
    const orphans = Object.keys(ITEMS).filter(
      (id) => !buckets.some((itemType) => marketItemMatches(id, q({ itemType }))),
    );
    expect(orphans, `items no browse category can reach: ${orphans.join(', ')}`).toEqual([]);
    // Non-vacuity: the sweep is worthless if the catalog is empty, and `.some()` short
    // circuits, so prove every bucket was actually exercised and is LIVE. A category
    // whose predicate matches nothing passes the orphan check while browsing as a dead
    // control, which is the same class of defect as the bag hole this test exists for.
    expect(Object.keys(ITEMS).length).toBeGreaterThan(100);
    expect(CATALOG_BAG_IDS.length).toBeGreaterThanOrEqual(6);
    const live = buckets.filter((itemType) =>
      Object.keys(ITEMS).some((id) => marketItemMatches(id, q({ itemType }))),
    );
    expect(live, 'every browse category must match at least one catalog item').toEqual([
      ...buckets,
    ]);
  });

  it('derives the bag-size options from the catalog, not from a hardcoded ladder', () => {
    const catalogSizes = [...new Set(CATALOG_BAG_IDS.map((id) => ITEMS[id]?.bagSlots ?? 0))].sort(
      (a, b) => a - b,
    );
    expect(catalogSizes.length).toBeGreaterThan(1);
    expect(MARKET_BAG_SIZE_FILTERS[0]).toBe('all');
    // Every capacity the content ships is offered, exactly once, in ascending order:
    // authoring a bag with a new bagSlots value must add its option with no code edit.
    expect(MARKET_BAG_SIZE_FILTERS.slice(1)).toEqual(catalogSizes.map((slots) => `${slots}`));
    // Ascending as a property of the list itself, independent of how it was derived, so
    // this arm still means something if the derivation and the expectation drift together.
    const offered = MARKET_BAG_SIZE_FILTERS.slice(1).map(Number);
    expect(offered).toEqual([...offered].sort((a, b) => a - b));
    // And one literal anchor, matching how the sibling vocabularies are pinned above.
    // The SOURCE stays derived (that is the point); this is the line that reddens if a
    // catalog-side bagSlots typo moves the derivation and its mirror in lockstep, and it
    // is deliberately the one place a new bag capacity has to be acknowledged by a human.
    expect([...MARKET_BAG_SIZE_FILTERS]).toEqual(['all', '6', '8', '10', '12', '14']);
  });

  it('narrows bags by exact capacity, and every catalog bag is reachable by one size', () => {
    for (const id of CATALOG_BAG_IDS) {
      const slots = ITEMS[id]?.bagSlots ?? 0;
      const own = MARKET_BAG_SIZE_FILTERS.filter(
        (subtype) => subtype !== 'all' && marketItemMatches(id, q({ itemType: 'bag', subtype })),
      );
      expect(own, `${id} (${slots} slots) must match exactly its own size option`).toEqual([
        `${slots}`,
      ]);
    }
    // And the size only narrows: 'all' keeps every bag in the list.
    expect(filterIds(CATALOG_BAG_IDS, { itemType: 'bag', subtype: 'all' })).toEqual(
      CATALOG_BAG_IDS,
    );
  });

  // The exhaustiveness tail in itemMatchesType is a tsc guard, and tsc is erased in
  // the shipped bundle. This drives what SURVIVES that erasure: an item type with no
  // arm must browse as nothing, never as everything. Returning the asserted `never`
  // value would hand back the truthy filter string and quietly match the whole
  // catalog, which is the failure this arm was added to prevent, not a louder one.
  it('degrades an item-type filter with no arm to matching nothing, never everything', () => {
    const rogue = { itemType: 'mount' as MarketQuery['itemType'] };
    expect(filterIds(items, rogue)).toEqual([]);
    expect(filterIds(CATALOG_BAG_IDS, rogue)).toEqual([]);
    // Non-vacuity: those same ids are matchable, so the empty results above are the
    // tail's doing and not an empty fixture.
    expect(filterIds(items).length).toBeGreaterThan(0);
    expect(filterIds(CATALOG_BAG_IDS, { itemType: 'bag' })).toEqual(CATALOG_BAG_IDS);
  });

  it('keeps a bag type and bag size through wire sanitization instead of falling back', () => {
    expect(sanitizeMarketQuery({ itemType: 'bag' }).itemType).toBe('bag');
    const size = MARKET_BAG_SIZE_FILTERS[1];
    expect(sanitizeMarketQuery({ itemType: 'bag', subtype: size }).subtype).toBe(size);
    // A capacity no bag ships is not an option, so it must not survive the wire.
    expect(sanitizeMarketQuery({ itemType: 'bag', subtype: '9999' }).subtype).toBe('all');
  });

  it('matches rarities by the game quality names', () => {
    // bone_fragments is a crafting reagent, so it is common (white), not poor.
    expect(filterIds(items, { rarity: 'poor' })).toEqual(['mudfin_scale']);
    expect(filterIds(items, { rarity: 'common' })).toEqual([
      'bone_fragments',
      'roasted_boar',
      'minor_healing_potion',
    ]);
    expect(filterIds(items, { rarity: 'uncommon' })).toEqual([
      'keen_dirk',
      'greyjaw_pelt_cloak',
      'elixir_of_the_bear',
    ]);
  });

  it('filters legendary-quality listings (the orange-name tier above epic)', () => {
    const withLegendary = [...items, 'deathless_heartwood', 'kingsbane_last_oath'];
    expect(filterIds(withLegendary, { rarity: 'legendary' })).toEqual([
      'deathless_heartwood',
      'kingsbane_last_oath',
    ]);
    expect(filterIds(withLegendary, { itemType: 'weapon', rarity: 'legendary' })).toEqual([
      'deathless_heartwood',
      'kingsbane_last_oath',
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

  it('narrows armor by cloth, leather, or mail independently of its slot', () => {
    const armor = ['woven_robe', 'shadow_jerkin', 'boundstone_helm', 'valefire_lantern'];
    expect(filterIds(armor, { itemType: 'armor', armorClass: 'cloth' })).toEqual(['woven_robe']);
    expect(filterIds(armor, { itemType: 'armor', armorClass: 'leather' })).toEqual([
      'shadow_jerkin',
    ]);
    expect(filterIds(armor, { itemType: 'armor', armorClass: 'mail' })).toEqual([
      'boundstone_helm',
    ]);
  });

  it('keeps the armor-class filter meaningful for every armor record', () => {
    // The 'armor' item type deliberately admits held offhands (orbs, lanterns), which the
    // class predicate then rejects via its `kind === 'armor'` clause. That clause is only
    // inert while no held offhand carries an armorType, so pin the content assumption: the
    // day one does, this reddens and someone revisits itemMatchesArmorClass.
    const offhands = Object.values(ITEMS).filter((item) => item.kind === 'held_offhand');
    expect(offhands.length).toBeGreaterThan(0);
    expect(offhands.every((item) => item.armorType === undefined)).toBe(true);
    // And every armorType in the catalog is an option the browse can actually select, so a
    // new armor class can never be silently unfilterable.
    const classes = new Set(
      Object.values(ITEMS)
        .map((item) => item.armorType)
        .filter((armorType): armorType is NonNullable<typeof armorType> => armorType !== undefined),
    );
    expect([...classes].sort()).toEqual(['cloth', 'leather', 'mail']);
    for (const armorClass of classes) {
      expect(MARKET_ARMOR_CLASS_FILTERS).toContain(armorClass);
    }
  });

  it('combines armor class, slot, and dominant primary stat filters', () => {
    const armor = [
      'eastbrook_warded_leggings',
      'sootscale_mantle',
      'drowned_prayer_leggings',
      'ironlink_legguards',
    ];
    expect(
      filterIds(armor, {
        itemType: 'armor',
        subtype: 'legs',
        armorClass: 'mail',
        primaryStat: 'int',
      }),
    ).toEqual(['eastbrook_warded_leggings']);
  });

  it('matches only a positive dominant Strength, Agility, or Intellect value', () => {
    const gear = [
      'boundstone_helm',
      'shadow_jerkin',
      'woven_robe',
      'recruit_tunic',
      'kingsbane_last_oath',
    ];
    expect(filterIds(gear, { itemType: 'armor', primaryStat: 'str' })).toEqual(['boundstone_helm']);
    expect(filterIds(gear, { itemType: 'armor', primaryStat: 'agi' })).toEqual(['shadow_jerkin']);
    expect(filterIds(gear, { itemType: 'armor', primaryStat: 'int' })).toEqual(['woven_robe']);
    expect(filterIds(gear, { itemType: 'weapon', primaryStat: 'str' })).toEqual([
      'kingsbane_last_oath',
    ]);
    expect(filterIds(gear, { itemType: 'weapon', primaryStat: 'agi' })).toEqual([
      'kingsbane_last_oath',
    ]);
  });

  it('narrows WEAPONS by dominant primary stat too, not only armor', () => {
    // The armor cases above cannot prove the weapon half of the itemType guard: the only
    // weapon in that fixture is the one tied str/agi piece, so it matches whether or not
    // the filter runs. These weapons each have a DIFFERENT dominant stat, so making the
    // primary-stat filter a no-op for weapons reddens all three lines.
    const weapons = [
      'bonewrought_greatsword', // str 14
      'direfang_greatblade', // agi 14
      'drownedmoon_scepter', // int 10
      'worn_sword', // no stats at all
    ];
    expect(filterIds(weapons, { itemType: 'weapon', primaryStat: 'str' })).toEqual([
      'bonewrought_greatsword',
    ]);
    expect(filterIds(weapons, { itemType: 'weapon', primaryStat: 'agi' })).toEqual([
      'direfang_greatblade',
    ]);
    expect(filterIds(weapons, { itemType: 'weapon', primaryStat: 'int' })).toEqual([
      'drownedmoon_scepter',
    ]);
    // Dominance, not mere presence: the greatstaff carries agi 4 under str 5, so it is a
    // Strength weapon only.
    expect(filterIds(['cragthorn_greatstaff'], { itemType: 'weapon', primaryStat: 'str' })).toEqual(
      ['cragthorn_greatstaff'],
    );
    expect(filterIds(['cragthorn_greatstaff'], { itemType: 'weapon', primaryStat: 'agi' })).toEqual(
      [],
    );
  });

  it('ignores advanced filters outside their matching item type', () => {
    expect(filterIds(['worn_sword'], { itemType: 'weapon', armorClass: 'mail' })).toEqual([
      'worn_sword',
    ]);
    expect(filterIds(['minor_healing_potion'], { itemType: 'all', primaryStat: 'str' })).toEqual([
      'minor_healing_potion',
    ]);
  });

  it('narrows armor filters to the jewelry slots (neck and ring)', () => {
    // Jewelry is kind 'armor' with slot 'ring'/'neck' (heroic vendor exemplars), so the
    // shared slot predicate must sub-filter it like any other wearable slot.
    const armor = ['seal_of_the_nine_oaths', 'yumis_keepsake_locket', 'recruit_tunic'];
    expect(filterIds(armor, { itemType: 'armor', subtype: 'ring' })).toEqual([
      'seal_of_the_nine_oaths',
    ]);
    expect(filterIds(armor, { itemType: 'armor', subtype: 'neck' })).toEqual([
      'yumis_keepsake_locket',
    ]);
  });

  it('narrows armor filters to the off-hand slot (shields and held offhands)', () => {
    // The armor bucket admits armor-kind shields AND held_offhand items, both
    // slot 'offhand', so the offhand subtype must return both kinds together.
    const armor = [
      'eastbrook_buckler',
      'valefire_lantern',
      'recruit_tunic',
      'seal_of_the_nine_oaths',
    ];
    expect(filterIds(armor, { itemType: 'armor', subtype: 'offhand' })).toEqual([
      'eastbrook_buckler',
      'valefire_lantern',
    ]);
  });

  it('keeps neck and ring subtypes through wire sanitization instead of falling back', () => {
    expect(sanitizeMarketQuery({ itemType: 'armor', subtype: 'ring' }).subtype).toBe('ring');
    expect(sanitizeMarketQuery({ itemType: 'armor', subtype: 'neck' }).subtype).toBe('neck');
    expect(sanitizeMarketQuery({ itemType: 'armor', subtype: 'bogus' }).subtype).toBe('all');
  });

  it('sanitizes armor class and primary stat wire filters', () => {
    const valid = sanitizeMarketQuery({ armorClass: 'leather', primaryStat: 'int' });
    expect(valid.armorClass).toBe('leather');
    expect(valid.primaryStat).toBe('int');

    const invalid = sanitizeMarketQuery({ armorClass: 'plate', primaryStat: 'stamina' });
    expect(invalid.armorClass).toBe('all');
    expect(invalid.primaryStat).toBe('all');
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
    expect(filterIds(items, { search: 'mudfin' })).toEqual(['mudfin_scale']);
    expect(filterIds(items, { search: 'ZZZNOMATCH' })).toEqual([]);
    // The server drops listings whose item it no longer knows, so the predicate rejects them.
    expect(marketItemMatches('not_a_real_item', q())).toBe(false);
  });
});
