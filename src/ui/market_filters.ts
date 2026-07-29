// Client re-exports of the host-agnostic market query module (src/sim/market_query.ts):
// the filter option lists and types drive the browse-tab dropdowns, and the shared
// `marketItemMatches` predicate is the one the server filters with. The live browse
// path filters + paginates on the SERVER (so a player can page through the whole
// market); this module is the client's window onto that shared vocabulary, plus the
// `MarketFilters` type that models the three dropdowns.

import type {
  MarketArmorClassFilter,
  MarketItemTypeFilter,
  MarketPrimaryStatFilter,
  MarketRarityFilter,
  MarketSubtypeFilter,
} from '../sim/market_query';

export {
  defaultMarketQuery,
  MARKET_ARMOR_CLASS_FILTERS,
  MARKET_ARMOR_TYPE_FILTERS,
  MARKET_BAG_SIZE_FILTERS,
  MARKET_ITEM_TYPE_FILTERS,
  MARKET_PAGE_SIZE,
  MARKET_PRIMARY_STAT_FILTERS,
  MARKET_RARITY_FILTERS,
  MARKET_WEAPON_TYPE_FILTERS,
  type MarketArmorClassFilter,
  type MarketArmorTypeFilter,
  type MarketBagSizeFilter,
  type MarketItemTypeFilter,
  type MarketPrimaryStatFilter,
  type MarketQuery,
  type MarketRarityFilter,
  type MarketSubtypeFilter,
  type MarketWeaponTypeFilter,
  sanitizeMarketQuery,
} from '../sim/market_query';

/** The browse-tab dropdown filters (no search / page; that lives in MarketQuery). */
export interface MarketFilters {
  itemType: MarketItemTypeFilter;
  subtype?: MarketSubtypeFilter;
  armorClass?: MarketArmorClassFilter;
  primaryStat?: MarketPrimaryStatFilter;
  rarity: MarketRarityFilter;
}
