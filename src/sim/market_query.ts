// The World Market browse query: the search string, the type / subtype / rarity
// filters, and the page index, plus the PURE predicate that decides whether a
// listing's item matches. Host-agnostic (src/sim, no DOM / i18n), so BOTH the
// server (src/sim/market.ts, which filters + paginates authoritatively) and the
// client filter chrome (src/ui/market_filters.ts re-exports the option lists) share
// one definition and can never drift. Moving filtering server-side is what lets a
// player page through and filter the WHOLE market, not just the first wire window.

import { ITEMS } from './data';
import type { ItemDef } from './types';

export const MARKET_ITEM_TYPE_FILTERS = [
  'all',
  'weapon',
  'armor',
  'consumable',
  'material',
  'cosmetic',
  'other',
] as const;
export const MARKET_ARMOR_TYPE_FILTERS = [
  'all',
  'helmet',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
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
export type MarketSubtypeFilter = MarketArmorTypeFilter | MarketWeaponTypeFilter;
export type MarketRarityFilter = (typeof MARKET_RARITY_FILTERS)[number];

/** The full browse state: search text, the three filters, and the page index. */
export interface MarketQuery {
  search: string;
  itemType: MarketItemTypeFilter;
  subtype: MarketSubtypeFilter;
  rarity: MarketRarityFilter;
  page: number;
}

export function defaultMarketQuery(): MarketQuery {
  return { search: '', itemType: 'all', subtype: 'all', rarity: 'all', page: 0 };
}

// Coerce an untrusted (wire) query into a valid MarketQuery: unknown enum values
// fall back to 'all', the search is trimmed to 40 chars, the page floored at 0.
export function sanitizeMarketQuery(
  raw:
    | { search?: unknown; itemType?: unknown; subtype?: unknown; rarity?: unknown; page?: unknown }
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
      [...MARKET_ARMOR_TYPE_FILTERS, ...MARKET_WEAPON_TYPE_FILTERS] as const,
      raw?.subtype,
      'all',
    ),
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
  if (filter === 'material')
    return !isCosmeticItem(item) && (item.kind === 'junk' || item.kind === 'tool');
  if (filter === 'cosmetic') return isCosmeticItem(item);
  return item.kind === 'quest';
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
  return true;
}

function itemMatchesRarity(item: ItemDef, filter: MarketRarityFilter): boolean {
  if (filter === 'all') return true;
  return (item.quality ?? 'common') === filter;
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
    itemMatchesRarity(item, query.rarity)
  );
}
