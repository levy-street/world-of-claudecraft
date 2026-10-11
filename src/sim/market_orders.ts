// World Market buy orders (the "Wanted" board): a player names an item, a unit
// count, and a price per unit, and escrows the gold at the Merchant. Listings
// already on the book at or below that price fill the order on the spot,
// cheapest per unit first (the Market Sweep walk with one extra predicate);
// whatever is left stays open until another player delivers plain stock into it
// from their bags or the buyer withdraws it. The board is what tells a gatherer
// WHAT the realm wants and at what price, which a listing-only market never
// says: an empty search result is not a demand signal.
//
// Split in two, the market_sweep precedent: the pure planner half (fill plans,
// sanitizers, the unlisted-material readout) takes plain objects so
// tests/market_orders_plan.test.ts pins it with no Sim, and the MarketOrderBook
// class holds the live board behind a narrow host seam the Market implements
// (its private settlement, escrow, and collection helpers), so the coordinator
// stays the single owner of every book mutation and rev bump.
//
// Deliberate rules, each pinned in tests/market_orders.test.ts:
//   - Orders hold PLAIN fungible stock only, the market_sweep eligibility: an
//     instanced or crafted-recipe row never fills an order (its units do not
//     merge into the buyer's plain stack), and a deliverer's escrow keeps every
//     provenance bucket exact through the buyer's collection (the marketList
//     doctrine, reused rather than reimplemented).
//   - Delivered goods land in the buyer's COLLECTION, never straight into bags:
//     the buyer is usually offline or away, and the collection already has the
//     capacity-gated pickup path. The deliverer's proceeds (less the Merchant's
//     cut) wait in their own collection exactly like a listing sale.
//   - Orders expire after MARKET_ORDER_DURATION (the listing rule, longer): the
//     unfilled escrow returns to the buyer's COLLECTION (they are usually away),
//     so the board is bounded in realm age rather than growing with every
//     character that ever posted and stopped playing. A cancel at the Merchant
//     returns the unfilled remainder to the purse at once.
//   - The Merchant's house stock never fills an order (it pays no one and never
//     depletes, so it is not a market), the same reason it is not swept.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random/Date.now.

import { bagPools, canGrantCopies } from './bags';
import { ITEMS } from './data';
import { formatMoney } from './format_money';
import type { MarketCollection, MarketListing } from './market';
import { recordSale } from './market_sale_log';
import { MARKET_SWEEP_MAX_UNITS, type SweepableListing } from './market_sweep';
import { MATERIAL_ITEM_IDS } from './material_ids';
import { cloneMaterialData } from './material_payload_identity';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { Entity, InvSlot, ItemDef } from './types';

/** Open orders one buyer may hold at once: a board-size bound, not a balance lever. */
export const MARKET_MAX_ORDERS = 6;
/** The most units one order may ask for; shares the sweep's fat-finger cap. */
export const MARKET_ORDER_MAX_UNITS = MARKET_SWEEP_MAX_UNITS;
/** Sim-seconds an unfilled order stays open before its escrow returns to the
 *  buyer's collection: a week, longer than a listing's two days because a
 *  standing bid is the demand signal the board exists to show. */
export const MARKET_ORDER_DURATION = 7 * 24 * 3600;
/** Most order rows shipped to one viewer per snapshot (the MARKET_WIRE_LIMIT idea). */
export const MARKET_ORDER_WIRE_LIMIT = 60;
/** Most unlisted-material ids shipped per snapshot. The registry is about a
 *  hundred ids, so this is a ceiling against catalog growth, not a page. */
export const MARKET_UNLISTED_WIRE_LIMIT = 120;
/** The market's notice color (the expired-listing line in market.ts). */
const MARKET_NOTICE_COLOR = '#caa472';

export interface MarketOrder {
  id: number;
  buyerKey: string; // stable buyer identity (character id string), the sellerKey twin
  buyerName: string;
  itemId: string;
  count: number; // units still wanted; the row leaves the board at 0
  unitPrice: number; // copper per unit; count * unitPrice is the escrow still held
  expiresAt: number; // sim time; the sweep refunds the escrow past it
}

/** The additive MarketSave shape: absent on every pre-order blob. */
export interface MarketOrderSaveRow {
  id: number;
  buyerKey: string;
  buyerName: string;
  itemId: string;
  count: number;
  unitPrice: number;
  /** Stored instead of an absolute time: sim.time resets to 0 on every boot
   *  (the MarketSave listing precedent). */
  secondsLeft?: number;
}

export interface MarketOrderFillPlan {
  /** Listing ids to buy, in buy order (cheapest per unit first). */
  listingIds: number[];
  units: number;
  total: number;
}

/** Copper still escrowed behind an order. */
export function orderEscrow(order: { count: number; unitPrice: number }): number {
  return order.count * order.unitPrice;
}

/**
 * The immediate-fill plan for a fresh order: walk the per-unit-sorted sweep
 * candidates of the item, skip the buyer's own rows, stop at the first row
 * priced above the bid per unit (the candidates are sorted, so nothing past it
 * can qualify), and skip any row bigger than what is still wanted (a later,
 * smaller row may still fit). Whole rows only, never more than `wanted`: an
 * order is an exact count the buyer escrowed for, unlike a sweep's overshoot.
 * Never mutates the input.
 */
export function planOrderFill(
  candidates: readonly SweepableListing[],
  wanted: number,
  unitPrice: number,
  isMine: (l: SweepableListing) => boolean,
): MarketOrderFillPlan {
  const listingIds: number[] = [];
  let units = 0;
  let total = 0;
  for (const l of candidates) {
    if (units >= wanted) break;
    // price/count <= unitPrice, in integer form (the sweep comparator's shape).
    if (l.price > unitPrice * l.count) break;
    if (isMine(l)) continue;
    if (l.count > wanted - units) continue;
    listingIds.push(l.id);
    units += l.count;
    total += l.price;
  }
  return { listingIds, units, total };
}

/** A wire or UI unit count, admitted only as a positive integer within the cap. */
export function sanitizeOrderCount(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  if (raw < 1 || raw > MARKET_ORDER_MAX_UNITS) return null;
  return raw;
}

/**
 * Every honest material (material_ids.ts) with no listing on the book at all,
 * house stock included: the "not on the market" readout, sorted by catalog
 * name so the strip reads the same for every viewer. A property of the BOOK
 * alone, so the board memoizes it per bookRev.
 */
export function unlistedMaterialIds(
  listings: readonly { itemId: string }[],
  materials: ReadonlySet<string> = MATERIAL_ITEM_IDS,
): string[] {
  const listed = new Set<string>();
  for (const l of listings) listed.add(l.itemId);
  const out: string[] = [];
  for (const id of materials) {
    const def = ITEMS[id];
    if (!def || listed.has(id)) continue;
    if (def.kind === 'quest' || def.noMarketList || def.soulbound) continue;
    out.push(id);
  }
  out.sort((a, b) => {
    const na = ITEMS[a]?.name ?? a;
    const nb = ITEMS[b]?.name ?? b;
    return na.localeCompare(nb) || a.localeCompare(b);
  });
  return out.slice(0, MARKET_UNLISTED_WIRE_LIMIT);
}

/** One wired order row (the MarketListingView twin). */
export interface MarketOrderView {
  id: number;
  buyerName: string;
  itemId: string;
  count: number;
  unitPrice: number;
  mine: boolean;
}

/**
 * The Market's private surface the board drives. Every member is a thin
 * closure over an existing Market helper, so the book's settlement, escrow,
 * collection, and rev-bump rules stay defined in exactly one place.
 */
export interface MarketOrderHost {
  readonly ctx: SimContext;
  nearMerchant(e: Entity): boolean;
  playerKey(meta: PlayerMeta): string;
  /** The MarketListing ownership rule (stable key or legacy name). */
  keyBelongsTo(key: string, meta: PlayerMeta): boolean;
  collectionFor(key: string): MarketCollection;
  metaByKey(key: string): PlayerMeta | null;
  /** Advance bookRev + browseRev (an order change is a browse-visible change). */
  bumpBook(): void;
  /** The item's per-unit-sorted, plain, non-house sweep candidates (memoized). */
  candidatesFor(itemId: string): readonly MarketListing[];
  /** Settle one listing into `meta`'s bags: coin out, goods in, seller paid.
   *  False when the row is no longer on the book (nothing changed hands). */
  settleListing(listing: MarketListing, def: ItemDef, meta: PlayerMeta): boolean;
  /** How many provenance buckets escrowing `want` plain units would produce. */
  previewPlainBucketCount(meta: PlayerMeta, itemId: string, want: number): number;
  /** Escrow `want` plain units out of `meta`'s bags into provenance buckets. */
  escrowPlainBuckets(meta: PlayerMeta, itemId: string, want: number): InvSlot[];
  cutPct(): number; // the Merchant's cut, as a fraction (MARKET_CUT)
  minPrice(): number;
  maxPrice(): number;
}

export class MarketOrderBook {
  orders: MarketOrder[] = [];
  private nextOrderId = 1;
  private unlistedCache: {
    rev: number;
    source: readonly MarketListing[];
    length: number;
    ids: string[];
  } | null = null;
  // The board in wire order (item name, best bid, id), memoized per book
  // revision the way market.ts memoizes sortedBook(): the ICU localeCompare
  // sort is viewer-independent, so per-viewer reads only partition it.
  private sortedCache: { rev: number; length: number; rows: MarketOrder[] } | null = null;

  constructor(private readonly host: MarketOrderHost) {}

  private orderBelongsTo(order: MarketOrder, meta: PlayerMeta): boolean {
    return this.host.keyBelongsTo(order.buyerKey, meta);
  }

  private countFor(meta: PlayerMeta): number {
    let n = 0;
    for (const o of this.orders) if (this.orderBelongsTo(o, meta)) n++;
    return n;
  }

  /**
   * Place an order. Refusals mirror marketList's (proximity, liveness, the
   * item's marketability, price band), plus the per-buyer cap and the escrow
   * affordability check on the WHOLE ask. Returns the listings the immediate
   * fill settled (empty on refusal), the marketSweep shape the server's sold-
   * volume observer reads.
   */
  place(itemId: string, count: number, unitPrice: number, pid?: number): MarketListing[] {
    const { ctx } = this.host;
    const r = ctx.resolve(pid);
    if (!r) return [];
    const { meta, e: p } = r;
    if (p.dead) return [];
    if (!this.host.nearMerchant(p)) {
      ctx.error(meta.entityId, 'You are too far from the Merchant.');
      return [];
    }
    const def = ITEMS[itemId];
    if (!def) return [];
    if (def.kind === 'quest') {
      ctx.error(meta.entityId, 'The Merchant will not broker quest items.');
      return [];
    }
    if (def.noMarketList || def.soulbound) {
      ctx.error(meta.entityId, 'That item cannot be listed on the World Market.');
      return [];
    }
    const want = sanitizeOrderCount(count);
    if (want === null) {
      ctx.error(meta.entityId, 'Name how many you want.');
      return [];
    }
    const bid = Math.floor(unitPrice);
    if (!Number.isFinite(bid) || bid < this.host.minPrice()) {
      ctx.error(meta.entityId, 'Name a price of at least 1 copper.');
      return [];
    }
    if (bid > this.host.maxPrice()) {
      ctx.error(meta.entityId, 'That price is beyond what the Merchant will broker.');
      return [];
    }
    if (this.countFor(meta) >= MARKET_MAX_ORDERS) {
      ctx.error(meta.entityId, `You may keep at most ${MARKET_MAX_ORDERS} orders open at once.`);
      return [];
    }
    if (meta.copper < want * bid) {
      ctx.error(meta.entityId, 'You cannot afford that.');
      return [];
    }
    // Immediate fill against the live book. Plan on the memoized candidates,
    // then settle by id (each settlement splices the book and invalidates the
    // memo, so the plan is captured before the first one). Each row is checked
    // against the bags as they stand after the previous settlement; rather
    // than refuse the whole order over bag space, the fill takes rows while
    // they fit and the rest of the ask simply stays open as escrow.
    const key = this.host.playerKey(meta);
    const plan = planOrderFill(
      this.host.candidatesFor(itemId),
      want,
      bid,
      (l) => l.sellerKey === key || l.sellerKey === meta.name,
    );
    // Rows are captured BEFORE the first settlement: each one splices the book
    // and invalidates the candidate memo, but the row objects stay valid.
    const byId = new Map<number, MarketListing>();
    for (const l of this.host.candidatesFor(itemId)) byId.set(l.id, l);
    const settled: MarketListing[] = [];
    let filled = 0;
    let spent = 0;
    for (const id of plan.listingIds) {
      const listing = byId.get(id);
      if (!listing) continue;
      if (!canGrantCopies(meta.inventory, bagPools(meta.bags), itemId, listing.count)) break;
      if (!this.host.settleListing(listing, def, meta)) continue;
      settled.push(listing);
      filled += listing.count;
      spent += listing.price;
    }
    if (filled > 0) {
      ctx.emit({
        type: 'loot',
        // biome-ignore lint/style/useTemplate: keep this scanner-friendly shape for i18n extraction.
        text: `Bought ${def.name}${filled > 1 ? ' x' + filled : ''} for ${formatMoney(spent)}.`,
        pid: meta.entityId,
      });
    }
    const remaining = want - filled;
    if (remaining > 0) {
      meta.copper -= remaining * bid;
      this.orders.push({
        id: this.nextOrderId++,
        buyerKey: key,
        buyerName: meta.name,
        itemId,
        count: remaining,
        unitPrice: bid,
        expiresAt: ctx.time + MARKET_ORDER_DURATION,
      });
      // A 'log' line (the expiry-notice color), not 'loot': nothing landed in
      // the bags, and the system-text matcher (src/ui/system_text_i18n.ts) is
      // where every order notice is re-localized.
      ctx.emit({
        type: 'log',
        text: `Placed an order for ${def.name} x${remaining} at ${formatMoney(bid)} each.`,
        color: MARKET_NOTICE_COLOR,
        pid: meta.entityId,
      });
    }
    // Settlements bumped the book already; the new row (or the absence of one)
    // still owes one bump so every viewer's board repaints.
    this.host.bumpBook();
    return settled;
  }

  /**
   * Deliver `count` plain units from the caller's bags into someone else's
   * order. Goods go to the buyer's collection, proceeds (less the cut) to the
   * deliverer's, and the order shrinks or leaves the board. Returns the units
   * and gross copper settled (0 on refusal), for the sold-volume observer.
   */
  fill(orderId: number, count: number, pid?: number): { units: number; copper: number } {
    const none = { units: 0, copper: 0 };
    const { ctx } = this.host;
    const r = ctx.resolve(pid);
    if (!r) return none;
    const { meta, e: p } = r;
    if (p.dead) return none;
    if (!this.host.nearMerchant(p)) {
      ctx.error(meta.entityId, 'You must bring your goods to the Merchant.');
      return none;
    }
    const order = this.orders.find((o) => o.id === orderId);
    if (!order) {
      ctx.error(meta.entityId, 'That order is no longer open.');
      return none;
    }
    if (this.orderBelongsTo(order, meta)) {
      ctx.error(meta.entityId, 'That is your own order - cancel it to withdraw it.');
      return none;
    }
    const def = ITEMS[order.itemId];
    if (!def) {
      ctx.error(meta.entityId, 'That order is no longer open.');
      return none;
    }
    if (!Number.isFinite(count)) {
      ctx.error(meta.entityId, 'Name how many you wish to sell.');
      return none;
    }
    const units = Math.min(order.count, Math.max(1, Math.floor(count)));
    if (ctx.countFungibleItem(order.itemId, meta.entityId) < units) {
      ctx.error(meta.entityId, 'You do not have that many to sell.');
      return none;
    }
    // The bucket preview is a legality question for a LISTING (the per-seller
    // cap); an order fill has no such cap, but the walk also proves the plain
    // stock is actually removable before anything leaves the bags.
    if (this.host.previewPlainBucketCount(meta, order.itemId, units) < 1) {
      ctx.error(meta.entityId, 'You do not have that many to sell.');
      return none;
    }
    const buckets = this.host.escrowPlainBuckets(meta, order.itemId, units);
    const buyerCol = this.host.collectionFor(order.buyerKey);
    for (const b of buckets) {
      buyerCol.items.push({
        itemId: b.itemId,
        count: b.count,
        ...(b.craftedRecipeId === undefined ? {} : { craftedRecipeId: b.craftedRecipeId }),
        ...(b.materialSources === undefined
          ? {}
          : { materialSources: cloneMaterialData(b.materialSources) }),
      });
    }
    const gross = units * order.unitPrice;
    const proceeds = Math.max(0, Math.floor(gross * (1 - this.host.cutPct())));
    const col = this.host.collectionFor(this.host.playerKey(meta));
    col.copper += proceeds;
    recordSale(col.sales, {
      itemId: order.itemId,
      count: units,
      price: gross,
      proceeds,
      buyerName: order.buyerName,
    });
    order.count -= units;
    if (order.count <= 0) this.orders.splice(this.orders.indexOf(order), 1);
    this.host.bumpBook();
    ctx.emit({
      type: 'log',
      text: `Delivered ${def.name} x${units} to ${order.buyerName} for ${formatMoney(gross)} - collect ${formatMoney(proceeds)} from the Merchant.`,
      color: MARKET_NOTICE_COLOR,
      pid: meta.entityId,
    });
    const buyerMeta = this.host.metaByKey(order.buyerKey);
    if (buyerMeta) {
      ctx.emit({
        type: 'log',
        text: `${meta.name} delivered ${def.name} x${units} to your order - collect it from the Merchant.`,
        color: MARKET_NOTICE_COLOR,
        pid: buyerMeta.entityId,
      });
    }
    return { units, copper: gross };
  }

  /** Withdraw your own order: the unfilled escrow returns to the purse at once. */
  cancel(orderId: number, pid?: number): void {
    const { ctx } = this.host;
    const r = ctx.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    if (!this.host.nearMerchant(p)) {
      ctx.error(meta.entityId, 'You are too far from the Merchant.');
      return;
    }
    const idx = this.orders.findIndex((o) => o.id === orderId);
    if (idx < 0) return;
    const order = this.orders[idx];
    if (!this.orderBelongsTo(order, meta)) {
      ctx.error(meta.entityId, 'That is not your order.');
      return;
    }
    const refund = orderEscrow(order);
    this.orders.splice(idx, 1);
    meta.copper += refund;
    this.host.bumpBook();
    const def = ITEMS[order.itemId];
    ctx.emit({
      type: 'log',
      text: `Withdrew your order for ${def?.name ?? order.itemId}; ${formatMoney(refund)} returned.`,
      color: MARKET_NOTICE_COLOR,
      pid: meta.entityId,
    });
  }

  /** The viewer's own rows first, then everyone else's, by item name then bid
   *  descending (the best offer for a gatherer at the top), capped for the wire. */
  viewsFor(meta: PlayerMeta, bookRev: number): MarketOrderView[] {
    const rows = this.sortedRows(bookRev);
    // One partition pass, the viewer's key resolved once: own rows first, then
    // everyone else's, both in the shared wire order, capped for the wire.
    const key = this.host.playerKey(meta);
    const owns = (o: MarketOrder) => o.buyerKey === key || o.buyerKey === meta.name;
    const mine: MarketOrderView[] = [];
    const others: MarketOrderView[] = [];
    for (const o of rows) {
      const isMine = owns(o);
      if (!isMine && mine.length + others.length >= MARKET_ORDER_WIRE_LIMIT) continue;
      (isMine ? mine : others).push({
        id: o.id,
        buyerName: isMine ? meta.name : o.buyerName,
        itemId: o.itemId,
        count: o.count,
        unitPrice: o.unitPrice,
        mine: isMine,
      });
    }
    return mine.concat(others).slice(0, MARKET_ORDER_WIRE_LIMIT);
  }

  /** The whole board in wire order, viewer-independent, memoized per book
   *  revision (plus a length guard for a row pushed without a bump, the
   *  sortedBook precedent). Display ordering only: localeCompare is host-ICU
   *  dependent and never feeds sim state. */
  private sortedRows(bookRev: number): readonly MarketOrder[] {
    const c = this.sortedCache;
    if (c && c.rev === bookRev && c.length === this.orders.length) return c.rows;
    const name = (id: string) => ITEMS[id]?.name ?? id;
    const rows = [...this.orders].sort(
      (a, b) =>
        name(a.itemId).localeCompare(name(b.itemId)) || b.unitPrice - a.unitPrice || a.id - b.id,
    );
    this.sortedCache = { rev: bookRev, length: this.orders.length, rows };
    return rows;
  }

  /** Once a second (the listing sweep's cadence): refund every expired order's
   *  escrow into the buyer's collection and drop the row. Returns whether the
   *  board changed (the caller bumps). */
  expire(now: number): boolean {
    let changed = false;
    for (let i = this.orders.length - 1; i >= 0; i--) {
      const o = this.orders[i];
      if (now < o.expiresAt) continue;
      this.orders.splice(i, 1);
      changed = true;
      const refund = orderEscrow(o);
      this.host.collectionFor(o.buyerKey).copper += refund;
      const buyerMeta = this.host.metaByKey(o.buyerKey);
      if (buyerMeta) {
        this.host.ctx.emit({
          type: 'log',
          text: `Your order for ${ITEMS[o.itemId]?.name ?? o.itemId} expired; ${formatMoney(refund)} waits at the Merchant.`,
          color: MARKET_NOTICE_COLOR,
          pid: buyerMeta.entityId,
        });
      }
    }
    return changed;
  }

  countForMeta(meta: PlayerMeta): number {
    return this.countFor(meta);
  }

  /** The unlisted-material readout, memoized per book revision. */
  unlistedFor(listings: readonly MarketListing[], bookRev: number): string[] {
    const c = this.unlistedCache;
    if (c && c.rev === bookRev && c.source === listings && c.length === listings.length)
      return c.ids;
    const ids = unlistedMaterialIds(listings);
    this.unlistedCache = { rev: bookRev, source: listings, length: listings.length, ids };
    return ids;
  }

  /** A rename follows the buyer through the board (the rekeyMarketSeller twin). */
  rekey(key: string, oldName: string, newName: string): boolean {
    let changed = false;
    for (const o of this.orders) {
      if (o.buyerKey === key || o.buyerKey === oldName || o.buyerKey === newName) {
        if (o.buyerKey !== key || o.buyerName !== newName) changed = true;
        o.buyerKey = key;
        o.buyerName = newName;
      }
    }
    return changed;
  }

  /** Character deletion drops the buyer's orders (their own escrow, nobody else's). */
  purge(key: string, name: string): boolean {
    const owns = (k: string): boolean => k === key || (name !== '' && k === name);
    const before = this.orders.length;
    this.orders = this.orders.filter((o) => !owns(o.buyerKey));
    return this.orders.length !== before;
  }

  /** The additive save keys. An untouched board (no order ever placed) writes
   *  none of them, so pre-order blobs round-trip byte-identical; once the
   *  counter has moved it is always written, even with the board empty, so a
   *  restart never reissues an id a client may still hold. */
  serialize(now: number): { orders?: MarketOrderSaveRow[]; nextOrderId?: number } {
    if (this.orders.length === 0 && this.nextOrderId === 1) return {};
    return {
      ...(this.orders.length === 0
        ? {}
        : {
            orders: this.orders.map((o) => ({
              id: o.id,
              buyerKey: o.buyerKey,
              buyerName: o.buyerName,
              itemId: o.itemId,
              count: o.count,
              unitPrice: o.unitPrice,
              secondsLeft: Math.max(0, Math.round(o.expiresAt - now)),
            })),
          }),
      nextOrderId: this.nextOrderId,
    };
  }

  /** Untrusted blob data, the loadMarket doctrine: a row with no item id, no
   *  buyer key (nobody could ever withdraw it, anybody could deliver into it),
   *  or a non-positive count or price is dropped; the price and count are
   *  clamped into the bands place() admits, so no hand-edited save can mint
   *  gold through a cancel; an unknown item id is KEPT dormant so the buyer
   *  can still withdraw its gold. */
  load(
    rows: readonly Partial<MarketOrderSaveRow>[] | undefined,
    nextOrderId: unknown,
    now: number,
  ): void {
    this.orders = [];
    this.sortedCache = null;
    let maxId = 0;
    for (const raw of rows ?? []) {
      if (!raw || typeof raw.itemId !== 'string') continue;
      const buyerKey = typeof raw.buyerKey === 'string' ? raw.buyerKey : '';
      if (buyerKey === '') continue;
      const count = Math.min(MARKET_ORDER_MAX_UNITS, Math.floor(Number(raw.count)));
      const unitPrice = Math.min(this.host.maxPrice(), Math.floor(Number(raw.unitPrice)));
      if (!(count >= 1) || !(unitPrice >= this.host.minPrice())) continue;
      const id = Number.isInteger(raw.id) && (raw.id as number) >= 1 ? (raw.id as number) : 0;
      if (id === 0 || this.orders.some((o) => o.id === id)) continue;
      if (!ITEMS[raw.itemId])
        console.warn(`market: keeping order with unknown item id ${raw.itemId}`);
      maxId = Math.max(maxId, id);
      const secondsLeft = Number(raw.secondsLeft);
      this.orders.push({
        id,
        buyerKey,
        buyerName: String(raw.buyerName ?? buyerKey),
        itemId: raw.itemId,
        count,
        unitPrice,
        expiresAt:
          now + (Number.isFinite(secondsLeft) ? Math.max(0, secondsLeft) : MARKET_ORDER_DURATION),
      });
    }
    const saved =
      typeof nextOrderId === 'number' && Number.isInteger(nextOrderId) ? nextOrderId : 1;
    this.nextOrderId = Math.max(1, saved, maxId + 1);
  }
}
