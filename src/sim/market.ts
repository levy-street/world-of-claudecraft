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

import { bagCapacity, canGrantCopies, instancedCountCap } from './bags';
import { rekeySigner } from './character_rename';
import { ITEMS } from './data';
import { formatMoney } from './format_money';
import {
  boundCraftedRecipeIdOnLoad,
  sanitizeItemInstancePayloadOnLoad,
  warnDroppedInstanceKeys,
} from './item_instance_load';
import {
  countMatchingUnlocked,
  grantCopies,
  holdsMatchingLocked,
  publicInstanceView,
  removeMatchingInstance,
  sanitizeEscrowSlot,
} from './item_instance_transfer';
import { removeVendorSellUnits } from './items';
import { planListingIds, playerListingIdFloor } from './market_listing_ids';
import {
  MARKET_PAGE_SIZE,
  type MarketQuery,
  marketItemMatches,
  sanitizeMarketQuery,
} from './market_query';
import {
  cloneSaleLog,
  emptySaleLog,
  isSaleLogEmpty,
  type MarketSaleLog,
  mergeSaleLogs,
  recordSale,
  sanitizeSaleLog,
} from './market_sale_log';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import {
  cloneInvSlot,
  cloneItemInstancePayload,
  dist2d,
  type Entity,
  INTERACT_RANGE,
  type InvSlot,
  type ItemInstancePayload,
} from './types';

const MARKET_RANGE = INTERACT_RANGE + 2; // you must stand at the Merchant to deal
// the /listings readout (still on Sim) reports the seller's count against this cap,
// so it is the one const exported back to sim.ts; the rest are market-internal.
export const MARKET_MAX_LISTINGS = 12; // active player listings per seller
export const MARKET_HOUSE_STOCK = [
  { itemId: 'roasted_boar', count: 5, price: 700 },
  { itemId: 'spring_water', count: 5, price: 160 },
  { itemId: 'oiled_boots', count: 1, price: 1900 },
  { itemId: 'quilted_trousers', count: 1, price: 2400 },
  { itemId: 'greyjaw_pelt_cloak', count: 1, price: 2900 },
  // Quartermaster's Consignment - a standing line of practical travel gear.
  { itemId: 'roadwardens_helm', count: 1, price: 2200 },
  { itemId: 'wayfarers_hood', count: 1, price: 2000 },
  { itemId: 'acolytes_circlet', count: 1, price: 2000 },
  { itemId: 'reinforced_pauldrons', count: 1, price: 2400 },
  { itemId: 'embroidered_mantle', count: 1, price: 1900 },
  { itemId: 'sturdy_belt', count: 1, price: 1700 },
  { itemId: 'silk_sash', count: 1, price: 1700 },
  { itemId: 'roughspun_gloves', count: 1, price: 1500 },
  // Crossroads Outfitters - eight pieces kept in standing stock.
  { itemId: 'tradesman_hatchet', count: 1, price: 2300 },
  { itemId: 'drovers_staff', count: 1, price: 2500 },
  { itemId: 'caravan_warden_dirk', count: 1, price: 2400 },
  { itemId: 'outrider_brigandine', count: 1, price: 2600 },
  { itemId: 'caravan_quilted_vest', count: 1, price: 1800 },
  { itemId: 'outrider_legguards', count: 1, price: 2100 },
  { itemId: 'pilgrims_leggings', count: 1, price: 1700 },
  { itemId: 'outrider_sabatons', count: 1, price: 1900 },
  // The two vendor-sold bags, at their vendor price, so the Bags filter is never
  // empty on a fresh world. The four drop-only bags stay player-listed goods:
  // house rows never deplete, so seeding those would be an endless bag faucet.
  //
  // APPENDED, never inserted mid-array: ids come off one counter in array order
  // (below), house rows are reseeded every boot and are NOT persisted, and
  // `market_buy` carries only the listing id with no item cross-check. Inserting
  // here would renumber every row after it, so a client holding a browse list
  // across a server restart could click Buy on a row that now means a different
  // item. Appending leaves every existing id pointing at the same goods.
  // (Growing this table is otherwise content-safe now: the counter is floored
  // to the reserved player base below, so no id this build issues a player
  // listing can ever be reached by stock, and an id a pre-#2463 build issued
  // below that base is reissued by the load path in the same boot the table
  // grows over it. See market_listing_ids.ts, #2463.)
  { itemId: 'linen_pouch', count: 1, price: 250 },
  { itemId: 'travelers_knapsack', count: 1, price: 2000 },
] as const;
const MARKET_MIN_PRICE = 1; // copper
const MARKET_MAX_PRICE = 5_000_000; // 500g ceiling, guards against overflow / fat-finger
// Exported for the wiki generator (scripts/wiki/build_content.mjs) and its
// accuracy guard: the published cut percent derives from this one constant.
export const MARKET_CUT = 0.05; // the Merchant's cut on a completed sale (a gold sink)
// No listing deposit is charged today; the constant exists so the wiki reads
// the sim's own number instead of hardcoding one, and so a future deposit
// lever has a named home the published page tracks automatically.
export const MARKET_LISTING_DEPOSIT_COPPER = 0;
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
  /** The escrowed copy's full payload for an instanced listing (#1165
   *  completion: single-copy, count 1, listed via marketListInstance). Absent
   *  for the plain fungible listings, whose rows stay byte-identical. Wire
   *  browse rows carry only its publicInstanceView projection. */
  instance?: ItemInstancePayload;
  // Recipe id that crafted every unit in this stack (bags.ts InvSlot.craftedRecipeId,
  // professions/crafting.ts), when the seller's stock carried one. Absent for a
  // plain, never-crafted stack. ORTHOGONAL to `instance`, not exclusive with it:
  // a single instanced row can also be crafted (a masterwork proc, or a crafted
  // piece enchanted while worn), and reading the two as mutually exclusive is
  // what dropped the marker off every such listing. Threaded through
  // list/buy/cancel/collect (BUG #9) so a market round trip never launders a
  // crafted item's provenance and reopens the disenchant anti-farming gate
  // (professions/enchanting.ts isCraftedDisenchantVictim).
  craftedRecipeId?: string;
}

// Gold + items awaiting pickup at the Merchant (sale proceeds, expired
// listings), keyed by sellerKey so an offline seller can collect later.
export interface MarketCollection {
  copper: number;
  items: InvSlot[];
  /** The itemized ledger behind `copper` (market_sale_log.ts): one row per sale
   *  still awaiting pickup. Cleared with the gold it explains, never with the
   *  items, which are returns rather than sales. */
  sales: MarketSaleLog;
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
    /** Additive (#1165): the escrowed payload of an instanced listing. Absent
     *  on plain rows and on every pre-payload save, which load unchanged. */
    instance?: ItemInstancePayload;
    craftedRecipeId?: string;
  }[];
  collections: {
    key: string;
    copper: number;
    items: InvSlot[];
    /** Additive: the pending sale ledger. Absent on every pre-ledger save and on
     *  any collection holding only returns, which load as an empty log. */
    sales?: MarketSaleLog;
  }[];
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
  // Entity ids of every NPC with `market: true`, assigned by the Sim ctor during NPC
  // placement (the NPC loop stays on Sim). The World Market is a single shared book;
  // any of these merchants is a valid place to stand and deal, so a player can use the
  // auction house at whichever auctioneer is closest.
  merchantIds: number[] = [];

  // Browse-view revision counters. bookRev advances on any change to the
  // LISTINGS set and keys the sorted-book memo below; browseRev advances on any
  // change a browse snapshot can observe (listings AND collections) and is what
  // the server's rebuild-only-on-change gate reads through browseRevFor. Every
  // mutation site must go through bumpBook/bumpCollections or the memo and the
  // server gate serve stale views; the wire-reachable mutating verbs (list,
  // list-instance, buy, cancel, collect, expiry, rekey, purge, load) are each
  // pinned against exactly that in tests/market_browse_cache.test.ts.
  private bookRev = 0;
  private browseRev = 0;
  private sortedBookCache: { rev: number; source: MarketListing[]; rows: MarketListing[] } | null =
    null;

  constructor(private readonly ctx: SimContext) {}

  private bumpBook(): void {
    this.bookRev++;
    this.browseRev++;
  }

  private bumpCollections(): void {
    this.browseRev++;
  }

  // The whole book, name-then-price sorted, memoized per bookRev. The sort is
  // viewer-independent, and re-running the ICU localeCompare comparator
  // n log n times per viewer per tick was the dominant broadcast cost on a
  // grown book (the bcastSelf hot spot). Per-viewer reads FILTER this stably
  // sorted book, which yields the exact sequence the old filter-then-sort
  // produced: a stable sort with an element-only comparator commutes with
  // filter. The source/length guards catch only a wholesale array replacement
  // or a row added/removed without a bump (the test-harness push case); an
  // equal-length swap or an in-place sort-key edit is invisible to them, so
  // correctness rests on every real writer living in this module and riding a
  // bump site (the module sweep in the fix review verified exactly that).
  private sortedBook(): readonly MarketListing[] {
    const c = this.sortedBookCache;
    if (
      c &&
      c.rev === this.bookRev &&
      c.source === this.marketListings &&
      c.rows.length === this.marketListings.length
    ) {
      return c.rows;
    }
    const rows = [...this.marketListings].sort((a, b) => {
      const na = ITEMS[a.itemId]?.name ?? a.itemId;
      const nb = ITEMS[b.itemId]?.name ?? b.itemId;
      return na.localeCompare(nb) || a.price - b.price;
    });
    this.sortedBookCache = { rev: this.bookRev, source: this.marketListings, rows };
    return rows;
  }

  // The change signal the server's snapshot gate polls instead of rebuilding
  // the browse view every tick: null while this player is not at a Merchant
  // (the same gate marketInfoFor applies), else the current browse revision.
  // Server-only (never IWorld), the guildBankInfoForGuild precedent.
  browseRevFor(pid: number): number | null {
    const meta = this.ctx.players.get(pid);
    const e = this.ctx.entities.get(pid);
    if (!meta || !e) return null;
    if (!this.nearMerchant(e)) return null;
    return this.browseRev;
  }

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
      c = { copper: 0, items: [], sales: emptySaleLog() };
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
    // cloneInvSlot: an instanced return's payload must never alias between the
    // merged-away bucket and the surviving one.
    to.items.push(...from.items.map(cloneInvSlot));
    // The ledger follows its gold: the merged-away bucket's copper landed in `to`
    // above, so the rows explaining it have to travel with it or the surviving
    // collection would show proceeds it cannot account for.
    mergeSaleLogs(to.sales, from.sales);
    this.marketCollections.delete(fromKey);
    this.bumpCollections();
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
        // The escrowed payload follows its owner through the rename the same
        // way the blob sweep's buyback arm does (the fix-round review): a
        // cancel or expiry hands this exact copy back, and a stale signer
        // would detach the original-crafter discount, or after a reclaim
        // name a stranger. Foreign signers are untouched (the accepted
        // craftedBy limitation).
        if (rekeySigner(listing.instance, oldName, newName)) changed = true;
      }
    }
    const collection = this.marketCollections.get(key);
    for (const slot of collection?.items ?? []) {
      if (rekeySigner(slot.instance, oldName, newName)) changed = true;
    }
    // In-place listing edits (sellerName/signer) that the length guard on the
    // sorted-book memo cannot catch, so the bump is what invalidates here.
    // Unconditional on purpose: the browse view also reads meta.name (the
    // isMine sellerName projection), which just moved even when no row
    // matched, and a rename is far too rare for the over-invalidation to
    // matter.
    this.bumpBook();
    return changed;
  }

  // Character deletion (R43): a deleted character can never stand at the Merchant
  // again, so its listings and its collection leave the book instead of sitting
  // uncollectable forever (expired listings would keep folding goods into an
  // orphan collection nobody can claim). Matches the SAME dual keys
  // rekeyMarketSeller does, the stable character-id key plus a legacy name-keyed
  // row, and never touches house stock. (marketSellerKey's entityId fallback
  // for a meta with no characterId cannot key a production row: the server
  // always passes the character id at join, and the only metas without one
  // are dev-gated bots.) Everything destroyed here is the deleted
  // character's OWN escrow (marketList escrows out of the seller's own bags), so
  // no other player's property rides along. Returns whether anything changed, so
  // the caller only pays for a save when there was something to purge.
  purgeMarketSeller(characterId: number, name: string): boolean {
    if (!Number.isFinite(characterId)) return false;
    const key = String(characterId);
    const owns = (k: string): boolean => k === key || (name !== '' && k === name);
    let changed = false;
    for (let i = this.marketListings.length - 1; i >= 0; i--) {
      const listing = this.marketListings[i];
      if (listing.house) continue;
      if (!owns(listing.sellerKey)) continue;
      this.marketListings.splice(i, 1);
      changed = true;
    }
    if (this.marketCollections.delete(key)) changed = true;
    if (name !== '' && name !== key && this.marketCollections.delete(name)) changed = true;
    if (changed) this.bumpBook();
    return changed;
  }

  // The Merchant always keeps a little stock so the market is never empty —
  // standing consignments that never expire, never deplete, and pay no one.
  private seedHouseListings(): void {
    for (const s of MARKET_HOUSE_STOCK) {
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
    // Reserve the whole low band for house stock before a player listing can be
    // issued an id. House rows are reseeded from this counter every boot and are
    // never persisted, so without the floor a grown stock table reissues ids an
    // older build already handed to persisted player listings (#2463).
    this.nextListingId = playerListingIdFloor(this.marketListings.map((l) => l.id));
    this.bumpBook();
  }

  // List a stack from your bags for sale. The goods are escrowed (pulled from
  // your bags immediately) and held by the Merchant until bought or reclaimed.
  // Set the player's session-only World Market browse query (search + type/subtype/
  // rarity filters + page). Purely a display/query narrowing (no gameplay effect), so
  // it needs no proximity or liveness gate; the next marketInfoFor snapshot reflects it.
  marketSearch(query: MarketQuery, pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const next = sanitizeMarketQuery(query);
    // Keep the previous object when nothing changed: the server's snapshot gate
    // uses the query object's IDENTITY as its change signal, so replacing it
    // wholesale on a byte-identical re-send (a client re-firing the same
    // search every command window) would force a full browse rebuild per
    // re-send, re-opening the per-viewer cost the sorted-book memo closes.
    // Both objects come out of sanitizeMarketQuery/defaultMarketQuery with the
    // same flat fixed shape, so the stringify compare covers every field,
    // including ones added later.
    if (JSON.stringify(r.meta.marketQuery) === JSON.stringify(next)) return;
    r.meta.marketQuery = next;
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
    if (def.noMarketList || def.soulbound) {
      this.ctx.error(meta.entityId, 'That item cannot be listed on the World Market.');
      return;
    }
    if (!Number.isFinite(count)) {
      this.ctx.error(meta.entityId, 'Name how many you wish to sell.');
      return;
    }
    const want = Math.max(1, Math.floor(count));
    // The PLAIN fungible path: counts and escrows only the fungible stock, so
    // an instanced copy is never swept into a bulk listing. Instanced copies
    // list through marketListInstance below (single-copy, payload-selected).
    if (this.ctx.countFungibleItem(itemId, meta.entityId) < want) {
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
    // Escrow per unit instead of the old blind fungible bulk-decrement, so each
    // removed unit's craftedRecipeId marker (bags.ts InvSlot.craftedRecipeId,
    // professions/crafting.ts) is known (BUG #9: losing it here let a crafted
    // item launder its provenance through the World Market, reopening the
    // disenchant anti-farming gate, professions/enchanting.ts
    // isCraftedDisenchantVictim). The always-skip predicate is defence in
    // depth on top of the countFungibleItem gate above: the market stays
    // fungible-only (#1165), never touching an instanced or bound copy.
    // A single sell request can legitimately span two provenance buckets: some
    // content ships the same item id both crafted and drop-sourced
    // (recipes.ts: boundstone_helm, gravewyrm_gauntlets), so this groups the
    // removed units by marker and lists each bucket as its own row rather than
    // merging them, keeping every listing's craftedRecipeId exact for every
    // unit in it. The ask splits so every row gets at least MARKET_MIN_PRICE
    // and the rows this call creates always sum to `ask` exactly; in the
    // ordinary single-bucket case that is just `ask` on the one row, unchanged
    // from before.
    // Preview the bucket split BEFORE escrowing anything: the market only
    // ever sells fungible (non-instanced) stock here (countFungibleItem
    // gated `want` above), so this walks the same plain-slot,
    // highest-index-first order removeVendorSellUnits uses, without
    // mutating, purely to learn how many distinct craftedRecipeId buckets
    // the removal will produce. Both the MARKET_MAX_LISTINGS and
    // MARKET_MIN_PRICE-per-row invariants must hold for the split BEFORE any
    // item leaves the seller's bag (#2605 review: a dual-provenance stack
    // could otherwise push the seller over the listing cap, or price a
    // bucket at 0 copper and hand the item away for free).
    const previewByRecipe = new Map<string | undefined, number>();
    let previewLeft = want;
    for (let i = meta.inventory.length - 1; i >= 0 && previewLeft > 0; i--) {
      const s = meta.inventory[i];
      if (s.itemId !== itemId || s.instance) continue;
      const take = Math.min(s.count, previewLeft);
      previewByRecipe.set(s.craftedRecipeId, (previewByRecipe.get(s.craftedRecipeId) ?? 0) + take);
      previewLeft -= take;
    }
    const bucketCountPreview = previewByRecipe.size;
    if (mine + bucketCountPreview > MARKET_MAX_LISTINGS) {
      this.ctx.error(
        meta.entityId,
        `You may keep at most ${MARKET_MAX_LISTINGS} goods on the market at once.`,
      );
      return;
    }
    if (ask < bucketCountPreview) {
      this.ctx.error(meta.entityId, 'Name a price of at least 1 copper.');
      return;
    }
    const units = removeVendorSellUnits(this.ctx, itemId, want, meta.entityId, () => true);
    const byRecipe = new Map<string | undefined, number>();
    for (const unit of units) {
      byRecipe.set(unit.craftedRecipeId, (byRecipe.get(unit.craftedRecipeId) ?? 0) + 1);
    }
    const buckets = [...byRecipe.entries()];
    let priceLeft = ask;
    buckets.forEach(([craftedRecipeId, bucketCount], i) => {
      const remainingBuckets = buckets.length - i;
      const bucketPrice =
        i === buckets.length - 1
          ? priceLeft
          : Math.max(
              MARKET_MIN_PRICE,
              Math.min(
                priceLeft - (remainingBuckets - 1) * MARKET_MIN_PRICE,
                Math.floor((ask * bucketCount) / want),
              ),
            );
      priceLeft -= bucketPrice;
      this.marketListings.push({
        id: this.nextListingId++,
        sellerKey,
        sellerName: meta.name,
        itemId,
        count: bucketCount,
        price: bucketPrice,
        expiresAt: this.ctx.time + MARKET_LISTING_DURATION,
        house: false,
        ...(craftedRecipeId === undefined ? {} : { craftedRecipeId }),
      });
    });
    this.bumpBook();
    this.ctx.emit({
      type: 'loot',
      // biome-ignore lint/style/useTemplate: keep this scanner-friendly shape for i18n extraction.
      text: `Listed ${def.name}${want > 1 ? ' x' + want : ''} on the World Market for ${formatMoney(ask)}.`,
      pid: meta.entityId,
    });
  }

  // List ONE instanced copy (#1165 completion): a signed, enchanted, masterwork,
  // or otherwise payload-carrying copy that is NOT transfer-locked (armed
  // bindOnTrade or bound boundTo copies never ride an anonymous pipe; the
  // def-level quest/soulbound/noMarketList rules are unchanged). The copy is
  // named by its payload, never a bag index, so a reshuffle between staging and
  // submit cannot redirect the escrow; what enters the book is the payload of
  // the actual copy removed from the bags (removeMatchingInstance's contract),
  // never the wire needle. Single-copy by design: count 1, one listing per
  // copy. The plain fungible path (marketList above) stays byte-identical.
  marketListInstance(
    itemId: string,
    price: number,
    instance: ItemInstancePayload,
    pid?: number,
  ): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    if (p.dead) return;
    if (instance === null || typeof instance !== 'object') return;
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
    if (countMatchingUnlocked(meta, itemId, instance) < 1) {
      if (holdsMatchingLocked(meta, itemId, instance)) {
        this.ctx.error(meta.entityId, 'That item is bound and cannot be listed.');
      } else {
        this.ctx.error(meta.entityId, 'You do not have that many to sell.');
      }
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
    const escrowed = removeMatchingInstance(this.ctx, itemId, instance, meta.entityId);
    if (!escrowed?.instance) return; // revalidation raced away; nothing was removed
    this.marketListings.push({
      id: this.nextListingId++,
      sellerKey,
      sellerName: meta.name,
      itemId,
      count: 1,
      price: ask,
      expiresAt: this.ctx.time + MARKET_LISTING_DURATION,
      house: false,
      instance: escrowed.instance,
      // An instanced row CAN also be crafted (a masterwork proc, an enchanted
      // crafted piece), so the marker rides alongside the payload rather than
      // being assumed absent here.
      ...(escrowed.craftedRecipeId === undefined
        ? {}
        : { craftedRecipeId: escrowed.craftedRecipeId }),
    });
    this.bumpBook();
    this.ctx.emit({
      type: 'loot',
      text: `Listed ${def.name} on the World Market for ${formatMoney(ask)}.`,
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
      // The item id is no longer known (a content edit). Do not silently delete
      // the listing: that destroys the seller's escrowed goods with no refund.
      // Leave it intact so the owner can cancel/reclaim it; just refuse the buy.
      this.ctx.error(meta.entityId, 'That listing is no longer available.');
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
    if (
      !canGrantCopies(
        meta.inventory,
        bagCapacity(meta.bags),
        listing.itemId,
        listing.count,
        listing.instance,
        listing.craftedRecipeId,
      )
    ) {
      this.ctx.error(meta.entityId, 'Your bags are full.');
      return;
    }
    meta.copper -= listing.price;
    grantCopies(
      this.ctx,
      meta.entityId,
      listing.itemId,
      listing.count,
      listing.instance,
      listing.craftedRecipeId,
    );
    if (!listing.house) {
      const proceeds = Math.max(0, Math.floor(listing.price * (1 - MARKET_CUT)));
      const col = this.collectionFor(listing.sellerKey);
      col.copper += proceeds;
      // Itemize the sale beside the gold it produced. The listing row is spliced
      // away on the next line, so this is the last point that still knows WHAT
      // sold; without it the seller's collection is a bare copper total.
      recordSale(col.sales, {
        itemId: listing.itemId,
        count: listing.count,
        price: listing.price,
        proceeds,
        buyerName: meta.name,
      });
      this.marketListings.splice(idx, 1);
      this.bumpBook();
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
    if (
      !canGrantCopies(
        meta.inventory,
        bagCapacity(meta.bags),
        listing.itemId,
        listing.count,
        listing.instance,
        listing.craftedRecipeId,
      )
    ) {
      this.ctx.error(meta.entityId, 'Your bags are full.');
      return;
    }
    this.marketListings.splice(idx, 1);
    this.bumpBook();
    grantCopies(
      this.ctx,
      meta.entityId,
      listing.itemId,
      listing.count,
      listing.instance,
      listing.craftedRecipeId,
    );
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
    if (!col || (col.copper <= 0 && col.items.length === 0 && isSaleLogEmpty(col.sales))) {
      this.ctx.error(meta.entityId, 'You have nothing to collect.');
      return;
    }
    // Every path past the guard mutates the collection (gold zeroed, items
    // granted or kept), so bump once up front.
    this.bumpCollections();
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
    // The ledger clears with the GOLD, not at the end of the method: the capacity
    // gate below can leave items behind and return early, and rows describing gold
    // already paid out must not survive to be shown (and re-shown) next collect.
    // Cleared unconditionally, because a sale whose proceeds floored to 0 copper
    // (a 1-copper listing against the Merchant's cut) still logs a row, and that
    // row would otherwise be uncollectable forever.
    col.sales = emptySaleLog();
    // Capacity gate: items that don't fit stay in the collection box (never
    // destroyed); the gold above is always collected. Instance-aware on both
    // arms so a returned instanced listing keeps its payload here too.
    const kept: typeof col.items = [];
    for (const s of col.items) {
      if (
        canGrantCopies(
          meta.inventory,
          bagCapacity(meta.bags),
          s.itemId,
          s.count,
          s.instance,
          s.craftedRecipeId,
        )
      ) {
        grantCopies(this.ctx, meta.entityId, s.itemId, s.count, s.instance, s.craftedRecipeId);
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

  // Once a second: return expired player listings to their seller's collection.
  private updateMarket(): void {
    if (this.ctx.tickCount % 20 !== 0) return;
    for (let i = this.marketListings.length - 1; i >= 0; i--) {
      const l = this.marketListings[i];
      if (l.house || this.ctx.time < l.expiresAt) continue;
      this.marketListings.splice(i, 1);
      this.bumpBook();
      // Conditional spread: a plain row must not grow an `instance: undefined`/
      // `craftedRecipeId: undefined` key (rows are persisted and diffed
      // byte-for-byte). BOTH are spread independently because a row can carry
      // both at once (a masterwork proc, or a crafted piece enchanted while
      // worn): reading them as mutually exclusive is the exact mental model
      // that dropped the marker off every such listing, so this expiry return
      // must keep treating them as orthogonal. See the MarketListing field
      // comment above.
      this.collectionFor(l.sellerKey).items.push({
        itemId: l.itemId,
        count: l.count,
        ...(l.instance ? { instance: l.instance } : {}),
        ...(l.craftedRecipeId === undefined ? {} : { craftedRecipeId: l.craftedRecipeId }),
      });
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

  // Whether anything (sale gold or returned items) waits for this player at the
  // Merchant. The always-streamed HUD indicator bit (the mailUnread pattern):
  // unlike marketInfoFor it has NO proximity gate, so the minimap badge can
  // light anywhere in the world; collection itself stays at the Merchant.
  collectPendingFor(pid: number): boolean {
    const meta = this.ctx.players.get(pid);
    if (!meta) return false;
    const col = this.collectionForSeller(meta);
    return !!col && (col.copper > 0 || col.items.length > 0 || !isSaleLogEmpty(col.sales));
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
    // Filter the memoized sorted book instead of sorting the filtered book:
    // identical sequence (see sortedBook), without the per-viewer sort.
    const sorted = this.sortedBook().filter((l) => marketItemMatches(l.itemId, query));
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
      // Display projection only (publicInstanceView: signer/enchant/rolled,
      // never boundTo/bindOnTrade/charges): browse rows are other players'
      // goods, so the full payload never crosses the wire. Conditional spread:
      // plain rows stay byte-identical (no `instance: undefined` key).
      ...(l.instance ? { instance: publicInstanceView(l.instance) } : {}),
    }));
    const col = this.collectionForSeller(meta);
    const myListingCount = this.marketListings.reduce(
      (n, l) => n + (this.marketListingBelongsTo(l, meta) ? 1 : 0),
      0,
    );
    return {
      listings,
      // Every listing matching the filter (the viewer's own plus all others), so the
      // SELL/notes read true counts; `pageCount` below paginates the others.
      totalCount: sorted.length,
      filter: query.search,
      // Echo every filter axis, not just the search text: a fresh join (post-
      // linkdead-grace reconnect) resets this session-only query to default, and
      // this is the wire signal the client compares its own filter controls
      // against to detect that drift (world_api/market.ts queryDiffersFromEcho,
      // issue #2416).
      itemType: query.itemType,
      subtype: query.subtype,
      armorClass: query.armorClass,
      primaryStat: query.primaryStat,
      rarity: query.rarity,
      page,
      pageCount,
      collectionCopper: col?.copper ?? 0,
      // cloneInvSlot, not a shallow spread: the offline host hands this array
      // straight to the UI, and an aliased live payload (mutable rolled/charges
      // maps) must never leak out of the escrow book. Own goods, so the full
      // payload (not the public trim) is correct here, the self inv precedent.
      collectionItems: col ? col.items.map(cloneInvSlot) : [],
      // Cloned for the same reason as the slots above: the offline host hands this
      // straight to the UI, and the live ledger must not be reachable from it.
      collectionSales: col ? col.sales.entries.map((e) => ({ ...e })) : [],
      collectionSalesOmitted: col?.sales.omitted ?? 0,
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
          // Deep-cloned (never spread): the save must not alias the live book's
          // mutable rolled/charges maps. Conditional so plain rows are unchanged.
          ...(l.instance ? { instance: cloneItemInstancePayload(l.instance) } : {}),
          ...(l.craftedRecipeId === undefined ? {} : { craftedRecipeId: l.craftedRecipeId }),
        })),
      collections: [...this.marketCollections.entries()].map(([key, c]) => ({
        key,
        copper: c.copper,
        // cloneInvSlot, not a shallow spread: an instanced return's payload
        // must not alias between the live collection and the serialized blob.
        items: c.items.map(cloneInvSlot),
        // Conditional + deep-cloned, the listing arm's doctrine: a collection
        // holding only returns writes no `sales` key at all, so blobs that
        // predate the ledger round-trip byte-identical.
        ...(isSaleLogEmpty(c.sales) ? {} : { sales: cloneSaleLog(c.sales) }),
      })),
      nextListingId: this.nextListingId,
    };
  }

  loadMarket(save: MarketSave | null | undefined): void {
    if (!save) return;
    // Drop the rows that carry no item id at all BEFORE planning, so the plan
    // describes exactly what gets pushed: no planned id is burned on a row that
    // never lands, and `remapped` counts only reissues the book actually took.
    // (A listing whose item id is merely no longer in ITEMS is a different case
    // and is KEPT; see the loop below.)
    // One aggregated dev-channel line per book load, the mail-book idiom.
    const escrowDrops: string[] = [];
    const saved = (save.listings ?? []).filter((l) => l && typeof l.itemId === 'string');
    // Settle the id counter and reissue any collision BEFORE a single row is
    // pushed back. The house band is already in the book (seeded by the ctor)
    // and is sized by the CURRENT stock table, so a save written under a smaller
    // table can carry an id that now names a house row. Replaying it verbatim
    // would put two rows in the book under one id, and every id-resolving call
    // site (marketBuy/marketCancel/the wire) would resolve to the house row that
    // sits earlier in the array (#2463). Boot order makes this safe: the server
    // loads the market before any client connects (server/main.ts).
    const plan = planListingIds({
      taken: this.marketListings.map((l) => l.id),
      saved: saved.map((l) => l.id),
      from: this.nextListingId,
      savedNext: save.nextListingId,
    });
    for (let i = 0; i < saved.length; i++) {
      const l = saved[i];
      // Keep a listing whose item id is no longer in ITEMS (a content rename,
      // retirement, or typo). Dropping it would silently destroy every escrowed
      // copy on the next restart and never refund the seller. An unknown id is
      // dormant, recoverable data (the owner can reclaim it into bags, exactly
      // as the character load path keeps unknown ids verbatim); a re-added or
      // corrected id rehydrates it. Display/buy paths already guard on ITEMS[id].
      if (!ITEMS[l.itemId])
        console.warn(`market: keeping listing with unknown item id ${l.itemId}`);
      // A persisted instanced row rehydrates its payload (deep-cloned off the
      // raw blob) and clamps to the single-copy contract: no hand-edited save
      // can mint a counted stack of one escrowed special copy.
      // Through the SAME shared payload bound the escrow slots take (the
      // phase 18 whole-branch review): the listing arm was the one instanced
      // rehydration in either book that bypassed even sanitizeEscrowSlot, so
      // an oversized or clone-mangled payload rode every market save and was
      // granted into the buyer's live bags on purchase. A payload the bound
      // rejects whole leaves the listing as dormant plain data, the same
      // doctrine as an unknown item id.
      // The single-copy clamp keys on the RAW row's instance, not the
      // post-bound survivor: a payload the bound rejects whole must still
      // load as count 1, or a tampered instanced row would launder its
      // count through deliberately corrupt payload bytes (the round 5
      // finder caught the clamp reading the bound's output).
      const hadInstance = !!(l.instance && typeof l.instance === 'object');
      let instance: ItemInstancePayload | undefined;
      if (hadInstance && l.instance) {
        const bounded = sanitizeItemInstancePayloadOnLoad(cloneItemInstancePayload(l.instance));
        for (const d of bounded.dropped) escrowDrops.push(`listing.${l.itemId}.${d}`);
        instance = bounded.payload;
      }
      const listing = {
        id: plan.ids[i],
        sellerKey: String(l.sellerKey ?? ''),
        sellerName: String(l.sellerName ?? l.sellerKey ?? '?'),
        itemId: l.itemId,
        count: hadInstance ? 1 : Math.max(1, l.count | 0),
        price: Math.max(
          MARKET_MIN_PRICE,
          Math.min(MARKET_MAX_PRICE, Math.floor(l.price) || MARKET_MIN_PRICE),
        ),
        expiresAt:
          this.ctx.time +
          (Number.isFinite(l.secondsLeft) ? Math.max(0, l.secondsLeft) : MARKET_LISTING_DURATION),
        house: false,
        ...(instance ? { instance } : {}),
        ...(typeof l.craftedRecipeId === 'string' ? { craftedRecipeId: l.craftedRecipeId } : {}),
      };
      // The slot-level marker bound every other persisted marker load takes
      // (bag/buyback/bank; item_instance_load.ts doctrine): a listing row can
      // persist to expiry and re-grant into live bags via grantCopies, so a
      // bare typeof keep would carry an empty or unbounded marker unreported.
      // 'listingSlot', not 'listing': the payload bound above already emits
      // listing.<itemId>.craftedRecipeId for a dropped PAYLOAD key of the
      // same name (payloads legitimately carry one, items.ts), so the
      // slot-level marker drop needs its own label to stay tellable apart
      // in the one aggregated book line.
      boundCraftedRecipeIdOnLoad(listing, escrowDrops, 'listingSlot');
      this.marketListings.push(listing);
    }
    for (const c of save.collections ?? []) {
      if (!c || typeof c.key !== 'string') continue;
      this.marketCollections.set(c.key, {
        copper: Math.max(0, Math.floor(c.copper) || 0),
        // Untrusted blob data like every slot below it; a missing key (every
        // pre-ledger save) sanitizes to an empty log.
        sales: sanitizeSaleLog(c.sales),
        // Keep returned/expired-listing items even when their id is unknown, for
        // the same reason as listings above: a content edit must not silently
        // empty a player's pending pickups. The id stays dormant until corrected.
        // sanitizeEscrowSlot preserves an instanced return's payload and clamps
        // its count to the identical-payload merge cap (the character-load rule).
        items: (c.items ?? [])
          .filter((s) => s && typeof s.itemId === 'string')
          .map((s) => {
            const slot: InvSlot = {
              ...sanitizeEscrowSlot(s, instancedCountCap(ITEMS[s.itemId], s.instance), escrowDrops),
              ...(typeof s.craftedRecipeId === 'string'
                ? { craftedRecipeId: s.craftedRecipeId }
                : {}),
            };
            // Same slot-level marker bound as the listing arm above: a
            // collection slot persists until collected and grants straight
            // into live bags, the same forever-row class as mail.
            boundCraftedRecipeIdOnLoad(slot, escrowDrops, 'collectionSlot');
            return slot;
          }),
      });
    }
    warnDroppedInstanceKeys('market book', escrowDrops);
    this.nextListingId = plan.nextListingId;
    if (plan.remapped > 0) {
      // Dev-channel only: a boot-time repair the operator should see in the log.
      // The count covers all three reissue causes (taken by the house band,
      // duplicated inside the save, or malformed), so the log never sends an
      // operator after the wrong hypothesis on a corrupt blob.
      console.warn(
        `market: reissued ${plan.remapped} persisted listing id(s) that collided or were malformed`,
      );
    }
    this.reclaimSoulboundListings();
    this.bumpBook();
  }

  // Migration for a listing whose item became SOULBOUND after it was listed (a
  // soulbound item can no longer sit on the World Market). Return each such
  // listing to its seller's collection so the owner reclaims it at the Merchant:
  // a soulbound item cannot be traded or mailed, but a Merchant pickup hands it
  // straight back to the player it is bound to, which is allowed. Mirrors the
  // expired-listing return (updateMarket). Runs once at load and is idempotent
  // (a returned listing is removed, so the next save has none; new listings of a
  // soulbound item are already blocked at list time).
  // Bump-site note: relies on its single caller (loadMarket) bumping bookRev
  // after it returns; a second caller must bump for itself.
  private reclaimSoulboundListings(): void {
    for (let i = this.marketListings.length - 1; i >= 0; i--) {
      const l = this.marketListings[i];
      if (l.house || !ITEMS[l.itemId]?.soulbound) continue;
      this.marketListings.splice(i, 1);
      this.collectionFor(l.sellerKey).items.push({
        itemId: l.itemId,
        count: l.count,
        ...(l.instance ? { instance: l.instance } : {}),
        ...(l.craftedRecipeId === undefined ? {} : { craftedRecipeId: l.craftedRecipeId }),
      });
    }
  }
}
