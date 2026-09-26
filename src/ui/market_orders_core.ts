// The Wanted tab's pure view core: everything the World Market's buy-order
// painter (market_orders_panel.ts) decides, with no DOM in it. Rows are built
// off MarketInfo.orders plus a bag-count resolver the painter injects; the
// place form's stage is validated here; the item picker's catalog search is a
// pure walk over the marketable catalog with an injected name resolver, so a
// Vitest drives every branch with plain objects (the market_view precedent).

import { ITEMS } from '../sim/data';
import { MARKET_ORDER_MAX_UNITS } from '../sim/market_orders';
import { isMaterialItemId } from '../sim/material_ids';
import type { ItemDef } from '../sim/types';
import type { MarketInfo } from '../world_api';

export interface MarketOrderRow {
  id: number;
  item: ItemDef;
  buyerName: string;
  count: number;
  unitPrice: number;
  mine: boolean;
  /** Plain units the viewer holds in bags: what a Deliver could hand over. */
  have: number;
  /** Units one Deliver press would settle: bags-limited, never past the ask. */
  deliverable: number;
}

export interface MarketOrdersBody {
  rows: MarketOrderRow[];
  /** Materials with no listing at all (world_api MarketInfo.unlistedMaterials),
   *  resolved to defs; an id a content edit retired is dropped, not shown raw. */
  unlisted: ItemDef[];
  myOrderCount: number;
  maxOrders: number;
  cutPct: number;
}

/** Build the tab's rows. `have` resolves the viewer's plain bag count per item. */
export function buildMarketOrders(
  info: MarketInfo,
  have: (itemId: string) => number,
): MarketOrdersBody {
  const rows: MarketOrderRow[] = [];
  for (const o of info.orders) {
    const item = ITEMS[o.itemId];
    if (!item) continue;
    const held = o.mine ? 0 : have(o.itemId);
    rows.push({
      id: o.id,
      item,
      buyerName: o.buyerName,
      count: o.count,
      unitPrice: o.unitPrice,
      mine: o.mine,
      have: held,
      deliverable: Math.min(o.count, held),
    });
  }
  const unlisted: ItemDef[] = [];
  for (const id of info.unlistedMaterials) {
    const item = ITEMS[id];
    if (item) unlisted.push(item);
  }
  return {
    rows,
    unlisted,
    myOrderCount: info.myOrderCount,
    maxOrders: info.maxOrders,
    cutPct: info.cutPct,
  };
}

/** The place form's typed state. Coins are the Sell tab's three fields. */
export interface MarketOrderStage {
  itemId: string | null;
  count: number;
  unitPrice: number; // copper
}

export type MarketOrderStageProblem =
  | 'ok'
  | 'no-item'
  | 'bad-count'
  | 'bad-price'
  | 'cannot-afford'
  | 'at-cap';

/** Copper the Merchant will hold for this stage. */
export function orderStageTotal(stage: MarketOrderStage): number {
  return Math.max(0, stage.count) * Math.max(0, stage.unitPrice);
}

/**
 * Whether the stage can be sent, and if not, the one thing to say about it.
 * Mirrors the sim's own refusals (market_orders.ts place) so the button is
 * disabled for the same reasons the server would refuse, never a different set.
 */
export function orderStageProblem(
  stage: MarketOrderStage,
  copper: number,
  myOrderCount: number,
  maxOrders: number,
): MarketOrderStageProblem {
  if (!stage.itemId) return 'no-item';
  if (!Number.isInteger(stage.count) || stage.count < 1 || stage.count > MARKET_ORDER_MAX_UNITS)
    return 'bad-count';
  if (!Number.isInteger(stage.unitPrice) || stage.unitPrice < 1) return 'bad-price';
  if (myOrderCount >= maxOrders) return 'at-cap';
  if (orderStageTotal(stage) > copper) return 'cannot-afford';
  return 'ok';
}

/** A typed unit count, clamped into the sim's admitted band (the sweep rule). */
export function orderCountFromInput(raw: string): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MARKET_ORDER_MAX_UNITS, n);
}

/** An item a buy order may name: the same gate the Sell tab and the sim apply. */
export function orderableItem(item: ItemDef): boolean {
  return item.kind !== 'quest' && !item.noMarketList && !item.soulbound;
}

/** The def behind a staged id, or null when it is unknown or not orderable
 *  (a content edit since it was staged): the painter shows the empty pick. */
export function orderableItemById(
  itemId: string,
  catalog: Record<string, ItemDef> = ITEMS,
): ItemDef | null {
  const item = catalog[itemId];
  return item && orderableItem(item) ? item : null;
}

/**
 * The item picker's matches for a typed query: orderable catalog items whose
 * (localized) name contains the query, case-insensitive, materials first (the
 * board exists for gatherers), then by name. An empty query matches nothing:
 * the picker is a search box, not a catalog browser.
 */
export function orderableMatches(
  query: string,
  nameOf: (item: ItemDef) => string,
  limit = 8,
  catalog: Record<string, ItemDef> = ITEMS,
): ItemDef[] {
  const q = query.trim().toLocaleLowerCase();
  if (q === '') return [];
  const hits: { item: ItemDef; name: string; material: boolean }[] = [];
  for (const item of Object.values(catalog)) {
    if (!orderableItem(item)) continue;
    const name = nameOf(item);
    if (!name.toLocaleLowerCase().includes(q)) continue;
    hits.push({ item, name, material: isMaterialItemId(item.id) });
  }
  hits.sort(
    (a, b) =>
      Number(b.material) - Number(a.material) ||
      a.name.localeCompare(b.name) ||
      a.item.id.localeCompare(b.item.id),
  );
  return hits.slice(0, limit).map((h) => h.item);
}
