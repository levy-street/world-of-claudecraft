// Pure shaping for the admin market tracker endpoints (server/admin.ts): the
// item catalog projection, the overview merge, the flip ranking, and the
// movers comparison. No IO and no clock reads; every function maps inputs the
// handlers fetched (market_tracker_db reads plus the in-memory ITEMS registry)
// to wire shapes, so a Vitest drives all of it directly. The fee math imports
// the sim's own MARKET_CUT constant, never a copied number, so a rebalance of
// the Merchant's cut reprices every margin here automatically.
//
// Wire shapes deliberately carry NO buyer or seller identity: these payloads
// are designed to become player-visible later, and the internal id columns
// must never ride along (market_tracker_db.ts reads already omit them).

import { ITEMS } from '../src/sim/data';
import { MARKET_CUT, MARKET_HOUSE_STOCK } from '../src/sim/market';
import type { MarketLatestSnapshotRow, MarketSaleStatsRow } from './market_tracker_db';

export interface MarketCatalogItem {
  itemId: string;
  name: string;
  quality: string;
  kind: string;
  vendorSellCopper: number;
  vendorBuyCopper: number | null;
  listable: boolean;
}

// The tracker's item universe: every shipped item def projected to the fields
// the market pages need. English names on purpose: this is an operator tool
// and the defs are the same table the sim prices against. Built lazily once
// per process (the registry is immutable after boot).
let catalogCache: MarketCatalogItem[] | undefined;
export function marketItemCatalog(): MarketCatalogItem[] {
  catalogCache ??= Object.values(ITEMS).map((def) => ({
    itemId: def.id,
    name: def.name,
    quality: def.quality ?? 'common',
    kind: def.kind,
    vendorSellCopper: def.sellValue,
    vendorBuyCopper: def.buyValue ?? null,
    listable: def.kind !== 'quest' && !def.noMarketList && !def.soulbound,
  }));
  return catalogCache;
}

// The Merchant's standing stock as a per-item unit ask: a permanent price
// ceiling the flip finder must respect (nobody pays a player more than the
// Merchant charges for the same item). Derived from the sim constant, built
// once.
let houseAskCache: Map<string, number> | undefined;
export function houseUnitAskByItem(): Map<string, number> {
  if (!houseAskCache) {
    houseAskCache = new Map();
    for (const row of MARKET_HOUSE_STOCK) {
      const unit = row.price / row.count;
      const held = houseAskCache.get(row.itemId);
      if (held === undefined || unit < held) houseAskCache.set(row.itemId, unit);
    }
  }
  return houseAskCache;
}

export interface MarketOverviewRow extends MarketCatalogItem {
  // Latest capture of the player book; null when the item has no listings.
  lowestAskUnitCopper: number | null;
  lowestAskTotalCopper: number | null;
  lowestAskQuantity: number | null;
  listingCount: number;
  listedQuantity: number;
  // The Merchant's permanent ask for this item, when stocked.
  houseUnitAskCopper: number | null;
  // Player-sale stats over the two standard windows.
  sales24h: MarketSaleStatsRow | null;
  sales7d: MarketSaleStatsRow | null;
}

// Merge the catalog with the latest snapshot and the two stats windows. Only
// items with ANY market signal (listable, or with history) earn a row; an
// unlistable item that never traded is noise on an economy dashboard.
export function buildMarketOverview(
  snapshots: MarketLatestSnapshotRow[],
  stats24h: MarketSaleStatsRow[],
  stats7d: MarketSaleStatsRow[],
): MarketOverviewRow[] {
  const byItemSnapshot = new Map(snapshots.map((row) => [row.itemId, row]));
  const byItem24 = new Map(stats24h.map((row) => [row.itemId, row]));
  const byItem7 = new Map(stats7d.map((row) => [row.itemId, row]));
  const houseAsks = houseUnitAskByItem();
  const out: MarketOverviewRow[] = [];
  for (const item of marketItemCatalog()) {
    const snap = byItemSnapshot.get(item.itemId) ?? null;
    const day = byItem24.get(item.itemId) ?? null;
    const week = byItem7.get(item.itemId) ?? null;
    const house = houseAsks.get(item.itemId) ?? null;
    if (!item.listable && !snap && !day && !week) continue;
    out.push({
      ...item,
      lowestAskUnitCopper: snap ? snap.lowestAskTotalCopper / snap.lowestAskQuantity : null,
      lowestAskTotalCopper: snap ? snap.lowestAskTotalCopper : null,
      lowestAskQuantity: snap ? snap.lowestAskQuantity : null,
      listingCount: snap ? snap.listingCount : 0,
      listedQuantity: snap ? snap.totalQuantity : 0,
      houseUnitAskCopper: house,
      sales24h: day,
      sales7d: week,
    });
  }
  return out;
}

export interface MarketFlipRow {
  itemId: string;
  name: string;
  quality: string;
  kind: string;
  // The way in: the cheapest current stack, whole-stack buyout.
  buyTotalCopper: number;
  buyQuantity: number;
  buyUnitCopper: number;
  // The way out: the 7d median player sale, per unit, after the Merchant cut.
  typicalUnitCopper: number;
  netUnitCopper: number;
  marginUnitCopper: number;
  marginTotalCopper: number;
  roi: number;
  sales7d: number;
  soldQuantity7d: number;
  houseUnitAskCopper: number | null;
}

// Rank flip candidates: buy the cheapest listed stack now, resell at the
// typical (7d median) player price, net of the Merchant's cut. minSales
// filters out items whose median rests on too few trades to mean anything.
// The resale estimate is capped at the Merchant's own ask when the house
// stocks the item: nobody pays a player more than the infinite vendor supply
// charges. Sorted by whole-stack margin, ties by ROI.
export function rankFlips(overview: MarketOverviewRow[], minSales: number): MarketFlipRow[] {
  const out: MarketFlipRow[] = [];
  for (const row of overview) {
    const week = row.sales7d;
    if (!week || week.sales < minSales) continue;
    if (
      row.lowestAskTotalCopper === null ||
      row.lowestAskUnitCopper === null ||
      row.lowestAskQuantity === null
    )
      continue;
    let typical = week.medianUnitPriceCopper;
    if (row.houseUnitAskCopper !== null) typical = Math.min(typical, row.houseUnitAskCopper);
    const netUnit = typical * (1 - MARKET_CUT);
    const marginUnit = netUnit - row.lowestAskUnitCopper;
    const marginTotal = Math.floor(marginUnit * row.lowestAskQuantity);
    out.push({
      itemId: row.itemId,
      name: row.name,
      quality: row.quality,
      kind: row.kind,
      buyTotalCopper: row.lowestAskTotalCopper,
      buyQuantity: row.lowestAskQuantity,
      buyUnitCopper: row.lowestAskUnitCopper,
      typicalUnitCopper: typical,
      netUnitCopper: netUnit,
      marginUnitCopper: marginUnit,
      marginTotalCopper: marginTotal,
      roi: row.lowestAskUnitCopper > 0 ? marginUnit / row.lowestAskUnitCopper : 0,
      sales7d: week.sales,
      soldQuantity7d: week.quantity,
      houseUnitAskCopper: row.houseUnitAskCopper,
    });
  }
  out.sort((a, b) => b.marginTotalCopper - a.marginTotalCopper || b.roi - a.roi);
  return out;
}

export interface MarketMoverRow {
  itemId: string;
  name: string;
  quality: string;
  kind: string;
  currentMedianUnitCopper: number;
  previousMedianUnitCopper: number;
  changeUnitCopper: number;
  changePct: number;
  salesCurrent: number;
  salesPrevious: number;
}

// Compare two adjacent sale windows (current vs the one before it) and rank
// by relative median move. Both windows must clear minSales, or a single
// outlier trade would dominate the board.
export function buildMovers(
  current: MarketSaleStatsRow[],
  previous: MarketSaleStatsRow[],
  minSales: number,
): { risers: MarketMoverRow[]; fallers: MarketMoverRow[] } {
  const byItemPrev = new Map(previous.map((row) => [row.itemId, row]));
  const catalog = new Map(marketItemCatalog().map((item) => [item.itemId, item]));
  const rows: MarketMoverRow[] = [];
  for (const now of current) {
    const before = byItemPrev.get(now.itemId);
    if (!before || now.sales < minSales || before.sales < minSales) continue;
    if (before.medianUnitPriceCopper <= 0) continue;
    const item = catalog.get(now.itemId);
    const change = now.medianUnitPriceCopper - before.medianUnitPriceCopper;
    rows.push({
      itemId: now.itemId,
      name: item?.name ?? now.itemId,
      quality: item?.quality ?? 'common',
      kind: item?.kind ?? 'junk',
      currentMedianUnitCopper: now.medianUnitPriceCopper,
      previousMedianUnitCopper: before.medianUnitPriceCopper,
      changeUnitCopper: change,
      changePct: change / before.medianUnitPriceCopper,
      salesCurrent: now.sales,
      salesPrevious: before.sales,
    });
  }
  const risers = rows.filter((row) => row.changePct > 0).sort((a, b) => b.changePct - a.changePct);
  const fallers = rows.filter((row) => row.changePct < 0).sort((a, b) => a.changePct - b.changePct);
  return { risers, fallers };
}

// Test-only: drop the module-level caches so a suite that mutates ITEMS (or
// just wants isolation) rebuilds them.
export function resetMarketAnalyticsCachesForTests(): void {
  catalogCache = undefined;
  houseAskCache = undefined;
}
