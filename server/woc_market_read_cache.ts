// Shared read caches for the $WOC Exchange's hot GET surface (H11). One
// instance per realm process, injected into WocMarketService (reads consult
// it) and exposed on the routes runtime (mutations bust it). Built on the
// house cache seam (KeyedCachedRead: TTL, single-flight per key, LRU bound,
// stale-on-error), never a per-request pool.query.
//
// What is cached, and why each key is safe to share:
// - browse pages, keyed by the CANONICAL query tuple. The browse SQL is
//   viewer-identical (directed listings are excluded by the query itself;
//   the one per-viewer bit, listingView's `mine`, is computed per request
//   over the shared rows).
// - listing rows by id, for the detail read. The row is shared; the
//   directed-sale party gate stays IN THE SERVICE and runs per request over
//   the cached row, so a warm cache can never widen who sees a directed
//   listing (pinned by the two-viewer test).
// - sales history by item id (viewer-identical).
// - the activity readout by account id. Account-scoped: the ACCOUNT IS THE
//   KEY, so one account's readout can never serve another (the
//   discord_status_cache shape).
//
// Staleness model: TTLs sit at or under the cadences that already bound how
// fresh this data is (the 5s sweep beat, the window's 3s awaiting-chain
// poll), so the cache never makes a player's view meaningfully staler than
// the server's own convergence. Player-visible immediacy is preserved by
// BUSTS, not tiny TTLs: every market mutation on the routes layer busts the
// actor's activity readout (refusals included: a refused call can still have
// committed durable state, terms acceptance and recorded signatures above
// all), successful mutations bust the listings surface too, and the three
// moderation arms bust what they change (suspend -> listings; sale exclusion
// -> that item's history; strike clearing -> that account's readout). Sweep
// transitions deliberately ride the TTL.
//
// Values handed out are FROZEN defensively (the result object, its arrays,
// their rows, each row's `item` payload, and non-array object values like the
// strike row): read() hands the SAME object to every caller inside a TTL
// window, so an in-place sort or redaction by one consumer would corrupt it
// for the rest (the monitor's freezeReadout rationale).
//
// Scope truths a reader must not over-assume:
// - Busts are IN-PROCESS. One process serves one realm, which is the
//   deployment shape; during a deploy overlap a peer process converges on
//   the short TTLs instead (seconds), and the keys deliberately omit the
//   realm because each process constructs its own instance.
// - A null listing row is cached like any other answer (a probed missing id
//   stays 404-cheap); every in-process listing-creating path busts, so a
//   fresh listing is never hidden behind its own pre-warmed negative. The
//   detail keys ARE caller-minted (any positive id), unlike the fenced
//   browse and history keys: accepted asymmetry, because a probe walk's
//   evictions convert other viewers' hits into PRIMARY-KEY point reads
//   (listingById), not the OFFSET-walk or external-service costs the other
//   fences exist for, and the read limiter bounds the walk.
// - Every refresh thunk for a given key MUST be equivalent (the key encodes
//   every input the thunk varies on). The service call sites hold this by
//   construction: browse keys encode the whole query tuple, sales is gated
//   to the one default limit, and the row/activity thunks close over the key
//   itself.

import type { KeyedCachedReadStats } from './cached_read';
import { KeyedCachedRead } from './cached_read';
import type { WocBrowseQuery } from './woc_market';

/** Browse and detail: the win is CROSS-PLAYER sharing (every viewer of a
 *  page or a hot listing rides one read per TTL window), so the TTL matching
 *  the 3s awaiting-chain poll is fine: one player's own cadence missing the
 *  window does not matter when N players share the entry. The cached set is
 *  exactly the UNFILTERED shallow pages (EVERY filter axis bypasses, the
 *  service gate): 3 pages x 4 sorts = 12 live keys, the one view every
 *  browsing player shares and the client poll re-asks. The cap is generous
 *  against that space on purpose; a filtered browse is a per-user,
 *  click-driven, uncached lookup whose bound is the read limiter. Whoever
 *  loosens the service gate re-does this arithmetic and re-prices the
 *  memory (each live entry holds a page of 25 full listing rows, the
 *  me-cache rule). */
export const WOC_MARKET_BROWSE_CACHE_TTL_MS = 3_000;
export const WOC_MARKET_BROWSE_CACHE_MAX_ENTRIES = 192;
/** Only the SHALLOW pages are cached (page <= this). The page number is
 *  caller-chosen up to the route's 400-page clamp, so without the fence one
 *  reader inside the 240/min budget could mint enough distinct page keys to
 *  churn the whole LRU, and every resulting miss is the expensive
 *  OFFSET-walk read the page clamp exists to bound. The cross-player win
 *  lives entirely in the first pages; a deep page is a per-user lookup whose
 *  bound is the limiter (the itemIds-filter bypass, same reasoning). */
export const WOC_MARKET_BROWSE_CACHE_MAX_PAGE = 2;
export const WOC_MARKET_DETAIL_CACHE_TTL_MS = 3_000;
export const WOC_MARKET_DETAIL_CACHE_MAX_ENTRIES = 256;
export const WOC_MARKET_HISTORY_CACHE_TTL_MS = 10_000;
export const WOC_MARKET_HISTORY_CACHE_MAX_ENTRIES = 256;
// Seller keys are FREE TEXT (the route screens shape, not vocabulary), so
// unlike the item arm there is no closed key set: the LRU bound is what makes
// junk names churn, never grow, and a churned entry degrades to the indexed
// capped read underneath.
export const WOC_MARKET_SELLER_CACHE_MAX_ENTRIES = 256;
/** The activity readout is per account, so there is no cross-player win and
 *  the TTL is DELIBERATELY at the poll cadence, not above it: its job is to
 *  collapse bursts (open() racing the poll, a second window), while every
 *  poll beat still reads the player's live payment state; a longer TTL
 *  would trade payment-state visibility for hit rate on a surface whose
 *  real fix was sequencing the fan-out. */
export const WOC_MARKET_ME_CACHE_TTL_MS = 2_000;
/** Caps are ENTRY counts, not bytes, and this surface holds the heavy value:
 *  a readout carries up to 12 listing rows (full item payloads) plus 50 bids
 *  and 50 settlements, so 512 warm accounts is on the order of 10 to 20 MB
 *  resident on the box that also runs the realm sim. Entries are only minted
 *  by real polls and the LRU evicts idle accounts; whoever raises a cap here
 *  is buying memory, not just hit rate. */
export const WOC_MARKET_ME_CACHE_MAX_ENTRIES = 512;

/** The canonical browse cache key. Field-by-field, never JSON.stringify of
 *  the object: key equality must not depend on property insertion order. The
 *  \x1f separator cannot appear in any component: the route screens itemIds
 *  to the closed item-id charset (ITEM_ID_SHAPE, sorted and de-duplicated)
 *  and the rest are enum words and clamped integers. Belt only today: the
 *  service consults the cache ONLY for itemIds === null queries, so the
 *  itemIds component is always empty in a live key; it stays in the builder
 *  so lifting that gate can never silently merge distinct filters. */
export function wocBrowseCacheKey(q: WocBrowseQuery): string {
  return [
    String(q.page),
    String(q.pageSize),
    q.sort,
    q.quality ?? '',
    q.format ?? '',
    q.category ?? '',
    q.subcategory ?? '',
    q.itemIds === null ? '' : q.itemIds.join(','),
  ].join('\x1f');
}

/** Defensive freezing of the shared value: the result, its arrays, their
 *  rows, each row's `item` payload (the one nested object handlers could
 *  plausibly redact in place), and non-array object values (the activity
 *  readout's strike row). Deliberately not a full deep walk: freezing every
 *  cached byte per refresh is the cost this stops at, and anything deeper
 *  than a row's item has no mutating consumer to guard against. */
function freezeRow(row: unknown): void {
  if (row === null || typeof row !== 'object') return;
  const item = (row as { item?: unknown }).item;
  if (item !== null && typeof item === 'object') Object.freeze(item);
  Object.freeze(row);
}

function freezeShared<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const inner of Object.values(value as Record<string, unknown>)) {
    if (Array.isArray(inner)) {
      for (const row of inner) freezeRow(row);
      Object.freeze(inner);
    } else if (inner !== null && typeof inner === 'object') {
      Object.freeze(inner);
    }
  }
  if (Array.isArray(value)) {
    for (const row of value as unknown[]) freezeRow(row);
  }
  freezeRow(value);
  return value;
}

/** A keyed cache whose refresh thunk arrives PER CALL (the service passes a
 *  closure over its own uncached read), kept in a registry the constructor
 *  refresh dispatches through. Every read() installs its thunk first, so a
 *  TTL-expiry refresh started inside that read always finds it; the registry
 *  is pruned against the cache's own key set so it can never outgrow the LRU
 *  bound it mirrors. */
class ThunkKeyedCache<K extends string | number> {
  private readonly cache: KeyedCachedRead<unknown, K>;
  private readonly refreshers = new Map<K, () => Promise<unknown>>();

  constructor(private readonly opts: { ttlMs: number; maxEntries: number; now?: () => number }) {
    this.cache = new KeyedCachedRead<unknown, K>((key) => {
      const refresh = this.refreshers.get(key);
      // No key in the message: browse and history keys carry caller-supplied
      // text, and this error can reach the raw stale-serve warn in
      // cached_read.ts (the log-forging discipline).
      if (!refresh) throw new Error('woc market read cache has no refresh for this key');
      return refresh().then(freezeShared);
    }, opts);
  }

  read<T>(key: K, refresh: () => Promise<T>): Promise<T> {
    this.refreshers.set(key, refresh);
    const flight = this.cache.read(key) as Promise<T>;
    // Prune AFTER starting the read, never before: the cache inserts this
    // key's entry synchronously ahead of its flight, so only now is the
    // sweep guaranteed not to drop the thunk of the very read it is part of
    // (pruning first did exactly that once the registry crossed the
    // threshold, which the churn-bound test reproduces).
    if (this.refreshers.size > this.opts.maxEntries * 2) {
      for (const k of this.refreshers.keys()) {
        if (!this.cache.has(k)) this.refreshers.delete(k);
      }
    }
    return flight;
  }

  bust(key: K): void {
    this.cache.bust(key);
  }

  bustAll(): void {
    this.cache.bustAll();
  }

  stats(): KeyedCachedReadStats & { refreshRegistry: number } {
    // refreshRegistry rides along so the registry's bound is observable (and
    // pinned) rather than claimed. The steady-state bound is 2x maxEntries,
    // NOT maxEntries: orphaned thunks from evicted or failed-mint keys sit
    // until the next threshold crossing, so a reading above the LRU cap is
    // normal, not a leak. The prune itself is O(registry) once per
    // threshold crossing, amortized to O(1) per read at today's caps.
    return { ...this.cache.stats(), refreshRegistry: this.refreshers.size };
  }
}

// ---------------------------------------------------------------------------
// The one cross-domain bust: a wallet link or unlink changes the activity
// readout's `wallet` field, and identity changes must not wait out a TTL
// (the moderation-bust rule's spirit). The write sites live in server/db.ts,
// which cannot hold the instance, so main.ts registers it here at boot (the
// discord_status_cache shape, instance-flavored).
// ---------------------------------------------------------------------------

let registeredForBusts: WocMarketReadCache | null = null;

/** LAST registration wins (one live server per process is the shape); pass
 *  null on shutdown or test teardown so a dead instance is never pinned. */
export function registerWocMarketReadCacheForBusts(cache: WocMarketReadCache | null): void {
  registeredForBusts = cache;
}

/** Drop one account's cached activity readout (wallet link/unlink writes). */
export function bustWocMarketActivity(accountId: number): void {
  registeredForBusts?.bustMe(accountId);
}

export interface WocMarketReadCacheOptions {
  /** Injected clock for tests; production callers omit it (Date.now). */
  now?: () => number;
  /** Test-only TTL overrides; production callers omit them. */
  browseTtlMs?: number;
  detailTtlMs?: number;
  historyTtlMs?: number;
  meTtlMs?: number;
}

export class WocMarketReadCache {
  private readonly browsePages: ThunkKeyedCache<string>;
  private readonly listingRows: ThunkKeyedCache<number>;
  private readonly salesByItem: ThunkKeyedCache<string>;
  private readonly salesBySeller: ThunkKeyedCache<string>;
  private readonly meByAccount: ThunkKeyedCache<number>;

  constructor(opts: WocMarketReadCacheOptions = {}) {
    this.browsePages = new ThunkKeyedCache({
      ttlMs: opts.browseTtlMs ?? WOC_MARKET_BROWSE_CACHE_TTL_MS,
      maxEntries: WOC_MARKET_BROWSE_CACHE_MAX_ENTRIES,
      now: opts.now,
    });
    this.listingRows = new ThunkKeyedCache({
      ttlMs: opts.detailTtlMs ?? WOC_MARKET_DETAIL_CACHE_TTL_MS,
      maxEntries: WOC_MARKET_DETAIL_CACHE_MAX_ENTRIES,
      now: opts.now,
    });
    this.salesByItem = new ThunkKeyedCache({
      ttlMs: opts.historyTtlMs ?? WOC_MARKET_HISTORY_CACHE_TTL_MS,
      maxEntries: WOC_MARKET_HISTORY_CACHE_MAX_ENTRIES,
      now: opts.now,
    });
    this.salesBySeller = new ThunkKeyedCache({
      ttlMs: opts.historyTtlMs ?? WOC_MARKET_HISTORY_CACHE_TTL_MS,
      maxEntries: WOC_MARKET_SELLER_CACHE_MAX_ENTRIES,
      now: opts.now,
    });
    this.meByAccount = new ThunkKeyedCache({
      ttlMs: opts.meTtlMs ?? WOC_MARKET_ME_CACHE_TTL_MS,
      maxEntries: WOC_MARKET_ME_CACHE_MAX_ENTRIES,
      now: opts.now,
    });
  }

  browse<T>(q: WocBrowseQuery, refresh: () => Promise<T>): Promise<T> {
    return this.browsePages.read(wocBrowseCacheKey(q), refresh);
  }

  listingRow<T>(id: number, refresh: () => Promise<T>): Promise<T> {
    return this.listingRows.read(id, refresh);
  }

  sales<T>(itemId: string, refresh: () => Promise<T>): Promise<T> {
    return this.salesByItem.read(itemId, refresh);
  }

  sellerSales<T>(sellerName: string, refresh: () => Promise<T>): Promise<T> {
    return this.salesBySeller.read(sellerName, refresh);
  }

  myActivity<T>(account: number, refresh: () => Promise<T>): Promise<T> {
    return this.meByAccount.read(account, refresh);
  }

  /** The listings surface changed (a listing created, cancelled, bid on,
   *  bought, suspended, or a directed deal escrowed one): browse pages and
   *  listing rows both restate it, so both drop. Coarse ON PURPOSE: a finer
   *  map would be a second copy of which mutation touches which page.
   *  Honest arithmetic: the mutation limiters are PER ACCOUNT, so a busy
   *  realm's combined bust rate can pass one per TTL at peak, and the cache
   *  then degrades toward one shared read per mutation window, NOT toward
   *  per-request reads: single-flight still collapses every concurrent
   *  reader between busts, which is the load-bearing win. The per-surface
   *  counters on the internal stuck readout are how that degradation is
   *  measured rather than guessed (the pre-enable audit checks them at a
   *  realistic mutation rate). */
  bustListings(): void {
    this.browsePages.bustAll();
    this.listingRows.bustAll();
  }

  bustMe(account: number): void {
    this.meByAccount.bust(account);
  }

  /** The whole history map drops: the sale-exclusion moderation arm knows
   *  only the sale id, not the item (rare, and enforcement must not wait out
   *  a TTL: the cached-read moderation-bust rule), and the eager-delivery
   *  confirm path busts here too rather than carry a per-item variant no
   *  production caller needed. */
  bustHistoryAll(): void {
    this.salesByItem.bustAll();
    // The seller pivot restates the same sale rows, so every history bust
    // (sale exclusion, eager delivery) drops it in the same stroke.
    this.salesBySeller.bustAll();
  }

  /** Everything at once (tests; also the honest lever if an operator action
   *  ever needs a full drop). */
  bustAll(): void {
    this.browsePages.bustAll();
    this.listingRows.bustAll();
    this.salesByItem.bustAll();
    this.salesBySeller.bustAll();
    this.meByAccount.bustAll();
  }

  stats(): {
    browse: KeyedCachedReadStats & { refreshRegistry: number };
    detail: KeyedCachedReadStats & { refreshRegistry: number };
    history: KeyedCachedReadStats & { refreshRegistry: number };
    seller: KeyedCachedReadStats & { refreshRegistry: number };
    me: KeyedCachedReadStats & { refreshRegistry: number };
  } {
    return {
      browse: this.browsePages.stats(),
      detail: this.listingRows.stats(),
      history: this.salesByItem.stats(),
      seller: this.salesBySeller.stats(),
      me: this.meByAccount.stats(),
    };
  }
}
