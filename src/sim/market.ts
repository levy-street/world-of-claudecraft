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
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { dist2d, type Entity, INTERACT_RANGE, type InvSlot } from './types';

const MARKET_RANGE = INTERACT_RANGE + 2; // you must stand at the Merchant to deal
// the /listings readout (still on Sim) reports the seller's count against this cap,
// so it is the one const exported back to sim.ts; the rest are market-internal.
export const MARKET_MAX_LISTINGS = 12; // active player listings per seller
const MARKET_MIN_PRICE = 1; // copper
const MARKET_MAX_PRICE = 5_000_000; // 500g ceiling — guards against overflow / fat-finger
const MARKET_CUT = 0.05; // the Merchant's cut on a completed sale (a gold sink)
const MARKET_LISTING_DURATION = 48 * 3600; // sim-seconds an unsold listing lingers before returning
const MARKET_WIRE_LIMIT = 120; // most listings shipped to one client at a time

export interface MarketListing {
  id: number;
  sellerKey: string; // stable seller identity (character id string); '' for house stock
  sellerName: string; // display name
  itemId: string;
  count: number;
  price: number; // total copper buyout for the whole stack
  expiresAt: number; // sim.time seconds; Infinity for the Merchant's own stock
  house: boolean; // the Merchant's standing stock: never expires, never depletes, pays no one
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
  }[];
  collections: { key: string; copper: number; items: InvSlot[] }[];
  nextListingId: number;
}

export class Market {
  // the World Market: one shared listing book, per-seller collections keyed by
  // stable character identity, and the Merchant entity these are anchored to.
  // `marketListings` is read through Sim's public `marketListings` getter (the
  // /listings readout + tests); the rest are market-internal.
  marketListings: MarketListing[] = [];
  private marketCollections = new Map<string, MarketCollection>();
  private nextListingId = 1;
  // assigned by the Sim ctor during NPC placement (the NPC loop stays on Sim).
  merchantId = -1;

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

  private merchantEntity(): Entity | null {
    const e = this.ctx.entities.get(this.merchantId);
    return e && e.kind === 'npc' ? e : null;
  }

  private nearMerchant(e: Entity): boolean {
    const m = this.merchantEntity();
    return !!m && dist2d(e.pos, m.pos) <= MARKET_RANGE;
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
    const stock: { itemId: string; count: number; price: number }[] = [
      { itemId: 'roasted_boar', count: 5, price: 700 },
      { itemId: 'spring_water', count: 5, price: 160 },
      { itemId: 'oiled_boots', count: 1, price: 1900 },
      { itemId: 'quilted_trousers', count: 1, price: 2400 },
      { itemId: 'greyjaw_pelt_cloak', count: 1, price: 2900 },
      // Quartermaster's Consignment — a standing line of practical travel gear.
      { itemId: 'roadwardens_helm', count: 1, price: 2200 },
      { itemId: 'wayfarers_hood', count: 1, price: 2000 },
      { itemId: 'acolytes_circlet', count: 1, price: 2000 },
      { itemId: 'reinforced_pauldrons', count: 1, price: 2400 },
      { itemId: 'embroidered_mantle', count: 1, price: 1900 },
      { itemId: 'sturdy_belt', count: 1, price: 1700 },
      { itemId: 'silk_sash', count: 1, price: 1700 },
      { itemId: 'roughspun_gloves', count: 1, price: 1500 },
      // Crossroads Outfitters — eight pieces kept in standing stock
      { itemId: 'tradesman_hatchet', count: 1, price: 2300 },
      { itemId: 'drovers_staff', count: 1, price: 2500 },
      { itemId: 'caravan_warden_dirk', count: 1, price: 2400 },
      { itemId: 'outrider_brigandine', count: 1, price: 2600 },
      { itemId: 'caravan_quilted_vest', count: 1, price: 1800 },
      { itemId: 'outrider_legguards', count: 1, price: 2100 },
      { itemId: 'pilgrims_leggings', count: 1, price: 1700 },
      { itemId: 'outrider_sabatons', count: 1, price: 1900 },
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
        expiresAt: Infinity,
        house: true,
      });
    }
  }

  // List a stack from your bags for sale. The goods are escrowed (pulled from
  // your bags immediately) and held by the Merchant until bought or reclaimed.
  // Set the player's session-only World Market browse filter. Purely a
  // display/query narrowing — no gameplay effect — so it needs no proximity or
  // liveness gate; the next marketInfoFor snapshot reflects it.
  marketSearch(query: string, pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    r.meta.marketFilter = (query ?? '').slice(0, 40);
  }

  marketList(itemId: string, count: number, price: number, pid?: number): void {
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
    if (def.noMarketList) {
      this.ctx.error(meta.entityId, 'That item cannot be listed on the World Market.');
      return;
    }
    if (!Number.isFinite(count)) {
      this.ctx.error(meta.entityId, 'Name how many you wish to sell.');
      return;
    }
    const want = Math.max(1, Math.floor(count));
    if (this.ctx.countItem(itemId, meta.entityId) < want) {
      this.ctx.error(meta.entityId, 'You do not have that many to sell.');
      return;
    }
    const ask = Math.floor(price);
    if (!Number.isFinite(ask) || ask < MARKET_MIN_PRICE) {
      this.ctx.error(meta.entityId, 'Name a price of at least 1 copper.');
      return;
    }
    if (ask > MARKET_MAX_PRICE) {
      this.ctx.error(meta.entityId, 'That price is beyond what the Merchant will broker.');
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
    this.ctx.removeItem(itemId, want, meta.entityId); // escrow
    this.marketListings.push({
      id: this.nextListingId++,
      sellerKey,
      sellerName: meta.name,
      itemId,
      count: want,
      price: ask,
      expiresAt: this.ctx.time + MARKET_LISTING_DURATION,
      house: false,
    });
    this.ctx.emit({
      type: 'loot',
      // biome-ignore lint/style/useTemplate: keep this scanner-friendly shape for i18n extraction.
      text: `Listed ${def.name}${want > 1 ? ' x' + want : ''} on the World Market for ${formatMoney(ask)}.`,
      pid: meta.entityId,
    });
  }

  // Buy a listing outright. Coin leaves the buyer, goods enter their bags, and
  // the seller's proceeds (less the Merchant's cut) wait in their collection.
  marketBuy(listingId: number, pid?: number): void {
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
      this.marketListings.splice(idx, 1);
      return;
    }
    if (this.marketListingBelongsTo(listing, meta)) {
      this.ctx.error(meta.entityId, 'That is your own listing — cancel it to reclaim it.');
      return;
    }
    if (meta.copper < listing.price) {
      this.ctx.error(meta.entityId, 'You cannot afford that.');
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
    }
    for (const s of col.items) this.ctx.addItem(s.itemId, s.count, meta.entityId);
    this.marketCollections.delete(this.marketSellerKey(meta));
  }

  // Once a second: return expired player listings to their seller's collection.
  private updateMarket(): void {
    if (this.ctx.tickCount % 20 !== 0) return;
    for (let i = this.marketListings.length - 1; i >= 0; i--) {
      const l = this.marketListings[i];
      if (l.house || this.ctx.time < l.expiresAt) continue;
      this.marketListings.splice(i, 1);
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
    // Server-side browse filter: a substring match on item name (and id) lets a
    // player reach goods past MARKET_WIRE_LIMIT without lifting the wire cap.
    const filter = meta.marketFilter.trim().toLowerCase();
    const matched = filter
      ? this.marketListings.filter((l) => {
          const name = (ITEMS[l.itemId]?.name ?? l.itemId).toLowerCase();
          return name.includes(filter) || l.itemId.toLowerCase().includes(filter);
        })
      : this.marketListings;
    const sorted = [...matched].sort((a, b) => {
      const na = ITEMS[a.itemId]?.name ?? a.itemId;
      const nb = ITEMS[b.itemId]?.name ?? b.itemId;
      return na.localeCompare(nb) || a.price - b.price;
    });
    // Always wire the seller their own listings first, then fill the rest of the
    // wire budget with everyone else's. Without this, on a busy shared market a
    // seller's goods can sort past MARKET_WIRE_LIMIT and never reach them — the
    // SELL tab would then read "12/12" while only a handful of their listings
    // are visible. MARKET_MAX_LISTINGS (12) ≪ MARKET_WIRE_LIMIT (120), so a
    // seller's own goods always fit alongside a healthy slice of the market.
    const isMine = (l: MarketListing) => this.marketListingBelongsTo(l, meta);
    const mineSorted = sorted.filter(isMine);
    const others = sorted.filter((l) => !isMine(l));
    const wired = [
      ...mineSorted,
      ...others.slice(0, Math.max(0, MARKET_WIRE_LIMIT - mineSorted.length)),
    ];
    const listings = wired.map((l) => ({
      id: l.id,
      sellerName: isMine(l) ? meta.name : l.sellerName,
      itemId: l.itemId,
      count: l.count,
      price: l.price,
      mine: isMine(l),
      house: l.house,
    }));
    const col = this.collectionForSeller(meta);
    const myListingCount = this.marketListings.reduce(
      (n, l) => n + (this.marketListingBelongsTo(l, meta) ? 1 : 0),
      0,
    );
    return {
      listings,
      totalCount: matched.length,
      filter: meta.marketFilter,
      collectionCopper: col?.copper ?? 0,
      collectionItems: col ? col.items.map((s) => ({ ...s })) : [],
      cutPct: Math.round(MARKET_CUT * 100),
      maxListings: MARKET_MAX_LISTINGS,
      myListingCount,
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
        })),
      collections: [...this.marketCollections.entries()].map(([key, c]) => ({
        key,
        copper: c.copper,
        items: c.items.map((s) => ({ ...s })),
      })),
      nextListingId: this.nextListingId,
    };
  }

  loadMarket(save: MarketSave | null | undefined): void {
    if (!save) return;
    for (const l of save.listings ?? []) {
      if (!l || typeof l.itemId !== 'string' || !ITEMS[l.itemId]) continue;
      this.marketListings.push({
        id: l.id,
        sellerKey: String(l.sellerKey ?? ''),
        sellerName: String(l.sellerName ?? l.sellerKey ?? '?'),
        itemId: l.itemId,
        count: Math.max(1, l.count | 0),
        price: Math.max(
          MARKET_MIN_PRICE,
          Math.min(MARKET_MAX_PRICE, Math.floor(l.price) || MARKET_MIN_PRICE),
        ),
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
        items: (c.items ?? [])
          .filter((s) => s && ITEMS[s.itemId])
          .map((s) => ({ itemId: s.itemId, count: Math.max(1, s.count | 0) })),
      });
    }
    const maxId = this.marketListings.reduce((m, l) => Math.max(m, l.id + 1), 1);
    this.nextListingId = Math.max(this.nextListingId, save.nextListingId ?? 1, maxId);
  }
}
