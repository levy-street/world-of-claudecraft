// Pure, host-agnostic view model for the World Market window.
//
// The pure-core half of the pure-core + thin-painter split (root CLAUDE.md
// Conventions; reference vendor_view.ts). It models the one thing the market
// window decides that is worth testing without a DOM: which of the window's
// states the current snapshot is in, and what rows each state shows.
//
// The market is SNAPSHOT-DRIVEN, not promise/fetch-based: the painter reads
// `IWorld.marketInfo` (a `MarketInfo | null` mirrored identically by the offline
// Sim and the online ClientWorld) and a search query echoed back from the
// server. So the data-absent case (`marketInfo === null`) is the loading / no
// merchant state, and the empty cases are the search/browse/filter misses. There
// is no separate error channel on `marketInfo`, so the union carries no error
// variant (the only Promise-returning market-class surface is the leaderboard,
// in its own module). Filtering reuses the already-extracted market_filters helper
// rather than re-deriving it.
//
// DOM-free and i18n-free so tests/market_view.test.ts can drive it directly with
// both a Sim-shaped and a ClientWorld-mirror-shaped snapshot.

import { ITEMS } from '../sim/data';
import { isTransferLockedInstance } from '../sim/item_instance_transfer';
import type { ItemDef, ItemInstancePayload } from '../sim/types';
import type { MarketInfo, MarketListingView } from '../world_api';
import {
  MARKET_ARMOR_TYPE_FILTERS,
  MARKET_BAG_SIZE_FILTERS,
  MARKET_PAGE_SIZE,
  MARKET_WEAPON_TYPE_FILTERS,
  type MarketFilters,
  type MarketItemTypeFilter,
  type MarketSubtypeFilter,
} from './market_filters';

export type MarketTab = 'browse' | 'sell' | 'collect';

/** Copper in one gold / one silver, for splitting a suggested ask into coins. */
export const COPPER_PER_GOLD = 10000;
export const COPPER_PER_SILVER = 100;

/** One browse-list row: the raw listing plus its resolved item definition. */
export interface MarketBrowseRow {
  listing: MarketListingView;
  item: ItemDef;
}

/** A page of resolved browse rows (the listing page shape, rows not listings). */
export interface MarketBrowsePage {
  items: MarketBrowseRow[];
  page: number;
  pageCount: number;
  total: number;
  start: number;
  end: number;
}

/**
 * The Browse tab body. `empty` distinguishes WHY nothing shows so the painter
 * can pick the right copy: `browse` (no listings at all), `search` (the active
 * server search matched nothing), `filtered` (listings exist but the local
 * type/rarity filter excluded them all). `list` carries a page of resolved rows.
 */
export type MarketBrowseBody =
  | { state: 'empty'; reason: 'browse' | 'search' | 'filtered' }
  | { state: 'list'; page: MarketBrowsePage };

/** The Sell tab's price form, when a listable bag item is staged. */
export interface MarketSellForm {
  itemId: string;
  item: ItemDef;
  /** How many of this item the player holds (the quantity cap). Always 1 for
   *  an instanced staging: instanced listings are single-copy. */
  have: number;
  /** A gentle starting ask, pre-split into gold / silver / copper inputs. */
  suggested: { gold: number; silver: number; copper: number };
  /** The staged copy's payload (issue 1165): present when the player clicked an
   *  instanced copy, which lists as ITSELF via marketListInstance. */
  instance?: ItemInstancePayload;
}

/**
 * The Sell tab body. `pick-empty` (nothing staged or none held), `cannot-market`
 * (the staged item is a quest item or flagged no-list; the painter clears the
 * staged item), `form` (a listable item, show the price form).
 */
export type MarketSellBody =
  | { state: 'pick-empty' }
  | { state: 'cannot-market' }
  | { state: 'form'; form: MarketSellForm };

/** The Merchant-cut + listing-cap figures the Sell tab note shows. */
export interface MarketSellMeta {
  cutPct: number;
  myListingCount: number;
  maxListings: number;
}

/** One Collect row: a returned/expired stack waiting to be reclaimed. */
export interface MarketCollectRow {
  item: ItemDef;
  count: number;
  /** The returned copy's payload (issue 1165): an expired instanced listing waits
   *  here with its enchant/signature intact, and the tooltip shows it. */
  instance?: ItemInstancePayload;
}

/**
 * One Collect row on the SALES side: a completed sale the proceeds line sums up.
 * Distinct from MarketCollectRow above, which is goods coming BACK (an expired or
 * reclaimed listing); these goods are gone and what waits is the gold.
 */
export interface MarketCollectSaleRow {
  item: ItemDef;
  count: number;
  /** Net copper this sale contributed, after the Merchant's cut. */
  proceeds: number;
  buyerName: string;
}

/** The Collect tab body: nothing to collect, or proceeds + item stacks. */
export type MarketCollectBody =
  | { state: 'empty' }
  | {
      state: 'items';
      proceeds: number;
      /** Itemized sales behind `proceeds`, oldest first. */
      sales: MarketCollectSaleRow[];
      /** Sales not listed in `sales`: dropped by the sim's ledger cap, or skipped
       *  here because the item id no longer resolves. Their gold is still in
       *  `proceeds`, so the tab reports the count instead of quietly under-listing. */
      salesOmitted: number;
      rows: MarketCollectRow[];
    };

/**
 * The full market view-model: the data-absent state, or one of the three tab
 * bodies. The painter switches on `kind` and renders.
 */
export type MarketView =
  | { kind: 'no-data' }
  | { kind: 'browse'; body: MarketBrowseBody }
  | { kind: 'sell'; body: MarketSellBody; meta: MarketSellMeta }
  | { kind: 'collect'; body: MarketCollectBody };

/** Inputs the painter feeds the builder each render. */
export interface MarketViewInput {
  info: MarketInfo | null;
  tab: MarketTab;
  filters: MarketFilters;
  /** The bag item staged for listing on the Sell tab, or null. */
  sellItemId: string | null;
  /** How many of `sellItemId` the player holds (0 when nothing staged). */
  sellHave: number;
  /** The staged copy's payload when an instanced copy was clicked (issue 1165). */
  sellInstance?: ItemInstancePayload | null;
}

/** True when any dropdown is narrowing the browse. */
function filtersActive(filters: MarketFilters): boolean {
  return (
    filters.itemType !== 'all' ||
    (filters.subtype !== undefined && filters.subtype !== 'all') ||
    (filters.armorClass !== undefined && filters.armorClass !== 'all') ||
    (filters.primaryStat !== undefined && filters.primaryStat !== 'all') ||
    filters.rarity !== 'all'
  );
}

/**
 * Build the Browse tab body. The server already filtered (search + type/subtype/
 * rarity) and paginated, so `info.listings` IS the page to show: the viewer's own
 * listings (always wired, for reclaim) plus one page of other sellers' listings.
 * `info.page` / `info.pageCount` drive the pager; `info.totalCount` is the full match
 * count (the viewer's own listings plus all others). `filters` only chooses the
 * empty-state copy.
 */
export function buildMarketBrowse(info: MarketInfo, filters: MarketFilters): MarketBrowseBody {
  const rows: MarketBrowseRow[] = [];
  for (const listing of info.listings) {
    const item = ITEMS[listing.itemId];
    if (!item) continue; // a listing for an item we no longer know is dropped
    rows.push({ listing, item });
  }
  if (rows.length === 0) {
    const reason = info.filter.trim() ? 'search' : filtersActive(filters) ? 'filtered' : 'browse';
    return { state: 'empty', reason };
  }
  // The pager and range note describe the paged OTHER listings; the viewer's own
  // listings ride on top of every page and are not counted in the range. The server
  // wires all of the viewer's own matches on every page, so subtracting them from
  // totalCount (mine + others) yields the true count of paged others.
  const othersOnPage = rows.reduce((n, r) => n + (r.listing.mine ? 0 : 1), 0);
  const mineOnPage = rows.length - othersOnPage;
  const othersTotal = info.totalCount - mineOnPage;
  const start = info.page * MARKET_PAGE_SIZE;
  return {
    state: 'list',
    page: {
      items: rows,
      page: info.page,
      pageCount: info.pageCount,
      total: othersTotal,
      start,
      end: start + othersOnPage,
    },
  };
}

/** Build the Sell tab body for the staged item (`sellHave` is its bag count).
 *  `sellInstance` is the staged copy's payload: an instanced staging is a
 *  single-copy form (have 1, no quantity stepper), and a transfer-locked copy
 *  (defence in depth; the bags click already blocks it) cannot market. */
export function buildMarketSell(
  sellItemId: string | null,
  sellHave: number,
  sellInstance?: ItemInstancePayload | null,
): MarketSellBody {
  const item = sellItemId ? ITEMS[sellItemId] : null;
  if (!sellItemId || !item || sellHave <= 0) return { state: 'pick-empty' };
  if (item.kind === 'quest' || item.noMarketList || item.soulbound)
    return { state: 'cannot-market' };
  if (sellInstance && isTransferLockedInstance(sellInstance)) return { state: 'cannot-market' };
  // A gentle starting ask: the vendor shop price when the item has one, but
  // never more than 10x its vendor sell value (the recipe-economy rework re-priced
  // four commons' sellValues while deliberately keeping their historical shop
  // buyValues, so a raw buyValue read would suggest a 20x-29x ask); items with
  // no shop price suggest a few times sell value. Never below 1c.
  const vendorFloor = Math.max(1, item.sellValue);
  const suggested = Math.max(
    1,
    item.buyValue != null ? Math.min(item.buyValue, vendorFloor * 10) : vendorFloor * 4,
  );
  const gold = Math.floor(suggested / COPPER_PER_GOLD);
  const silver = Math.floor((suggested % COPPER_PER_GOLD) / COPPER_PER_SILVER);
  const copper = suggested % COPPER_PER_SILVER;
  return {
    state: 'form',
    form: {
      itemId: sellItemId,
      item,
      have: sellInstance ? 1 : sellHave,
      suggested: { gold, silver, copper },
      ...(sellInstance ? { instance: sellInstance } : {}),
    },
  };
}

/** Build the Collect tab body from a snapshot. */
export function buildMarketCollect(info: MarketInfo): MarketCollectBody {
  // A sale whose proceeds floored to 0 copper still leaves a ledger row, so the
  // empty test reads the ledger too: an empty body would strand it unshown.
  if (
    info.collectionCopper <= 0 &&
    info.collectionItems.length === 0 &&
    info.collectionSales.length === 0
  ) {
    return { state: 'empty' };
  }
  const rows: MarketCollectRow[] = [];
  for (const slot of info.collectionItems) {
    const item = ITEMS[slot.itemId];
    if (!item) continue;
    rows.push({ item, count: slot.count, ...(slot.instance ? { instance: slot.instance } : {}) });
  }
  const sales: MarketCollectSaleRow[] = [];
  // An id a content edit retired can no longer be named, so the row is dropped
  // like the returns above; it counts as omitted rather than vanishing, because
  // its gold is still inside the proceeds total this list is explaining.
  let salesOmitted = info.collectionSalesOmitted;
  for (const sale of info.collectionSales) {
    const item = ITEMS[sale.itemId];
    if (!item) {
      salesOmitted += 1;
      continue;
    }
    sales.push({
      item,
      count: sale.count,
      proceeds: sale.proceeds,
      buyerName: sale.buyerName,
    });
  }
  return { state: 'items', proceeds: info.collectionCopper, sales, salesOmitted, rows };
}

/**
 * Build the full market view-model. `info === null` (no merchant data has
 * arrived yet) is the data-absent state the painter renders as the no-merchant
 * notice; otherwise the active tab's body is derived.
 */
export function buildMarketView(input: MarketViewInput): MarketView {
  const { info, tab } = input;
  if (!info) return { kind: 'no-data' };
  if (tab === 'browse') return { kind: 'browse', body: buildMarketBrowse(info, input.filters) };
  if (tab === 'sell') {
    return {
      kind: 'sell',
      body: buildMarketSell(input.sellItemId, input.sellHave, input.sellInstance),
      meta: {
        cutPct: info.cutPct,
        myListingCount: info.myListingCount,
        maxListings: info.maxListings,
      },
    };
  }
  return { kind: 'collect', body: buildMarketCollect(info) };
}

/**
 * What axis the subtype menu narrows by. The painter switches its caption and its
 * option labels on THIS, never on the item type again: the two are decided together
 * here, so an item type that gains a subtype axis cannot get its options from one
 * place and its wording from another.
 */
export type MarketSubtypeKind = 'armorSlot' | 'weaponFamily' | 'bagCapacity';

/** Which secondary browse menus an item type shows, and the subtype menu's options. */
export interface MarketFilterMenus {
  /** The subtype menu's option list, or null when this type has no subtype axis. */
  subtype: readonly MarketSubtypeFilter[] | null;
  /** What those options MEAN, for the painter's caption and per-option wording. */
  subtypeKind: MarketSubtypeKind | null;
  /** True when the armor-class (cloth / leather / mail) menu applies. */
  armorClass: boolean;
  /** True when the primary-stat menu applies. */
  primaryStat: boolean;
}

/**
 * Which secondary menus an item type can actually narrow by.
 *
 * Bags get a capacity menu but NOT a primary-stat menu: bags carry no str/agi/int
 * and `itemMatchesPrimaryStat` ignores the filter outside armor/weapon, so a stat
 * menu on bags would be a live-looking control that can never change the result.
 * Lives here, not on the painter, because the decision is pure: it is a function of
 * the item type alone, so a Node test drives it directly instead of grepping the
 * painter's source for the gate.
 */
export function marketFilterMenus(itemType: MarketItemTypeFilter): MarketFilterMenus {
  if (itemType === 'armor')
    return {
      subtype: MARKET_ARMOR_TYPE_FILTERS,
      subtypeKind: 'armorSlot',
      armorClass: true,
      primaryStat: true,
    };
  if (itemType === 'weapon')
    return {
      subtype: MARKET_WEAPON_TYPE_FILTERS,
      subtypeKind: 'weaponFamily',
      armorClass: false,
      primaryStat: true,
    };
  if (itemType === 'bag')
    return {
      subtype: MARKET_BAG_SIZE_FILTERS,
      subtypeKind: 'bagCapacity',
      armorClass: false,
      primaryStat: false,
    };
  return { subtype: null, subtypeKind: null, armorClass: false, primaryStat: false };
}

/**
 * The count of items waiting to be collected, for the Collect tab's badge. The
 * proceeds purse counts as one, plus each returned stack.
 */
export function marketCollectBadgeCount(info: MarketInfo | null): number {
  if (!info) return 0;
  // The purse counts ONCE however many sales fill it: the ledger itemizes the same
  // gold the purse already stands for, so counting rows too would double it. The
  // ledger only widens WHEN the purse counts, for the 0-copper sale that leaves a
  // row and no coin (a 1-copper listing against the Merchant's cut).
  const purse = info.collectionCopper > 0 || info.collectionSales.length > 0 ? 1 : 0;
  return purse + info.collectionItems.length;
}

/** The minimap-corner collect indicator (the mailIndicatorView pattern). */
export interface MarketCollectIndicatorView {
  visible: boolean;
}

/**
 * Driven by the always-streamed IWorld.marketCollectPending bit, NOT by
 * marketInfo (null away from the Merchant), so the badge lights anywhere in
 * the world while sale proceeds or returned items wait.
 */
export function marketCollectIndicatorView(pending: boolean): MarketCollectIndicatorView {
  return { visible: pending === true };
}
