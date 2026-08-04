// The World Market browse query: the search string, the type / subtype / rarity
// filters, and the page index, plus the PURE predicate that decides whether a
// listing's item matches. Host-agnostic (src/sim, no DOM / i18n), so BOTH the
// server (src/sim/market.ts, which filters + paginates authoritatively) and the
// client filter chrome (src/ui/market_filters.ts re-exports the option lists) share
// one definition and can never drift. Moving filtering server-side is what lets a
// player page through and filter the WHOLE market, not just the first wire window.

import { ITEMS } from './data';
import type { ArmorType, ItemDef } from './types';

export const MARKET_ITEM_TYPE_FILTERS = [
  'all',
  'weapon',
  'armor',
  'bag',
  'consumable',
  'material',
  'cosmetic',
  'other',
] as const;
export const MARKET_ARMOR_TYPE_FILTERS = [
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
] as const;
export const MARKET_WEAPON_TYPE_FILTERS = [
  'all',
  'sword',
  'dagger',
  'staff',
  'mace',
  'axe',
  'other',
] as const;
/** A bag-capacity subtype option: 'all', or a stringified `bagSlots` value from the catalog. */
export type MarketBagSizeFilter = 'all' | `${number}`;
// DERIVED from the item catalog, never a hardcoded list. Authoring a bag record with a
// capacity no other bag has adds its browse option automatically, in ascending order,
// with no code and no locale change: the option label reuses the already-translated
// `itemUi.tooltip.bagSlots` template, which takes the number as a value.
//
// A bag with bagSlots 0, or with bagSlots omitted entirely (defaulted to 0 below), is a
// legitimate distinct capacity, not noise to drop: excluding it here would still let the
// bag match under itemType 'bag' + subtype 'all' (itemMatchesSubtype short-circuits on
// 'all'), but no specific-capacity button could ever reach it. So every distinct value,
// including 0, gets its own option.
export function deriveBagSizeFilters(items: readonly ItemDef[]): readonly MarketBagSizeFilter[] {
  return [
    'all',
    ...[...new Set(items.filter((item) => item.kind === 'bag').map((item) => item.bagSlots ?? 0))]
      .sort((a, b) => a - b)
      .map((slots) => `${slots}` as const),
  ];
}
export const MARKET_BAG_SIZE_FILTERS: readonly MarketBagSizeFilter[] = deriveBagSizeFilters(
  Object.values(ITEMS),
);
// Bound to the content union both ways on purpose: `satisfies` rejects an option that is not
// a real ArmorType, and the Exclude assertion below reddens tsc if ArmorType ever gains a class
// with no option here (which would silently make that whole armor class unbrowsable).
export const MARKET_ARMOR_CLASS_FILTERS = [
  'all',
  'cloth',
  'leather',
  'mail',
] as const satisfies readonly ('all' | ArmorType)[];
type AssertNever<T extends never> = T;
type _EveryArmorTypeIsFilterable = AssertNever<
  Exclude<ArmorType, (typeof MARKET_ARMOR_CLASS_FILTERS)[number]>
>;
export const MARKET_PRIMARY_STAT_FILTERS = ['all', 'str', 'agi', 'int'] as const;
export const MARKET_RARITY_FILTERS = [
  'all',
  'poor',
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
] as const;

// Listings per browse page (the count of OTHER sellers' listings shown at a time;
// the player's own listings are always wired on top for quick reclaim).
export const MARKET_PAGE_SIZE = 50;

export type MarketItemTypeFilter = (typeof MARKET_ITEM_TYPE_FILTERS)[number];
export type MarketArmorTypeFilter = (typeof MARKET_ARMOR_TYPE_FILTERS)[number];
export type MarketWeaponTypeFilter = (typeof MARKET_WEAPON_TYPE_FILTERS)[number];
export type MarketSubtypeFilter =
  | MarketArmorTypeFilter
  | MarketWeaponTypeFilter
  | MarketBagSizeFilter;
export type MarketArmorClassFilter = (typeof MARKET_ARMOR_CLASS_FILTERS)[number];
export type MarketPrimaryStatFilter = (typeof MARKET_PRIMARY_STAT_FILTERS)[number];
export type MarketRarityFilter = (typeof MARKET_RARITY_FILTERS)[number];

/** The full browse state: search text, filters, and the page index. */
export interface MarketQuery {
  search: string;
  itemType: MarketItemTypeFilter;
  subtype: MarketSubtypeFilter;
  armorClass: MarketArmorClassFilter;
  primaryStat: MarketPrimaryStatFilter;
  rarity: MarketRarityFilter;
  page: number;
}

export function defaultMarketQuery(): MarketQuery {
  return {
    search: '',
    itemType: 'all',
    subtype: 'all',
    armorClass: 'all',
    primaryStat: 'all',
    rarity: 'all',
    page: 0,
  };
}

// Coerce an untrusted (wire) query into a valid MarketQuery: unknown enum values
// fall back to 'all', the search is trimmed to 40 chars, the page floored at 0.
export function sanitizeMarketQuery(
  raw:
    | {
        search?: unknown;
        itemType?: unknown;
        subtype?: unknown;
        armorClass?: unknown;
        primaryStat?: unknown;
        rarity?: unknown;
        page?: unknown;
      }
    | null
    | undefined,
): MarketQuery {
  const oneOf = <T extends string>(opts: readonly T[], v: unknown, fallback: T): T =>
    typeof v === 'string' && (opts as readonly string[]).includes(v) ? (v as T) : fallback;
  const page =
    typeof raw?.page === 'number' && Number.isFinite(raw.page)
      ? Math.max(0, Math.floor(raw.page))
      : 0;
  return {
    search: typeof raw?.search === 'string' ? raw.search.slice(0, 40) : '',
    itemType: oneOf(MARKET_ITEM_TYPE_FILTERS, raw?.itemType, 'all'),
    subtype: oneOf(
      [
        ...MARKET_ARMOR_TYPE_FILTERS,
        ...MARKET_WEAPON_TYPE_FILTERS,
        ...MARKET_BAG_SIZE_FILTERS,
      ] as const,
      raw?.subtype,
      'all',
    ),
    armorClass: oneOf(MARKET_ARMOR_CLASS_FILTERS, raw?.armorClass, 'all'),
    primaryStat: oneOf(MARKET_PRIMARY_STAT_FILTERS, raw?.primaryStat, 'all'),
    rarity: oneOf(MARKET_RARITY_FILTERS, raw?.rarity, 'all'),
    page,
  };
}

function isCosmeticItem(item: ItemDef): boolean {
  return item.use?.type === 'mechChroma' || item.use?.type === 'skinSelect';
}

function itemMatchesType(item: ItemDef, filter: MarketItemTypeFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'weapon') return item.kind === 'weapon' && item.slot === 'mainhand';
  if (filter === 'armor')
    return (item.kind === 'armor' || item.kind === 'held_offhand') && item.slot !== undefined;
  if (filter === 'consumable')
    return (
      item.kind === 'food' ||
      item.kind === 'drink' ||
      item.kind === 'potion' ||
      item.kind === 'elixir'
    );
  if (filter === 'bag') return item.kind === 'bag';
  if (filter === 'material')
    return !isCosmeticItem(item) && (item.kind === 'junk' || item.kind === 'tool');
  if (filter === 'cosmetic') return isCosmeticItem(item);
  // The catch-all for catalog kinds with no browse category of their own. Mount
  // reins join quest items here: quest items are never listable, and reins
  // (listable now that they are unbound) are too few to earn a filter chip.
  // Neither may be left reachable through 'All' alone
  // (tests/market_filters.test.ts).
  if (filter === 'other') return item.kind === 'quest' || item.kind === 'mount';
  // Exhaustive on purpose: a future MARKET_ITEM_TYPE_FILTERS entry with no arm above
  // reddens tsc here instead of silently inheriting the 'other' predicate, which is
  // how `bag` browsed as nothing at all for its whole life before this arm existed.
  // The runtime tail is `false`, not the asserted value: types are erased in the
  // bundle, so returning `unhandled` would hand back the filter STRING, which is
  // truthy, and a category that somehow slipped past tsc would match EVERY item.
  // An empty category is the visible failure mode; one that matches everything is
  // the silent one this arm exists to prevent.
  const unhandled: never = filter;
  void unhandled;
  return false;
}

function weaponFamily(item: ItemDef): MarketWeaponTypeFilter {
  const haystack = `${item.id} ${item.name}`.toLowerCase();
  if (item.weapon?.dagger || /dagger|dirk|shiv|knife/.test(haystack)) return 'dagger';
  if (/staff|shortstaff/.test(haystack)) return 'staff';
  if (/mace|maul|cudgel|hammer/.test(haystack)) return 'mace';
  if (/axe|hatchet|cleaver|chopper/.test(haystack)) return 'axe';
  if (/sword|blade|saber|sabre/.test(haystack)) return 'sword';
  return 'other';
}

function itemMatchesSubtype(item: ItemDef, query: MarketQuery): boolean {
  const subtype = query.subtype ?? 'all';
  if (subtype === 'all') return true;
  if (query.itemType === 'armor')
    return (item.kind === 'armor' || item.kind === 'held_offhand') && item.slot === subtype;
  if (query.itemType === 'weapon') return item.kind === 'weapon' && weaponFamily(item) === subtype;
  // Bag capacity is exact, and the option values ARE the catalog's bagSlots numbers, so
  // this compares against content rather than a hardcoded ladder. A subtype left over
  // from another item type parses to NaN and matches nothing, exactly as a mismatched
  // slot or weapon family does above. Compared as numbers: this runs per listing per
  // browse, and stringifying the item's capacity would allocate on every one.
  if (query.itemType === 'bag')
    return item.kind === 'bag' && (item.bagSlots ?? 0) === Number(subtype);
  return true;
}

function itemMatchesRarity(item: ItemDef, filter: MarketRarityFilter): boolean {
  if (filter === 'all') return true;
  return (item.quality ?? 'common') === filter;
}

function itemMatchesArmorClass(item: ItemDef, query: MarketQuery): boolean {
  if (query.armorClass === 'all' || query.itemType !== 'armor') return true;
  return item.kind === 'armor' && item.armorType === query.armorClass;
}

function itemMatchesPrimaryStat(item: ItemDef, query: MarketQuery): boolean {
  if (query.primaryStat === 'all' || (query.itemType !== 'armor' && query.itemType !== 'weapon'))
    return true;

  const selected = item.stats?.[query.primaryStat] ?? 0;
  if (selected <= 0) return false;
  return (['str', 'agi', 'int'] as const).every((stat) => selected >= (item.stats?.[stat] ?? 0));
}

// True when a listing's item passes the search substring AND the type/subtype/rarity
// filters of `query`. The single source of truth used by the server's authoritative
// browse and (via market_filters re-export) the client's option chrome.
export function marketItemMatches(itemId: string, query: MarketQuery): boolean {
  const item = ITEMS[itemId];
  if (!item) return false;
  const search = query.search.trim().toLowerCase();
  if (search) {
    const name = (item.name ?? itemId).toLowerCase();
    if (!name.includes(search) && !itemId.toLowerCase().includes(search)) return false;
  }
  return (
    itemMatchesType(item, query.itemType) &&
    itemMatchesSubtype(item, query) &&
    itemMatchesArmorClass(item, query) &&
    itemMatchesPrimaryStat(item, query) &&
    itemMatchesRarity(item, query.rarity)
  );
}
