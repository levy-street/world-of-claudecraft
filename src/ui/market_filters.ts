import { ITEMS } from '../sim/data';
import type { ItemDef } from '../sim/types';
import type { MarketListingView } from '../world_api';

export const MARKET_ITEM_TYPE_FILTERS = ['all', 'weapon', 'armor', 'consumable', 'material', 'cosmetic', 'other'] as const;
export const MARKET_ARMOR_TYPE_FILTERS = ['all', 'helmet', 'shoulder', 'chest', 'waist', 'legs', 'gloves', 'feet'] as const;
export const MARKET_WEAPON_TYPE_FILTERS = ['all', 'sword', 'dagger', 'staff', 'mace', 'axe', 'other'] as const;
export const MARKET_RARITY_FILTERS = ['all', 'poor', 'common', 'uncommon', 'rare', 'epic'] as const;
export const MARKET_PAGE_SIZE = 50;

export type MarketItemTypeFilter = typeof MARKET_ITEM_TYPE_FILTERS[number];
export type MarketArmorTypeFilter = typeof MARKET_ARMOR_TYPE_FILTERS[number];
export type MarketWeaponTypeFilter = typeof MARKET_WEAPON_TYPE_FILTERS[number];
export type MarketSubtypeFilter = MarketArmorTypeFilter | MarketWeaponTypeFilter;
export type MarketRarityFilter = typeof MARKET_RARITY_FILTERS[number];

export interface MarketFilters {
  itemType: MarketItemTypeFilter;
  subtype?: MarketSubtypeFilter;
  rarity: MarketRarityFilter;
}

function isCosmeticItem(item: ItemDef): boolean {
  return item.use?.type === 'mechChroma' || item.use?.type === 'skinSelect';
}

function itemMatchesType(item: ItemDef, filter: MarketItemTypeFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'weapon') return item.kind === 'weapon' && item.slot === 'mainhand';
  if (filter === 'armor') return item.kind === 'armor' && item.slot !== undefined;
  if (filter === 'consumable') return item.kind === 'food' || item.kind === 'drink' || item.kind === 'potion' || item.kind === 'elixir';
  if (filter === 'material') return !isCosmeticItem(item) && (item.kind === 'junk' || item.kind === 'tool');
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

function itemMatchesSubtype(item: ItemDef, filters: MarketFilters): boolean {
  const subtype = filters.subtype ?? 'all';
  if (subtype === 'all') return true;
  if (filters.itemType === 'armor') return item.kind === 'armor' && item.slot === subtype;
  if (filters.itemType === 'weapon') return item.kind === 'weapon' && weaponFamily(item) === subtype;
  return true;
}

function itemMatchesRarity(item: ItemDef, filter: MarketRarityFilter): boolean {
  if (filter === 'all') return true;
  return (item.quality ?? 'common') === filter;
}

export function filterMarketListings(listings: readonly MarketListingView[], filters: MarketFilters): MarketListingView[] {
  return listings.filter((listing) => {
    const item = ITEMS[listing.itemId];
    if (!item) return false;
    return itemMatchesType(item, filters.itemType) && itemMatchesSubtype(item, filters) && itemMatchesRarity(item, filters.rarity);
  });
}

export interface MarketListingPage<T extends MarketListingView = MarketListingView> {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
  start: number;
  end: number;
}

export function paginateMarketListings<T extends MarketListingView>(
  listings: readonly T[],
  requestedPage: number,
  pageSize = MARKET_PAGE_SIZE,
): MarketListingPage<T> {
  const total = listings.length;
  const safePageSize = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : MARKET_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / safePageSize));
  const requested = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0;
  const page = Math.max(0, Math.min(pageCount - 1, requested));
  const start = page * safePageSize;
  const end = Math.min(total, start + safePageSize);
  return {
    items: listings.slice(start, end),
    page,
    pageCount,
    total,
    start,
    end,
  };
}
