// The World Market: the Merchant's auction house. Extracted from sim.ts (session
// L2) as a pure MOVE behind SimContext. This module OWNS the shared listing book,
// the per-seller collections, the listing-id counter, and the Merchant entity id;
// the inventory hub (addItem/removeItem/countItem) STAYS on Sim and is consumed
// through SimContext. Mirrors the A1 PartyMachine / T1 Targeting pattern (state
// moved INTO the class); Sim keeps thin same-named delegates so the server, the
// IWorld surface, and the /listings readout call sites resolve unchanged.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random/Date.now
// (enforced by tests/architecture.test.ts). The market draws NO rng.

import { ITEMS } from './data';
import { formatMoney } from './format_money';
import {
  MARKET_PAGE_SIZE,
  type MarketQuery,
  marketItemMatches,
  sanitizeMarketQuery,
} from './market_query';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { normalizeWocAmount } from './social/trade';
import { dist2d, type Entity, INTERACT_RANGE, type InvSlot, type ItemDef } from './types';

const MARKET_RANGE = INTERACT_RANGE + 2; // you must stand at the Merchant to deal
// the /listings readout (still on Sim) reports the seller's count against this cap,
// so it is the one const exported back to sim.ts; the rest are market-internal.
export const MARKET_MAX_LISTINGS = 12; // active player listings per seller
const MARKET_MIN_PRICE = 1; // copper
const MARKET_MAX_PRICE = 5_000_000; // 500g ceiling — guards against overflow / fat-finger
const MARKET_CUT = 0.05; // the Merchant's cut on a completed sale (a gold sink)
const MARKET_LISTING_DURATION = 48 * 3600; // sim-seconds an unsold listing lingers before returning
const MARKET_WIRE_LIMIT = 120; // most listings shipped to one client at a time

// Player-selectable listing durations, in hours. The default stays the legacy
// 48h tier (MARKET_LISTING_DURATION above is that tier in seconds). Exported for
// the sell-form UI so the tier list can never drift from the sim's validation.
export const MARKET_DURATIONS_HOURS = [12, 24, 48] as const;
export type MarketDurationHours = (typeof MARKET_DURATIONS_HOURS)[number];
const MARKET_DEFAULT_DURATION_HOURS: MarketDurationHours = 48;
// Listing deposit (a gold sink + spam brake): a per-unit stake of the item's
// vendor value scaled by the duration tier, charged at list time. Refunded per
// unit as the goods actually sell; forfeited for whatever expires or is
// cancelled. Both exported for the sell-form deposit preview.
export const MARKET_DEPOSIT_RATE = 0.15;
export const MARKET_DEPOSIT_TIER_MULT: Record<MarketDurationHours, number> = {
  12: 1,
  24: 2,
  48: 4,
};

// The per-unit deposit a listing of `def` at `durationHours` stakes. Integer
// copper: 0 whenever the item has no vendor value (nothing to stake against).
export function marketDepositPerUnit(
  def: ItemDef | undefined,
  durationHours: MarketDurationHours,
): number {
  const sellValue = def?.sellValue ?? 0;
  if (!(sellValue > 0)) return 0;
  return Math.floor(sellValue * MARKET_DEPOSIT_RATE) * MARKET_DEPOSIT_TIER_MULT[durationHours];
}

// The lowest amount marketBid accepts on an auction lot: the starting bid while
// the lot is unclaimed, else the standing bid plus a 5% raise (never less than
// 1 copper). Integer copper. Exported for the bid-form UI.
export function marketMinNextBid(l: Pick<MarketListing, 'startingBid' | 'bid'>): number {
  const open = l.startingBid ?? 1;
  if (!l.bid) return open;
  return Math.max(open, l.bid.amount + Math.max(1, Math.floor(l.bid.amount * 0.05)));
}

// Listing denominations. Copper is the classic path (everything: fixed,
// partial buys, auctions). Claudium is fixed-price per-unit, settled
// buyer -> seller through the economy service by the SERVER's market
// settlement orchestrator. WOC is fixed-price WHOLE-LOT, paid wallet to
// wallet and verified on-chain by the server; the sim never does WOC
// arithmetic (amounts stay opaque normalized decimal strings).
export type MarketDenom = 'copper' | 'claudium' | 'woc';
// Per-unit Claudium ask ceiling (whole Claudium). No in-repo bound exists to
// reuse (the trade module clamps pledges to the cached balance instead), so
// the market pins its own: 1e12 keeps even a full stack's total far inside
// Number.MAX_SAFE_INTEGER.
export const MARKET_MAX_CLAUDIUM_PRICE = 1e12;

// Optional marketList parameters: the duration tier (default 48h), for an
// auction lot the opening ask + optional instant-buy price, and the listing
// denomination (default copper) with the WOC whole-lot ask when denom==='woc'.
export interface MarketListOptions {
  durationHours?: number;
  auction?: { startingBid: number; buyoutPrice?: number };
  denom?: MarketDenom;
  priceWoc?: string;
}

// An external-denomination purchase awaiting payment. While set the listing is
// LOCKED (no buy/bid/cancel; the expiry sweep skips it); only the server's
// orchestrator resolves it via marketPendingComplete/marketPendingFail.
// `startedAt` is sim.time at purchase start (persisted as sinceSeconds, the
// secondsLeft idiom). The reference / wallet pubkeys / account ids are attached
// by the SERVER (marketPendingAttach) before any money moves, so a restart can
// re-verify the $WOC payment or replay the idempotent Claudium transfer without
// any live session or surviving wallet_links row (the trade R1c lesson). The
// sim stores them as opaque host facts and never interprets them.
export interface MarketPendingState {
  buyerKey: string;
  buyerName: string;
  quantity: number;
  startedAt: number;
  purchaseSeq: number;
  reference?: string;
  buyerWallet?: string;
  sellerWallet?: string;
  buyerAccountId?: number;
  sellerAccountId?: number;
}

// Server-attached settlement identity for a pending purchase (see
// MarketPendingState above).
export interface MarketPendingAttachDetails {
  reference?: string;
  buyerWallet?: string;
  sellerWallet?: string;
  buyerAccountId?: number;
  sellerAccountId?: number;
}

// The orchestrator-facing read of one pending external purchase: everything the
// server needs to settle it live or recover it at boot, resolved off the
// listing + its pending state. costWoc stays an opaque decimal string.
export interface MarketPendingRecord {
  listingId: number;
  itemId: string;
  denom: 'claudium' | 'woc';
  quantity: number;
  costClaudium?: number;
  costWoc?: string;
  buyerKey: string;
  buyerName: string;
  sellerKey: string;
  sellerName: string;
  purchaseSeq: number;
  reference?: string;
  buyerWallet?: string;
  sellerWallet?: string;
  buyerAccountId?: number;
  sellerAccountId?: number;
}

export interface MarketListing {
  id: number;
  sellerKey: string; // stable seller identity (character id string); '' for house stock
  sellerName: string; // display name
  itemId: string;
  count: number;
  price: number; // total copper buyout for the whole stack (auction lots: the starting bid)
  // 'fixed' is a priced listing (the pre-auction shape); 'auction' is a whole-lot
  // bid sale settled by the expiry sweep (or bought out early via buyoutPrice).
  kind: 'fixed' | 'auction';
  // Per-unit ask of a fixed listing; `price` stays the running whole-stack total.
  // Absent on a legacy persisted row, which stays buyable only in full at `price`.
  pricePerUnit?: number;
  durationSeconds: number; // the tier chosen at list time (house stock: 0, no expiry)
  depositPerUnit: number; // deposit staked per unit at list time (legacy/house rows: 0)
  // The standing high bid: the bidder's copper is escrowed here (already deducted
  // from their purse) until they are outbid (refunded to their collection box) or
  // the lot settles. Auction lots only.
  bid?: { amount: number; bidderKey: string; bidderName: string };
  startingBid?: number; // auction only: the opening ask
  buyoutPrice?: number; // auction only: optional instant whole-lot price
  expiresAt: number; // sim.time seconds; Infinity for the Merchant's own stock
  house: boolean; // the Merchant's standing stock: never expires, never depletes, pays no one
  // Listing denomination (default 'copper'; a pre-denomination blob loads as
  // copper). Claudium rows keep pricePerUnit in whole Claudium (price = the
  // running stack total); WOC rows carry priceWoc instead (whole-lot ask as an
  // opaque normalized decimal string) with pricePerUnit undefined and price 0.
  denom: MarketDenom;
  priceWoc?: string;
  // External purchase awaiting payment: the lock + settlement identity.
  pending?: MarketPendingState;
}

// Gold + items awaiting pickup at the Merchant (sale proceeds, expired
// listings), keyed by sellerKey so an offline seller can collect later.
export interface MarketCollection {
  copper: number;
  items: InvSlot[];
}

// Persistable market state. `secondsLeft` is stored instead of an absolute
// expiry because sim.time resets to 0 each server boot — on load it becomes
// `this.time + secondsLeft`, so a restart never silently expires everything.
export interface MarketSave {
  listings: {
    id: number;
    sellerKey: string;
    sellerName: string;
    itemId: string;
    count: number;
    price: number;
    secondsLeft: number;
    // Auction-house fields, all optional so a pre-auction blob loads as legacy
    // 'fixed' whole-lot rows (loadMarket coerces each with an explicit default).
    kind?: 'fixed' | 'auction';
    pricePerUnit?: number;
    durationSeconds?: number;
    depositPerUnit?: number;
    bid?: { amount: number; bidderKey: string; bidderName: string };
    startingBid?: number;
    buyoutPrice?: number;
    // Multi-currency fields, optional so a pre-denomination blob loads as
    // copper rows. `pending.sinceSeconds` is seconds ALREADY ELAPSED at save
    // time (the inverse of secondsLeft: sim.time resets each boot, so on load
    // startedAt becomes time - sinceSeconds).
    denom?: MarketDenom;
    priceWoc?: string;
    pending?: {
      buyerKey: string;
      buyerName: string;
      quantity: number;
      sinceSeconds: number;
      purchaseSeq: number;
      reference?: string;
      buyerWallet?: string;
      sellerWallet?: string;
      buyerAccountId?: number;
      sellerAccountId?: number;
    };
  }[];
  collections: { key: string; copper: number; items: InvSlot[] }[];
  nextListingId: number;
  // Monotonic external-purchase counter (the Claudium dedupe key suffix); like
  // nextListingId it must survive a restart so a replayed dedupe key can never
  // collide with a fresh purchase.
  nextPurchaseSeq?: number;
}

export class Market {
  // the World Market: one shared listing book, per-seller collections keyed by
  // stable character identity, and the Merchant entity these are anchored to.
  // `marketListings` is read through Sim's public `marketListings` getter (the
  // /listings readout + tests); the rest are market-internal.
  marketListings: MarketListing[] = [];
  private marketCollections = new Map<string, MarketCollection>();
  private nextListingId = 1;
  // External-purchase sequence (Claudium dedupe key suffix). Monotonic across
  // save/load like nextListingId; never reused even after a failed purchase.
  private nextPurchaseSeq = 1;
  // Entity ids of every NPC with `market: true`, assigned by the Sim ctor during NPC
  // placement (the NPC loop stays on Sim). The World Market is a single shared book;
  // any of these merchants is a valid place to stand and deal, so a player can use the
  // auction house at whichever auctioneer is closest.
  merchantIds: number[] = [];

  constructor(private readonly ctx: SimContext) {}

  // Public ctor-seed entry: the Sim ctor calls this right after the NPC loop sets
  // `merchantId`, replacing the inline `this.seedHouseListings()`.
  seed(): void {
    this.seedHouseListings();
  }

  // Public tick entry: the Sim tick calls this in the end-of-tick market phase,
  // replacing the inline `this.updateMarket()` (same phase, same call position).
  update(): void {
    this.updateMarket();
  }

  private nearMerchant(e: Entity): boolean {
    for (const id of this.merchantIds) {
      const m = this.ctx.entities.get(id);
      if (m && m.kind === 'npc' && dist2d(e.pos, m.pos) <= MARKET_RANGE) return true;
    }
    return false;
  }

  private marketSellerKey(meta: PlayerMeta): string {
    return String(meta.characterId ?? meta.entityId);
  }

  marketListingBelongsTo(listing: MarketListing, meta: PlayerMeta): boolean {
    if (listing.house) return false;
    return listing.sellerKey === this.marketSellerKey(meta) || listing.sellerKey === meta.name;
  }

  private metaByMarketSellerKey(key: string): PlayerMeta | null {
    if (!key) return null;
    for (const m of this.ctx.players.values()) {
      if (this.marketSellerKey(m) === key || m.name === key) return m;
    }
    return null;
  }

  private collectionFor(key: string): MarketCollection {
    let c = this.marketCollections.get(key);
    if (!c) {
      c = { copper: 0, items: [] };
      this.marketCollections.set(key, c);
    }
    return c;
  }

  private mergeMarketCollections(fromKey: string, toKey: string): boolean {
    if (!fromKey || fromKey === toKey) return false;
    const from = this.marketCollections.get(fromKey);
    if (!from) return false;
    const to = this.collectionFor(toKey);
    to.copper += from.copper;
    to.items.push(...from.items.map((s) => ({ ...s })));
    this.marketCollections.delete(fromKey);
    return true;
  }

  private collectionForSeller(meta: PlayerMeta): MarketCollection | undefined {
    const key = this.marketSellerKey(meta);
    this.mergeMarketCollections(meta.name, key);
    return this.marketCollections.get(key);
  }

  rekeyMarketSeller(characterId: number, oldName: string, newName: string): boolean {
    if (!Number.isFinite(characterId)) return false;
    const key = String(characterId);
    let changed = this.mergeMarketCollections(oldName, key);
    changed = this.mergeMarketCollections(newName, key) || changed;
    for (const listing of this.marketListings) {
      if (listing.house) continue;
      if (
        listing.sellerKey === key ||
        listing.sellerKey === oldName ||
        listing.sellerKey === newName
      ) {
        if (listing.sellerKey !== key || listing.sellerName !== newName) changed = true;
        listing.sellerKey = key;
        listing.sellerName = newName;
      }
    }
    return changed;
  }

  // The Merchant always keeps a little stock so the market is never empty —
  // standing consignments that never expire, never deplete, and pay no one.
  private seedHouseListings(): void {
    // pricePerUnit is stated explicitly per row (price stays the whole-stack
    // total, so every effective price is unchanged from the pre-auction seed).
    const stock: { itemId: string; count: number; price: number; pricePerUnit: number }[] = [
      { itemId: 'roasted_boar', count: 5, price: 700, pricePerUnit: 140 },
      { itemId: 'spring_water', count: 5, price: 160, pricePerUnit: 32 },
      { itemId: 'oiled_boots', count: 1, price: 1900, pricePerUnit: 1900 },
      { itemId: 'quilted_trousers', count: 1, price: 2400, pricePerUnit: 2400 },
      { itemId: 'greyjaw_pelt_cloak', count: 1, price: 2900, pricePerUnit: 2900 },
      // Quartermaster's Consignment: a standing line of practical travel gear.
      { itemId: 'roadwardens_helm', count: 1, price: 2200, pricePerUnit: 2200 },
      { itemId: 'wayfarers_hood', count: 1, price: 2000, pricePerUnit: 2000 },
      { itemId: 'acolytes_circlet', count: 1, price: 2000, pricePerUnit: 2000 },
      { itemId: 'reinforced_pauldrons', count: 1, price: 2400, pricePerUnit: 2400 },
      { itemId: 'embroidered_mantle', count: 1, price: 1900, pricePerUnit: 1900 },
      { itemId: 'sturdy_belt', count: 1, price: 1700, pricePerUnit: 1700 },
      { itemId: 'silk_sash', count: 1, price: 1700, pricePerUnit: 1700 },
      { itemId: 'roughspun_gloves', count: 1, price: 1500, pricePerUnit: 1500 },
      // Crossroads Outfitters: eight pieces kept in standing stock
      { itemId: 'tradesman_hatchet', count: 1, price: 2300, pricePerUnit: 2300 },
      { itemId: 'drovers_staff', count: 1, price: 2500, pricePerUnit: 2500 },
      { itemId: 'caravan_warden_dirk', count: 1, price: 2400, pricePerUnit: 2400 },
      { itemId: 'outrider_brigandine', count: 1, price: 2600, pricePerUnit: 2600 },
      { itemId: 'caravan_quilted_vest', count: 1, price: 1800, pricePerUnit: 1800 },
      { itemId: 'outrider_legguards', count: 1, price: 2100, pricePerUnit: 2100 },
      { itemId: 'pilgrims_leggings', count: 1, price: 1700, pricePerUnit: 1700 },
      { itemId: 'outrider_sabatons', count: 1, price: 1900, pricePerUnit: 1900 },
    ];
    for (const s of stock) {
      if (!ITEMS[s.itemId]) continue;
      this.marketListings.push({
        id: this.nextListingId++,
        sellerKey: '',
        sellerName: 'The Merchant',
        itemId: s.itemId,
        count: s.count,
        price: s.price,
        kind: 'fixed',
        pricePerUnit: s.pricePerUnit,
        durationSeconds: 0, // house stock never expires (expiresAt Infinity below)
        depositPerUnit: 0,
        expiresAt: Infinity,
        house: true,
        denom: 'copper',
      });
    }
  }

  // List a stack from your bags for sale. The goods are escrowed (pulled from
  // your bags immediately) and held by the Merchant until bought or reclaimed.
  // Set the player's session-only World Market browse query (search + type/subtype/
  // rarity filters + page). Purely a display/query narrowing (no gameplay effect), so
  // it needs no proximity or liveness gate; the next marketInfoFor snapshot reflects it.
  marketSearch(query: MarketQuery, pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    r.meta.marketQuery = sanitizeMarketQuery(query);
  }

  marketList(
    itemId: string,
    count: number,
    pricePerUnit: number,
    pid?: number,
    opts?: MarketListOptions,
  ): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    if (p.dead) return;
    if (!this.nearMerchant(p)) {
      this.ctx.error(meta.entityId, 'You must bring your goods to the Merchant.');
      return;
    }
    const def = ITEMS[itemId];
    if (!def) return;
    if (def.kind === 'quest') {
      this.ctx.error(meta.entityId, 'The Merchant will not broker quest items.');
      return;
    }
    if (def.noMarketList || def.soulbound) {
      this.ctx.error(meta.entityId, 'That item cannot be listed on the World Market.');
      return;
    }
    if (!Number.isFinite(count)) {
      this.ctx.error(meta.entityId, 'Name how many you wish to sell.');
      return;
    }
    const want = Math.max(1, Math.floor(count));
    // Per-instance copies (#1165: signer/charges/rolled/boundTo) are inert on the
    // World Market for now: count and escrow only the fungible stock, so a signed
    // or bound item is never swept into a listing. (#1146 wires real handling later.)
    if (this.ctx.countFungibleItem(itemId, meta.entityId) < want) {
      this.ctx.error(meta.entityId, 'You do not have that many to sell.');
      return;
    }
    const auction = opts?.auction;
    const denom: MarketDenom = opts?.denom ?? 'copper';
    // Bids are copper-only, permanently: non-custodial outbid refunds are
    // impossible without an on-chain escrow, so external-denomination lots are
    // fixed-price (a WOC/Claudium buyout IS the crypto auction).
    if (auction && denom !== 'copper') {
      this.ctx.error(meta.entityId, 'Bids take gold only.');
      return;
    }
    // External denominations exist only where the host's rails say so (the
    // cfg.tradeRails view; offline hosts read all-unavailable, so an offline
    // world can never mint an external listing).
    if (denom === 'claudium' && !this.ctx.tradeRails(meta.entityId).claudium.available) {
      this.ctx.error(meta.entityId, 'Claudium listings are not available.');
      return;
    }
    if (denom === 'woc') {
      const rails = this.ctx.tradeRails(meta.entityId);
      if (!rails.woc.available || !rails.woc.linked) {
        this.ctx.error(meta.entityId, 'Link a wallet to list for WOC.');
        return;
      }
    }
    // Fixed listings: the wire price is the PER-UNIT ask; the pre-auction bounds
    // keep guarding the whole-stack TOTAL (unit * count), so MARKET_MIN_PRICE and
    // MARKET_MAX_PRICE keep their meaning. Auction lots validate the starting bid
    // (and buyout) against the same bounds instead. Claudium rows price per unit
    // in whole Claudium (ceiling-clamped, safe-integer math); WOC rows are
    // whole-lot with an opaque normalized decimal ask and price 0.
    let unit: number | undefined;
    let ask: number;
    let priceWoc: string | undefined;
    if (denom === 'woc') {
      const normalized =
        typeof opts?.priceWoc === 'string' ? normalizeWocAmount(opts.priceWoc) : null;
      if (normalized === null) {
        this.ctx.error(meta.entityId, 'Name a valid WOC price.');
        return;
      }
      priceWoc = normalized;
      ask = 0;
    } else if (denom === 'claudium') {
      if (!Number.isFinite(pricePerUnit) || Math.floor(pricePerUnit) < 1) {
        this.ctx.error(meta.entityId, 'Name a price of at least 1 copper.');
        return;
      }
      unit = Math.min(Math.floor(pricePerUnit), MARKET_MAX_CLAUDIUM_PRICE);
      ask = unit * want;
    } else {
      unit = auction ? undefined : Math.floor(pricePerUnit);
      ask = auction ? Math.floor(auction.startingBid) : (unit as number) * want;
      if (auction) {
        if (!Number.isFinite(ask) || ask < MARKET_MIN_PRICE) {
          this.ctx.error(meta.entityId, 'Name a starting bid of at least 1 copper.');
          return;
        }
      } else if (!Number.isFinite(ask) || ask < MARKET_MIN_PRICE || (unit as number) < 1) {
        this.ctx.error(meta.entityId, 'Name a price of at least 1 copper.');
        return;
      }
      if (ask > MARKET_MAX_PRICE) {
        this.ctx.error(meta.entityId, 'That price is beyond what the Merchant will broker.');
        return;
      }
    }
    let buyout: number | undefined;
    if (auction && auction.buyoutPrice !== undefined) {
      buyout = Math.floor(auction.buyoutPrice);
      if (!Number.isFinite(buyout) || buyout <= ask) {
        this.ctx.error(meta.entityId, 'The buyout must beat the starting bid.');
        return;
      }
      if (buyout > MARKET_MAX_PRICE) {
        this.ctx.error(meta.entityId, 'That price is beyond what the Merchant will broker.');
        return;
      }
    }
    const durationHours = opts?.durationHours ?? MARKET_DEFAULT_DURATION_HOURS;
    if (durationHours !== 12 && durationHours !== 24 && durationHours !== 48) {
      this.ctx.error(meta.entityId, 'Choose a listing duration of 12, 24, or 48 hours.');
      return;
    }
    const sellerKey = this.marketSellerKey(meta);
    const mine = this.marketListings.reduce(
      (n, l) => n + (this.marketListingBelongsTo(l, meta) ? 1 : 0),
      0,
    );
    if (mine >= MARKET_MAX_LISTINGS) {
      this.ctx.error(
        meta.entityId,
        `You may keep at most ${MARKET_MAX_LISTINGS} goods on the market at once.`,
      );
      return;
    }
    const depositPerUnit = marketDepositPerUnit(def, durationHours);
    const depositTotal = depositPerUnit * want;
    if (meta.copper < depositTotal) {
      this.ctx.error(meta.entityId, 'You cannot afford the listing deposit.');
      return;
    }
    this.ctx.removeFungibleItem(itemId, want, meta.entityId); // escrow (fungible-only, #1165)
    meta.copper -= depositTotal; // the deposit stake (refunded per unit sold)
    this.marketListings.push({
      id: this.nextListingId++,
      sellerKey,
      sellerName: meta.name,
      itemId,
      count: want,
      price: ask,
      kind: auction ? 'auction' : 'fixed',
      pricePerUnit: unit,
      durationSeconds: durationHours * 3600,
      depositPerUnit,
      startingBid: auction ? ask : undefined,
      buyoutPrice: buyout,
      expiresAt: this.ctx.time + durationHours * 3600,
      house: false,
      denom,
      priceWoc,
    });
    if (auction) {
      this.ctx.emit({
        type: 'loot',
        // biome-ignore lint/style/useTemplate: keep this scanner-friendly shape for i18n extraction.
        text: `Posted ${def.name}${want > 1 ? ' x' + want : ''} for auction (starting bid ${formatMoney(ask)}).`,
        pid: meta.entityId,
      });
    } else if (denom === 'claudium') {
      this.ctx.emit({
        type: 'loot',
        // biome-ignore lint/style/useTemplate: keep this scanner-friendly shape for i18n extraction.
        text: `Listed ${def.name}${want > 1 ? ' x' + want : ''} on the World Market for ${ask} Claudium.`,
        pid: meta.entityId,
      });
    } else if (denom === 'woc') {
      this.ctx.emit({
        type: 'loot',
        // biome-ignore lint/style/useTemplate: keep this scanner-friendly shape for i18n extraction.
        text: `Listed ${def.name}${want > 1 ? ' x' + want : ''} on the World Market for ${priceWoc} WOC.`,
        pid: meta.entityId,
      });
    } else {
      this.ctx.emit({
        type: 'loot',
        // biome-ignore lint/style/useTemplate: keep this scanner-friendly shape for i18n extraction.
        text: `Listed ${def.name}${want > 1 ? ' x' + want : ''} on the World Market for ${formatMoney(ask)}.`,
        pid: meta.entityId,
      });
    }
  }

  // Buy a listing outright. Coin leaves the buyer, goods enter their bags, and
  // the seller's proceeds (less the Merchant's cut) plus their per-unit deposit
  // stake wait in their collection. Per-unit rows sell 1..count at a time
  // (`quantity`, default the whole remainder); legacy whole-lot rows and auction
  // buyouts always transact the full stack.
  marketBuy(listingId: number, quantity?: number, pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    if (p.dead) return;
    if (!this.nearMerchant(p)) {
      this.ctx.error(meta.entityId, 'You are too far from the Merchant.');
      return;
    }
    const idx = this.marketListings.findIndex((l) => l.id === listingId);
    if (idx < 0) {
      this.ctx.error(meta.entityId, 'That listing is no longer available.');
      return;
    }
    const listing = this.marketListings[idx];
    const def = ITEMS[listing.itemId];
    if (!def) {
      // The item id is no longer known (a content edit). Do not silently delete
      // the listing: that destroys the seller's escrowed goods with no refund.
      // Leave it intact so the owner can cancel/reclaim it; just refuse the buy.
      this.ctx.error(meta.entityId, 'That listing is no longer available.');
      return;
    }
    // An external purchase is mid-payment: the lot is locked for EVERYONE
    // (buyer, rivals, and the seller) until the orchestrator resolves it.
    if (listing.pending) {
      this.ctx.error(meta.entityId, 'That lot is awaiting payment.');
      return;
    }
    if (this.marketListingBelongsTo(listing, meta)) {
      this.ctx.error(meta.entityId, 'That is your own listing — cancel it to reclaim it.');
      return;
    }
    if (listing.kind === 'auction') {
      // A direct buy of an auction lot is only possible at its buyout price.
      if (listing.buyoutPrice === undefined) {
        this.ctx.error(meta.entityId, 'That lot takes bids only.');
        return;
      }
      this.settleAuctionBuyout(idx, meta);
      return;
    }
    if (listing.denom === 'claudium' || listing.denom === 'woc') {
      // External denomination: no copper moves here. The sim validates, locks
      // the lot (pending), and emits the server-only marketPurchaseStart event
      // that drives the settlement orchestrator (the tradeSettle precedent).
      this.startExternalPurchase(listing, meta, quantity);
      return;
    }
    if (listing.pricePerUnit !== undefined) {
      // Per-unit row (every new fixed listing + the house stock): buy 1..count.
      const remaining = listing.count;
      const requested =
        quantity === undefined || !Number.isFinite(quantity) ? remaining : Math.floor(quantity);
      const qty = Math.max(1, Math.min(remaining, requested));
      const cost = qty * listing.pricePerUnit;
      if (meta.copper < cost) {
        this.ctx.error(meta.entityId, 'You cannot afford that.');
        return;
      }
      if (!this.ctx.canAddItem(listing.itemId, qty, meta.entityId)) {
        this.ctx.error(meta.entityId, 'Your bags are full.');
        return;
      }
      meta.copper -= cost;
      this.ctx.addItem(listing.itemId, qty, meta.entityId);
      if (!listing.house) {
        const proceeds = Math.max(0, Math.floor(cost * (1 - MARKET_CUT)));
        // the per-unit deposit stake rides back with each tranche sold
        this.collectionFor(listing.sellerKey).copper += proceeds + listing.depositPerUnit * qty;
        listing.count -= qty;
        listing.price = listing.pricePerUnit * listing.count;
        if (listing.count <= 0) this.marketListings.splice(idx, 1);
        const sellerMeta = this.metaByMarketSellerKey(listing.sellerKey);
        if (sellerMeta) {
          this.ctx.emit({
            type: 'loot',
            text: `${meta.name} bought your ${def.name} for ${formatMoney(cost)} - collect ${formatMoney(proceeds)} from the Merchant.`,
            pid: sellerMeta.entityId,
          });
        }
      }
      this.ctx.emit({
        type: 'loot',
        // biome-ignore lint/style/useTemplate: keep this scanner-friendly shape for i18n extraction.
        text: `Bought ${def.name}${qty > 1 ? ' x' + qty : ''} for ${formatMoney(cost)}.`,
        pid: meta.entityId,
      });
      return;
    }
    // Legacy whole-lot row (a pre-auction save): byte-identical behavior, always
    // the full stack at the stored total price (any quantity ask is ignored).
    if (meta.copper < listing.price) {
      this.ctx.error(meta.entityId, 'You cannot afford that.');
      return;
    }
    if (!this.ctx.canAddItem(listing.itemId, listing.count, meta.entityId)) {
      this.ctx.error(meta.entityId, 'Your bags are full.');
      return;
    }
    meta.copper -= listing.price;
    this.ctx.addItem(listing.itemId, listing.count, meta.entityId);
    if (!listing.house) {
      const proceeds = Math.max(0, Math.floor(listing.price * (1 - MARKET_CUT)));
      this.collectionFor(listing.sellerKey).copper += proceeds;
      this.marketListings.splice(idx, 1);
      const sellerMeta = this.metaByMarketSellerKey(listing.sellerKey);
      if (sellerMeta) {
        this.ctx.emit({
          type: 'loot',
          text: `${meta.name} bought your ${def.name} for ${formatMoney(listing.price)} - collect ${formatMoney(proceeds)} from the Merchant.`,
          pid: sellerMeta.entityId,
        });
      }
    }
    this.ctx.emit({
      type: 'loot',
      // biome-ignore lint/style/useTemplate: keep this scanner-friendly shape for i18n extraction.
      text: `Bought ${def.name}${listing.count > 1 ? ' x' + listing.count : ''} for ${formatMoney(listing.price)}.`,
      pid: meta.entityId,
    });
  }

  // Start an external-denomination purchase (marketBuy routed here for a
  // claudium/woc row). Payment is EXTERNAL, so afford is a UX pre-check at most
  // (the cached Claudium balance; the service/chain is authoritative), no copper
  // or goods move, and the sim only locks the lot behind `pending` and emits the
  // server-only marketPurchaseStart event. Single-threaded and race-free: the
  // lock is set in the same synchronous step that emits the event. Offline this
  // is unreachable (the rails read unavailable, refused above/at list time).
  private startExternalPurchase(
    listing: MarketListing,
    meta: PlayerMeta,
    quantity: number | undefined,
  ): void {
    const rails = this.ctx.tradeRails(meta.entityId);
    const buyerKey = this.marketSellerKey(meta);
    if (listing.denom === 'claudium') {
      if (!rails.claudium.available) {
        this.ctx.error(meta.entityId, 'Claudium listings are not available.');
        return;
      }
      if (listing.pricePerUnit === undefined) {
        this.ctx.error(meta.entityId, 'That listing is no longer available.');
        return;
      }
      // Per-unit partial buys, exactly like the copper fixed path.
      const remaining = listing.count;
      const requested =
        quantity === undefined || !Number.isFinite(quantity) ? remaining : Math.floor(quantity);
      const qty = Math.max(1, Math.min(remaining, requested));
      const cost = qty * listing.pricePerUnit;
      // UX pre-check only: the host's cached balance. The idempotent service
      // transfer is the authoritative check at settlement.
      if (rails.claudium.balance < cost) {
        this.ctx.error(meta.entityId, 'You cannot afford that.');
        return;
      }
      if (!this.ctx.canAddItem(listing.itemId, qty, meta.entityId)) {
        this.ctx.error(meta.entityId, 'Your bags are full.');
        return;
      }
      listing.pending = {
        buyerKey,
        buyerName: meta.name,
        quantity: qty,
        startedAt: this.ctx.time,
        purchaseSeq: this.nextPurchaseSeq++,
      };
      this.ctx.emit({
        type: 'marketPurchaseStart',
        listingId: listing.id,
        denom: 'claudium',
        buyerPid: meta.entityId,
        buyerKey,
        sellerKey: listing.sellerKey,
        quantity: qty,
        costClaudium: cost,
      });
      return;
    }
    // WOC: whole-lot only (any quantity ask is ignored, the legacy-row rule).
    if (!rails.woc.available) {
      this.ctx.error(meta.entityId, 'WOC listings are not available.');
      return;
    }
    if (!rails.woc.linked) {
      this.ctx.error(meta.entityId, 'Link a wallet to pay with WOC.');
      return;
    }
    if (listing.priceWoc === undefined) {
      this.ctx.error(meta.entityId, 'That listing is no longer available.');
      return;
    }
    if (!this.ctx.canAddItem(listing.itemId, listing.count, meta.entityId)) {
      this.ctx.error(meta.entityId, 'Your bags are full.');
      return;
    }
    listing.pending = {
      buyerKey,
      buyerName: meta.name,
      quantity: listing.count,
      startedAt: this.ctx.time,
      purchaseSeq: this.nextPurchaseSeq++,
    };
    this.ctx.emit({
      type: 'marketPurchaseStart',
      listingId: listing.id,
      denom: 'woc',
      buyerPid: meta.entityId,
      buyerKey,
      sellerKey: listing.sellerKey,
      quantity: listing.count,
      costWoc: listing.priceWoc,
    });
  }

  // ---- pending-purchase lifecycle: SERVER-called (the tradeSettleComplete/Fail
  // precedent). The offline sim never reaches these: external denominations are
  // refused while the rails read unavailable, so no offline lot can be pending.

  // Attach the server's settlement identity (Solana Pay reference + wallet
  // pubkeys for a $WOC purchase; buyer/seller account ids for a Claudium one)
  // onto a pending lot, so the persisted market blob alone can drive crash
  // recovery. Opaque host facts: the sim stores them and never interprets them.
  marketPendingAttach(listingId: number, details: MarketPendingAttachDetails): boolean {
    const pending = this.marketListings.find((l) => l.id === listingId)?.pending;
    if (!pending) return false;
    if (details.reference !== undefined) pending.reference = details.reference;
    if (details.buyerWallet !== undefined) pending.buyerWallet = details.buyerWallet;
    if (details.sellerWallet !== undefined) pending.sellerWallet = details.sellerWallet;
    if (details.buyerAccountId !== undefined) pending.buyerAccountId = details.buyerAccountId;
    if (details.sellerAccountId !== undefined) pending.sellerAccountId = details.sellerAccountId;
    return true;
  }

  // One pending purchase as the orchestrator-facing record, or null.
  marketPendingRecord(listingId: number): MarketPendingRecord | null {
    const listing = this.marketListings.find((l) => l.id === listingId);
    if (!listing?.pending || listing.denom === 'copper') return null;
    return this.pendingRecordOf(listing);
  }

  // Every pending external purchase (boot recovery walks these after loadMarket).
  marketPendingPurchases(): MarketPendingRecord[] {
    return this.marketListings
      .filter((l) => l.pending !== undefined && l.denom !== 'copper')
      .map((l) => this.pendingRecordOf(l));
  }

  private pendingRecordOf(l: MarketListing): MarketPendingRecord {
    const p = l.pending as MarketPendingState;
    return {
      listingId: l.id,
      itemId: l.itemId,
      denom: l.denom === 'woc' ? 'woc' : 'claudium',
      quantity: p.quantity,
      costClaudium:
        l.denom === 'claudium' && l.pricePerUnit !== undefined
          ? l.pricePerUnit * p.quantity
          : undefined,
      costWoc: l.denom === 'woc' ? l.priceWoc : undefined,
      buyerKey: p.buyerKey,
      buyerName: p.buyerName,
      sellerKey: l.sellerKey,
      sellerName: l.sellerName,
      purchaseSeq: p.purchaseSeq,
      reference: p.reference,
      buyerWallet: p.buyerWallet,
      sellerWallet: p.sellerWallet,
      buyerAccountId: p.buyerAccountId,
      sellerAccountId: p.sellerAccountId,
    };
  }

  // The payment landed (verified on-chain / the idempotent Claudium transfer
  // confirmed): release the goods. Delivery goes to the buyer's COLLECTION BOX,
  // never straight to bags (the buyer may have moved or disconnected while
  // paying). The seller was paid OUTSIDE the game, so no copper proceeds enter
  // their collection; only the per-unit deposit stake refunds (always copper).
  marketPendingComplete(listingId: number): boolean {
    const idx = this.marketListings.findIndex((l) => l.id === listingId);
    if (idx < 0) return false;
    const listing = this.marketListings[idx];
    const pending = listing.pending;
    if (!pending || listing.denom === 'copper') return false;
    const qty = Math.max(1, Math.min(listing.count, pending.quantity));
    const denom: 'claudium' | 'woc' = listing.denom === 'woc' ? 'woc' : 'claudium';
    const costClaudium =
      denom === 'claudium' && listing.pricePerUnit !== undefined
        ? listing.pricePerUnit * qty
        : undefined;
    const costWoc = denom === 'woc' ? listing.priceWoc : undefined;
    listing.pending = undefined;
    this.collectionFor(pending.buyerKey).items.push({ itemId: listing.itemId, count: qty });
    // the per-unit deposit stake rides back with each tranche sold, as ever
    this.collectionFor(listing.sellerKey).copper += listing.depositPerUnit * qty;
    listing.count -= qty;
    if (listing.pricePerUnit !== undefined) listing.price = listing.pricePerUnit * listing.count;
    if (listing.count <= 0) this.marketListings.splice(idx, 1);
    const sellerMeta = this.metaByMarketSellerKey(listing.sellerKey);
    if (sellerMeta) {
      this.ctx.emit({
        type: 'marketSold',
        listingId: listing.id,
        itemId: listing.itemId,
        count: qty,
        proceeds: 0,
        denom,
        costClaudium,
        costWoc,
        pid: sellerMeta.entityId,
      });
    } else {
      this.ctx.sendMarketLetter(
        listing.sellerKey,
        listing.sellerName,
        denom === 'woc' ? 'sold_wallet' : 'sold_account',
      );
    }
    return true;
  }

  // The payment never landed (timeout / service refusal / recovery unwind):
  // clear the lock, the lot returns to active, nothing moved anywhere.
  marketPendingFail(listingId: number): boolean {
    const listing = this.marketListings.find((l) => l.id === listingId);
    const pending = listing?.pending;
    if (!listing || !pending) return false;
    listing.pending = undefined;
    const buyerMeta = this.metaByMarketSellerKey(pending.buyerKey);
    if (buyerMeta) {
      this.ctx.emit({
        type: 'marketPaymentExpired',
        listingId: listing.id,
        itemId: listing.itemId,
        pid: buyerMeta.entityId,
      });
    }
    return true;
  }

  // Settle an auction lot at its buyout price for `meta`: refund the standing
  // bid, run the standard whole-lot sale settlement (cut + deposit refund to the
  // seller's collection), and notify the seller. Shared by marketBuy on an
  // auction row and by marketBid when a bid reaches the buyout (classic rule).
  private settleAuctionBuyout(idx: number, meta: PlayerMeta): void {
    const listing = this.marketListings[idx];
    const def = ITEMS[listing.itemId];
    const price = listing.buyoutPrice;
    if (!def || price === undefined) return; // callers guard both
    if (meta.copper < price) {
      this.ctx.error(meta.entityId, 'You cannot afford that.');
      return;
    }
    if (!this.ctx.canAddItem(listing.itemId, listing.count, meta.entityId)) {
      this.ctx.error(meta.entityId, 'Your bags are full.');
      return;
    }
    // The lot is leaving the book: the standing bidder gets their escrow back.
    if (listing.bid) {
      this.refundOutbid(listing, listing.bid);
      listing.bid = undefined;
    }
    meta.copper -= price;
    this.ctx.addItem(listing.itemId, listing.count, meta.entityId);
    const proceeds = Math.max(0, Math.floor(price * (1 - MARKET_CUT)));
    this.collectionFor(listing.sellerKey).copper +=
      proceeds + listing.depositPerUnit * listing.count;
    this.marketListings.splice(idx, 1);
    this.notifySold(listing, proceeds);
    this.ctx.emit({
      type: 'loot',
      // biome-ignore lint/style/useTemplate: keep this scanner-friendly shape for i18n extraction.
      text: `Bought ${def.name}${listing.count > 1 ? ' x' + listing.count : ''} for ${formatMoney(price)}.`,
      pid: meta.entityId,
    });
  }

  // Return an outbid (or cancelled/bought-out) escrow to its bidder's collection
  // box and tell them: a structured event when they are online, a Merchant letter
  // when they are not. Never hands copper to a purse directly (offline-safe).
  private refundOutbid(l: MarketListing, bid: NonNullable<MarketListing['bid']>): void {
    this.collectionFor(bid.bidderKey).copper += bid.amount;
    const bidderMeta = this.metaByMarketSellerKey(bid.bidderKey);
    if (bidderMeta) {
      this.ctx.emit({
        type: 'marketOutbid',
        listingId: l.id,
        itemId: l.itemId,
        count: l.count,
        refund: bid.amount,
        pid: bidderMeta.entityId,
      });
    } else {
      this.ctx.sendMarketLetter(bid.bidderKey, bid.bidderName, 'outbid');
    }
  }

  // Tell a seller their lot sold: a structured event online, a Merchant letter
  // offline. The proceeds (and deposit refund) are already in their collection.
  private notifySold(l: MarketListing, proceeds: number): void {
    const sellerMeta = this.metaByMarketSellerKey(l.sellerKey);
    if (sellerMeta) {
      this.ctx.emit({
        type: 'marketSold',
        listingId: l.id,
        itemId: l.itemId,
        count: l.count,
        proceeds,
        pid: sellerMeta.entityId,
      });
    } else {
      this.ctx.sendMarketLetter(l.sellerKey, l.sellerName, 'sold');
    }
  }

  // Place a bid on an auction lot. The FULL bid is escrowed from the bidder's
  // purse at bid time; the previous bidder's escrow is refunded to their
  // collection box. A bid reaching the buyout settles as an instant purchase.
  marketBid(listingId: number, amount: number, pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    if (p.dead) return;
    if (!this.nearMerchant(p)) {
      this.ctx.error(meta.entityId, 'You are too far from the Merchant.');
      return;
    }
    const idx = this.marketListings.findIndex((l) => l.id === listingId);
    if (idx < 0) {
      this.ctx.error(meta.entityId, 'That listing is no longer available.');
      return;
    }
    const listing = this.marketListings[idx];
    const def = ITEMS[listing.itemId];
    if (!def) {
      // Unknown item id (a content edit): refuse the bid but leave the lot
      // intact for its owner to reclaim, exactly like marketBuy.
      this.ctx.error(meta.entityId, 'That listing is no longer available.');
      return;
    }
    if (listing.pending) {
      this.ctx.error(meta.entityId, 'That lot is awaiting payment.');
      return;
    }
    if (listing.kind !== 'auction') {
      this.ctx.error(meta.entityId, 'That lot is not up for auction.');
      return;
    }
    if (this.marketListingBelongsTo(listing, meta)) {
      this.ctx.error(meta.entityId, 'You cannot bid on your own lot.');
      return;
    }
    const bidderKey = this.marketSellerKey(meta);
    if (listing.bid && listing.bid.bidderKey === bidderKey) {
      this.ctx.error(meta.entityId, 'You are already the high bidder.');
      return;
    }
    const amt = Math.floor(amount);
    const minNext = marketMinNextBid(listing);
    if (!Number.isFinite(amt) || amt < minNext) {
      this.ctx.error(meta.entityId, `Bid at least ${formatMoney(minNext)}.`);
      return;
    }
    if (meta.copper < amt) {
      this.ctx.error(meta.entityId, 'You cannot afford that.');
      return;
    }
    // Reaching the buyout is an instant whole-lot purchase at the buyout price
    // (classic behavior): no escrow, the standard settlement path runs instead.
    if (listing.buyoutPrice !== undefined && amt >= listing.buyoutPrice) {
      this.settleAuctionBuyout(idx, meta);
      return;
    }
    const prev = listing.bid;
    meta.copper -= amt; // escrow the FULL bid
    listing.bid = { amount: amt, bidderKey, bidderName: meta.name };
    if (prev) this.refundOutbid(listing, prev);
    this.ctx.emit({
      type: 'loot',
      // biome-ignore lint/style/useTemplate: keep this scanner-friendly shape for i18n extraction.
      text: `Bid placed: ${formatMoney(amt)} on ${def.name}.`,
      pid: meta.entityId,
    });
  }

  // Reclaim your own listing; the escrowed goods go straight back to your bags.
  marketCancel(listingId: number, pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    if (!this.nearMerchant(p)) {
      this.ctx.error(meta.entityId, 'You are too far from the Merchant.');
      return;
    }
    const idx = this.marketListings.findIndex((l) => l.id === listingId);
    if (idx < 0) return;
    const listing = this.marketListings[idx];
    if (!this.marketListingBelongsTo(listing, meta)) {
      this.ctx.error(meta.entityId, 'That is not your listing.');
      return;
    }
    // A pending external purchase locks the lot even against its own seller:
    // the buyer may already be mid-payment, so the goods must stay committed
    // until the orchestrator resolves the purchase either way.
    if (listing.pending) {
      this.ctx.error(meta.entityId, 'That lot is awaiting payment.');
      return;
    }
    if (!this.ctx.canAddItem(listing.itemId, listing.count, meta.entityId)) {
      this.ctx.error(meta.entityId, 'Your bags are full.');
      return;
    }
    // Cancelling an auction with a live bid is allowed: the bidder's escrow goes
    // back to their collection box. The listing deposit is forfeited either way.
    if (listing.bid) {
      this.refundOutbid(listing, listing.bid);
      listing.bid = undefined;
    }
    this.marketListings.splice(idx, 1);
    this.ctx.addItem(listing.itemId, listing.count, meta.entityId);
    const def = ITEMS[listing.itemId];
    this.ctx.emit({
      type: 'loot',
      // biome-ignore lint/style/useTemplate: keep this scanner-friendly shape for i18n extraction.
      text: `Reclaimed ${def?.name ?? listing.itemId}${listing.count > 1 ? ' x' + listing.count : ''} from the market.`,
      pid: meta.entityId,
    });
  }

  // Take everything waiting for you at the Merchant: sale gold and any items
  // returned from expired listings.
  marketCollect(pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    if (!this.nearMerchant(p)) {
      this.ctx.error(meta.entityId, 'You are too far from the Merchant.');
      return;
    }
    const col = this.collectionForSeller(meta);
    if (!col || (col.copper <= 0 && col.items.length === 0)) {
      this.ctx.error(meta.entityId, 'You have nothing to collect.');
      return;
    }
    if (col.copper > 0) {
      meta.copper += col.copper;
      this.ctx.emit({
        type: 'loot',
        text: `You collect ${formatMoney(col.copper)} from the Merchant.`,
        pid: meta.entityId,
      });
      // Collection copper is exclusively sale proceeds, so all of it counts.
      this.ctx.bumpDeedStat(meta, 'marketSaleCopper', col.copper);
      col.copper = 0;
    }
    // Capacity gate: items that don't fit stay in the collection box (never
    // destroyed); the gold above is always collected.
    const kept: typeof col.items = [];
    for (const s of col.items) {
      if (this.ctx.canAddItem(s.itemId, s.count, meta.entityId)) {
        this.ctx.addItem(s.itemId, s.count, meta.entityId);
      } else {
        kept.push(s);
      }
    }
    if (kept.length > 0) {
      col.items = kept;
      this.ctx.error(meta.entityId, 'Your bags are full.');
      return;
    }
    this.marketCollections.delete(this.marketSellerKey(meta));
  }

  // Once a second: settle expired listings. A won auction moves the lot to the
  // winner's collection and the bid (less the cut) plus the deposit stake to the
  // seller's; anything unsold returns to the seller's collection with the
  // deposit forfeited. Offline parties get a Merchant letter instead of events.
  private updateMarket(): void {
    if (this.ctx.tickCount % 20 !== 0) return;
    for (let i = this.marketListings.length - 1; i >= 0; i--) {
      const l = this.marketListings[i];
      // A pending external purchase never expires out from under its buyer: the
      // sweep skips it, and a lot past its expiry settles/expires on the pass
      // after the orchestrator clears the pending either way.
      if (l.house || l.pending || this.ctx.time < l.expiresAt) continue;
      this.marketListings.splice(i, 1);
      const bid = l.bid;
      if (bid) {
        // Won auction: the escrowed bid settles the sale.
        this.collectionFor(bid.bidderKey).items.push({ itemId: l.itemId, count: l.count });
        const proceeds = Math.max(0, Math.floor(bid.amount * (1 - MARKET_CUT)));
        this.collectionFor(l.sellerKey).copper += proceeds + l.depositPerUnit * l.count;
        const winnerMeta = this.metaByMarketSellerKey(bid.bidderKey);
        if (winnerMeta) {
          this.ctx.emit({
            type: 'marketWon',
            listingId: l.id,
            itemId: l.itemId,
            count: l.count,
            paid: bid.amount,
            pid: winnerMeta.entityId,
          });
        } else {
          this.ctx.sendMarketLetter(bid.bidderKey, bid.bidderName, 'won');
        }
        this.notifySold(l, proceeds);
        continue;
      }
      this.collectionFor(l.sellerKey).items.push({ itemId: l.itemId, count: l.count });
      const sellerMeta = this.metaByMarketSellerKey(l.sellerKey);
      if (sellerMeta) {
        const def = ITEMS[l.itemId];
        this.ctx.emit({
          type: 'log',
          text: `Your market listing of ${def?.name ?? l.itemId} expired and waits at the Merchant.`,
          color: '#caa472',
          pid: sellerMeta.entityId,
        });
        // Structured expiry event IN ADDITION to the legacy log line above
        // (append-only event order; the parity scenario pins the log line).
        this.ctx.emit({
          type: 'marketExpired',
          listingId: l.id,
          itemId: l.itemId,
          count: l.count,
          pid: sellerMeta.entityId,
        });
      } else {
        this.ctx.sendMarketLetter(l.sellerKey, l.sellerName, 'expired');
      }
    }
  }

  marketInfoFor(pid: number): import('../world_api').MarketInfo | null {
    const meta = this.ctx.players.get(pid);
    const e = this.ctx.entities.get(pid);
    if (!meta || !e) return null;
    // the World Market is a place you visit — only stream it while standing by
    // the Merchant, which also bounds the per-snapshot wire cost
    if (!this.nearMerchant(e)) return null;
    // Server-side browse: filter the WHOLE book by the player's query (search
    // substring + type/subtype/rarity), sort, then paginate. Doing this here (not on
    // the client over a single wire window) is what lets a player page through and
    // filter every listing, not just the first MARKET_WIRE_LIMIT.
    const query: MarketQuery = meta.marketQuery;
    const matched = this.marketListings.filter((l) => marketItemMatches(l.itemId, query));
    // Effective per-unit price as an exact integer rational (num/den), so the
    // priceAsc comparator never divides: per-unit and auction rows are num/1,
    // a legacy whole-lot row is total/count. Compared by cross-multiplication.
    const unitNum = (l: MarketListing): number =>
      l.kind === 'auction'
        ? (l.bid?.amount ?? l.startingBid ?? l.price)
        : (l.pricePerUnit ?? l.price);
    const unitDen = (l: MarketListing): number =>
      l.kind === 'auction' || l.pricePerUnit !== undefined ? 1 : Math.max(1, l.count);
    const secondsLeftOf = (l: MarketListing): number =>
      l.house || !Number.isFinite(l.expiresAt)
        ? -1
        : Math.max(0, Math.round(l.expiresAt - this.ctx.time));
    const sorted = [...matched].sort((a, b) => {
      if (query.sort === 'priceAsc') {
        return unitNum(a) * unitDen(b) - unitNum(b) * unitDen(a) || b.id - a.id;
      }
      if (query.sort === 'timeLeft') {
        const sa = secondsLeftOf(a);
        const sb = secondsLeftOf(b);
        // house stock never expires (-1 sentinel): it sorts after every real timer
        if (sa < 0 !== sb < 0) return sa < 0 ? 1 : -1;
        return sa - sb || b.id - a.id;
      }
      return b.id - a.id; // 'newest'
    });
    // The viewer's own listings are always wired (so they can reclaim from the Browse
    // tab without hunting for the right page); other sellers' listings are paged. Own
    // count (<= MARKET_MAX_LISTINGS = 12) plus one page (MARKET_PAGE_SIZE = 50) stays
    // well under MARKET_WIRE_LIMIT, which remains a hard safety bound on wire size.
    const isMine = (l: MarketListing) => this.marketListingBelongsTo(l, meta);
    const mineSorted = sorted.filter(isMine);
    const others = sorted.filter((l) => !isMine(l));
    const pageCount = Math.max(1, Math.ceil(others.length / MARKET_PAGE_SIZE));
    const page = Math.max(0, Math.min(pageCount - 1, query.page));
    const othersPage = others.slice(
      page * MARKET_PAGE_SIZE,
      page * MARKET_PAGE_SIZE + MARKET_PAGE_SIZE,
    );
    const wired = [...mineSorted, ...othersPage].slice(0, MARKET_WIRE_LIMIT);
    const listings = wired.map((l) => ({
      id: l.id,
      sellerName: isMine(l) ? meta.name : l.sellerName,
      itemId: l.itemId,
      count: l.count,
      price: l.price,
      mine: isMine(l),
      house: l.house,
      secondsLeft: secondsLeftOf(l),
      kind: (l.kind === 'auction' ? 'auction' : 'fixed') as 'fixed' | 'auction',
      pricePerUnit: l.pricePerUnit,
      currentBid: l.bid?.amount,
      minNextBid: l.kind === 'auction' ? marketMinNextBid(l) : undefined,
      buyoutPrice: l.buyoutPrice,
      myBid: l.bid?.bidderKey === this.marketSellerKey(meta),
      depositTotal: isMine(l) ? l.depositPerUnit * l.count : undefined,
      denom: l.denom,
      priceWoc: l.priceWoc,
      pendingPayment: l.pending ? true : undefined,
    }));
    const col = this.collectionForSeller(meta);
    const myListingCount = this.marketListings.reduce(
      (n, l) => n + (this.marketListingBelongsTo(l, meta) ? 1 : 0),
      0,
    );
    // The viewer's rails, folded like TradeInfo.rails (tradeInfoFor): pure UI
    // affordance for the Sell tab's denomination selector; every list/buy is
    // re-validated sim-side and settled authoritatively server-side. `woc`
    // folds the wallet link since listing/paying both require it.
    const viewerRails = this.ctx.tradeRails(pid);
    const viewerKey = this.marketSellerKey(meta);
    // The viewer's own in-flight external purchase (the FIRST, scanning the
    // whole book, since a pending listing need not sit on the wired page). The
    // server overlays wocPay onto this for a $WOC payer (the tradeWire
    // precedent); the offline sim never sets it.
    let myPendingPurchase:
      | {
          listingId: number;
          itemId: string;
          quantity: number;
          denom: 'claudium' | 'woc';
          costClaudium?: number;
          costWoc?: string;
        }
      | undefined;
    for (const l of this.marketListings) {
      const p = l.pending;
      if (!p || p.buyerKey !== viewerKey || l.denom === 'copper') continue;
      myPendingPurchase = {
        listingId: l.id,
        itemId: l.itemId,
        quantity: p.quantity,
        denom: l.denom === 'woc' ? 'woc' : 'claudium',
        costClaudium:
          l.denom === 'claudium' && l.pricePerUnit !== undefined
            ? l.pricePerUnit * p.quantity
            : undefined,
        costWoc: l.denom === 'woc' ? l.priceWoc : undefined,
      };
      break;
    }
    return {
      listings,
      // Every listing matching the filter (the viewer's own plus all others), so the
      // SELL/notes read true counts; `pageCount` below paginates the others.
      totalCount: matched.length,
      filter: query.search,
      page,
      pageCount,
      collectionCopper: col?.copper ?? 0,
      collectionItems: col ? col.items.map((s) => ({ ...s })) : [],
      cutPct: Math.round(MARKET_CUT * 100),
      maxListings: MARKET_MAX_LISTINGS,
      myListingCount,
      durationsHours: MARKET_DURATIONS_HOURS,
      rails: {
        claudium: viewerRails.claudium.available,
        woc: viewerRails.woc.available && viewerRails.woc.linked,
      },
      myPendingPurchase,
    };
  }

  // Persist only player listings + collections; house stock is reseeded each
  // boot so content edits take effect. secondsLeft survives the time reset.
  serializeMarket(): MarketSave {
    return {
      listings: this.marketListings
        .filter((l) => !l.house)
        .map((l) => ({
          id: l.id,
          sellerKey: l.sellerKey,
          sellerName: l.sellerName,
          itemId: l.itemId,
          count: l.count,
          price: l.price,
          secondsLeft: Number.isFinite(l.expiresAt)
            ? Math.max(0, Math.round(l.expiresAt - this.ctx.time))
            : MARKET_LISTING_DURATION,
          kind: l.kind,
          pricePerUnit: l.pricePerUnit,
          durationSeconds: l.durationSeconds,
          depositPerUnit: l.depositPerUnit,
          bid: l.bid ? { ...l.bid } : undefined,
          startingBid: l.startingBid,
          buyoutPrice: l.buyoutPrice,
          // denom is persisted only when non-default (JSON drops undefined);
          // loadMarket coerces an absent value back to 'copper'.
          denom: l.denom === 'copper' ? undefined : l.denom,
          priceWoc: l.priceWoc,
          pending: l.pending
            ? {
                buyerKey: l.pending.buyerKey,
                buyerName: l.pending.buyerName,
                quantity: l.pending.quantity,
                // seconds ELAPSED (the inverse secondsLeft idiom): sim.time
                // resets each boot, so on load startedAt = time - sinceSeconds.
                sinceSeconds: Math.max(0, Math.round(this.ctx.time - l.pending.startedAt)),
                purchaseSeq: l.pending.purchaseSeq,
                reference: l.pending.reference,
                buyerWallet: l.pending.buyerWallet,
                sellerWallet: l.pending.sellerWallet,
                buyerAccountId: l.pending.buyerAccountId,
                sellerAccountId: l.pending.sellerAccountId,
              }
            : undefined,
        })),
      collections: [...this.marketCollections.entries()].map(([key, c]) => ({
        key,
        copper: c.copper,
        items: c.items.map((s) => ({ ...s })),
      })),
      nextListingId: this.nextListingId,
      nextPurchaseSeq: this.nextPurchaseSeq,
    };
  }

  loadMarket(save: MarketSave | null | undefined): void {
    if (!save) return;
    for (const l of save.listings ?? []) {
      // Keep a listing whose item id is no longer in ITEMS (a content rename,
      // retirement, or typo). Dropping it would silently destroy every escrowed
      // copy on the next restart and never refund the seller. An unknown id is
      // dormant, recoverable data (the owner can reclaim it into bags, exactly
      // as the character load path keeps unknown ids verbatim); a re-added or
      // corrected id rehydrates it. Display/buy paths already guard on ITEMS[id].
      if (!l || typeof l.itemId !== 'string') continue;
      if (!ITEMS[l.itemId])
        console.warn(`market: keeping listing with unknown item id ${l.itemId}`);
      // Auction-house fields, coerced with explicit defaults so a pre-auction
      // blob loads as a legacy 'fixed' whole-lot row. A malformed bid is dropped
      // entirely (never invent escrow); a buyout not beating the starting bid is
      // dropped (the list-time bound); pricePerUnit is only trusted on a fixed
      // row and only when it is a positive integer ask.
      //
      // Denomination: absent/unknown -> 'copper' (a pre-denomination blob).
      // External rows are always 'fixed' (bids take gold only, the list-time
      // rule), a claudium per-unit ask re-clamps to the same ceiling, and a woc
      // ask must re-normalize; a woc row whose ask fails normalization keeps
      // denom 'woc' with no ask (unbuyable, but the owner can still reclaim it;
      // the sim never invents a price for someone else's goods).
      const denom: MarketDenom = l.denom === 'claudium' || l.denom === 'woc' ? l.denom : 'copper';
      const kind: 'fixed' | 'auction' =
        l.kind === 'auction' && denom === 'copper' ? 'auction' : 'fixed';
      const clampPrice = (v: unknown): number | undefined =>
        typeof v === 'number' && Number.isFinite(v)
          ? Math.max(MARKET_MIN_PRICE, Math.min(MARKET_MAX_PRICE, Math.floor(v)))
          : undefined;
      const priceWoc =
        denom === 'woc' && typeof l.priceWoc === 'string'
          ? (normalizeWocAmount(l.priceWoc) ?? undefined)
          : undefined;
      const pricePerUnit =
        kind === 'fixed' &&
        denom !== 'woc' &&
        typeof l.pricePerUnit === 'number' &&
        Number.isFinite(l.pricePerUnit) &&
        Math.floor(l.pricePerUnit) >= 1
          ? denom === 'claudium'
            ? Math.min(Math.floor(l.pricePerUnit), MARKET_MAX_CLAUDIUM_PRICE)
            : Math.floor(l.pricePerUnit)
          : undefined;
      const count = Math.max(1, l.count | 0);
      const price =
        denom === 'woc'
          ? 0
          : denom === 'claudium'
            ? pricePerUnit !== undefined
              ? pricePerUnit * count
              : 0
            : Math.max(
                MARKET_MIN_PRICE,
                Math.min(MARKET_MAX_PRICE, Math.floor(l.price) || MARKET_MIN_PRICE),
              );
      // Pending external purchase: validated defensively (never invent a lock,
      // never trust a quantity past the stack). Malformed -> dropped, unlocked.
      let pending: MarketPendingState | undefined;
      const rawPending = l.pending;
      if (
        denom !== 'copper' &&
        rawPending &&
        typeof rawPending.buyerKey === 'string' &&
        rawPending.buyerKey !== '' &&
        typeof rawPending.quantity === 'number' &&
        Number.isFinite(rawPending.quantity) &&
        Math.floor(rawPending.quantity) >= 1 &&
        typeof rawPending.purchaseSeq === 'number' &&
        Number.isFinite(rawPending.purchaseSeq)
      ) {
        pending = {
          buyerKey: rawPending.buyerKey,
          buyerName: String(rawPending.buyerName ?? rawPending.buyerKey),
          quantity: Math.min(Math.floor(rawPending.quantity), count),
          startedAt:
            this.ctx.time -
            (typeof rawPending.sinceSeconds === 'number' && Number.isFinite(rawPending.sinceSeconds)
              ? Math.max(0, rawPending.sinceSeconds)
              : 0),
          purchaseSeq: Math.floor(rawPending.purchaseSeq),
          reference: typeof rawPending.reference === 'string' ? rawPending.reference : undefined,
          buyerWallet:
            typeof rawPending.buyerWallet === 'string' ? rawPending.buyerWallet : undefined,
          sellerWallet:
            typeof rawPending.sellerWallet === 'string' ? rawPending.sellerWallet : undefined,
          buyerAccountId:
            typeof rawPending.buyerAccountId === 'number' &&
            Number.isFinite(rawPending.buyerAccountId)
              ? Math.floor(rawPending.buyerAccountId)
              : undefined,
          sellerAccountId:
            typeof rawPending.sellerAccountId === 'number' &&
            Number.isFinite(rawPending.sellerAccountId)
              ? Math.floor(rawPending.sellerAccountId)
              : undefined,
        };
      }
      const startingBid = kind === 'auction' ? (clampPrice(l.startingBid) ?? price) : undefined;
      let buyoutPrice = kind === 'auction' ? clampPrice(l.buyoutPrice) : undefined;
      if (buyoutPrice !== undefined && startingBid !== undefined && buyoutPrice <= startingBid)
        buyoutPrice = undefined;
      let bid: MarketListing['bid'];
      if (
        kind === 'auction' &&
        l.bid &&
        typeof l.bid.bidderKey === 'string' &&
        l.bid.bidderKey !== '' &&
        typeof l.bid.amount === 'number' &&
        Number.isFinite(l.bid.amount) &&
        Math.floor(l.bid.amount) >= 1
      ) {
        bid = {
          amount: Math.floor(l.bid.amount),
          bidderKey: l.bid.bidderKey,
          bidderName: String(l.bid.bidderName ?? l.bid.bidderKey),
        };
      }
      this.marketListings.push({
        id: l.id,
        sellerKey: String(l.sellerKey ?? ''),
        sellerName: String(l.sellerName ?? l.sellerKey ?? '?'),
        itemId: l.itemId,
        count,
        price,
        kind,
        pricePerUnit,
        denom,
        priceWoc,
        pending,
        durationSeconds:
          typeof l.durationSeconds === 'number' &&
          Number.isFinite(l.durationSeconds) &&
          l.durationSeconds > 0
            ? Math.floor(l.durationSeconds)
            : MARKET_LISTING_DURATION,
        depositPerUnit:
          typeof l.depositPerUnit === 'number' && Number.isFinite(l.depositPerUnit)
            ? Math.max(0, Math.floor(l.depositPerUnit))
            : 0,
        bid,
        startingBid,
        buyoutPrice,
        expiresAt:
          this.ctx.time +
          (Number.isFinite(l.secondsLeft) ? Math.max(0, l.secondsLeft) : MARKET_LISTING_DURATION),
        house: false,
      });
    }
    for (const c of save.collections ?? []) {
      if (!c || typeof c.key !== 'string') continue;
      this.marketCollections.set(c.key, {
        copper: Math.max(0, Math.floor(c.copper) || 0),
        // Keep returned/expired-listing items even when their id is unknown, for
        // the same reason as listings above: a content edit must not silently
        // empty a player's pending pickups. The id stays dormant until corrected.
        items: (c.items ?? [])
          .filter((s) => s && typeof s.itemId === 'string')
          .map((s) => ({ itemId: s.itemId, count: Math.max(1, s.count | 0) })),
      });
    }
    const maxId = this.marketListings.reduce((m, l) => Math.max(m, l.id + 1), 1);
    this.nextListingId = Math.max(this.nextListingId, save.nextListingId ?? 1, maxId);
    // Monotonic like nextListingId: never below any loaded pending's seq + 1,
    // so a Claudium dedupe key (market-<listing>-<seq>) can never be reissued
    // for a DIFFERENT purchase after a restart.
    const maxSeq = this.marketListings.reduce(
      (m, l) => Math.max(m, (l.pending?.purchaseSeq ?? 0) + 1),
      1,
    );
    this.nextPurchaseSeq = Math.max(this.nextPurchaseSeq, save.nextPurchaseSeq ?? 1, maxSeq);
    this.reclaimSoulboundListings();
  }

  // Migration for a listing whose item became SOULBOUND after it was listed (a
  // soulbound item can no longer sit on the World Market). Return each such
  // listing to its seller's collection so the owner reclaims it at the Merchant:
  // a soulbound item cannot be traded or mailed, but a Merchant pickup hands it
  // straight back to the player it is bound to, which is allowed. Mirrors the
  // expired-listing return (updateMarket). Runs once at load and is idempotent
  // (a returned listing is removed, so the next save has none; new listings of a
  // soulbound item are already blocked at list time).
  private reclaimSoulboundListings(): void {
    for (let i = this.marketListings.length - 1; i >= 0; i--) {
      const l = this.marketListings[i];
      // A pending external purchase is never yanked out from under recovery:
      // the buyer may have already paid on-chain. The orchestrator resolves
      // the pending first; the reclaim is idempotent and runs again next boot.
      if (l.house || l.pending || !ITEMS[l.itemId]?.soulbound) continue;
      this.marketListings.splice(i, 1);
      // A live bid on a reclaimed auction must not strand the bidder's escrow:
      // it goes back to their collection box (silently; this runs at load time,
      // before any player is online, and the box is the offline-safe home).
      if (l.bid) this.collectionFor(l.bid.bidderKey).copper += l.bid.amount;
      this.collectionFor(l.sellerKey).items.push({ itemId: l.itemId, count: l.count });
    }
  }
}
