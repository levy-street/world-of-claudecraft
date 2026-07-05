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
import type { ItemDef } from '../sim/types';
import type { MarketInfo, MarketListingView } from '../world_api';
import { MARKET_PAGE_SIZE, type MarketFilters } from './market_filters';

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
  /** How many of this item the player holds (the quantity cap). */
  have: number;
  /** A gentle starting ask, pre-split into gold / silver / copper inputs. */
  suggested: { gold: number; silver: number; copper: number };
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
}

/** The Collect tab body: nothing to collect, or proceeds + item stacks. */
export type MarketCollectBody =
  | { state: 'empty' }
  | { state: 'items'; proceeds: number; rows: MarketCollectRow[] };

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
}

/** True when any of the type/subtype/rarity dropdowns is narrowing the browse. */
function filtersActive(filters: MarketFilters): boolean {
  return (
    filters.itemType !== 'all' ||
    (filters.subtype !== undefined && filters.subtype !== 'all') ||
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

/** Build the Sell tab body for the staged item (`sellHave` is its bag count). */
export function buildMarketSell(sellItemId: string | null, sellHave: number): MarketSellBody {
  const item = sellItemId ? ITEMS[sellItemId] : null;
  if (!sellItemId || !item || sellHave <= 0) return { state: 'pick-empty' };
  if (item.kind === 'quest' || item.noMarketList) return { state: 'cannot-market' };
  // A gentle starting ask: a few times vendor value, never below 1c.
  const suggested = Math.max(1, item.buyValue ?? Math.max(1, item.sellValue) * 4);
  const gold = Math.floor(suggested / COPPER_PER_GOLD);
  const silver = Math.floor((suggested % COPPER_PER_GOLD) / COPPER_PER_SILVER);
  const copper = suggested % COPPER_PER_SILVER;
  return {
    state: 'form',
    form: { itemId: sellItemId, item, have: sellHave, suggested: { gold, silver, copper } },
  };
}

/** Build the Collect tab body from a snapshot. */
export function buildMarketCollect(info: MarketInfo): MarketCollectBody {
  if (info.collectionCopper <= 0 && info.collectionItems.length === 0) {
    return { state: 'empty' };
  }
  const rows: MarketCollectRow[] = [];
  for (const slot of info.collectionItems) {
    const item = ITEMS[slot.itemId];
    if (!item) continue;
    rows.push({ item, count: slot.count });
  }
  return { state: 'items', proceeds: info.collectionCopper, rows };
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
      body: buildMarketSell(input.sellItemId, input.sellHave),
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
 * The count of items waiting to be collected, for the Collect tab's badge. The
 * proceeds purse counts as one, plus each returned stack.
 */
export function marketCollectBadgeCount(info: MarketInfo | null): number {
  if (!info) return 0;
  return (info.collectionCopper > 0 ? 1 : 0) + info.collectionItems.length;
}
