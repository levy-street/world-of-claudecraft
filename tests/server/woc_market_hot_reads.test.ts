// The H11 hot-read guards, end to end: the service reading THROUGH the
// injected WocMarketReadCache (burst collapse, key isolation, the
// directed-listing party gate surviving a warm cache), the sequenced
// activity fan-out's one-client bound, the route-layer busts, and the read
// limiter's mounting and refusal. The cache-key probes here are the
// two-session tests the QA file demands: two viewers, one warm cache, and
// the answer may never widen.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rateLimit, WOC_MARKET_READ_POLICY } from '../../server/http/middleware/rate_limit';
import {
  resetRateLimitClock,
  resetWocMarketMutationRateLimits,
  setRateLimitClock,
  WOC_MARKET_READ_MAX_PER_MINUTE,
} from '../../server/ratelimit';
import type { WocMarketDb, WocMarketDeps, WocMarketService } from '../../server/woc_market';
import {
  BOND_PAYOUT_BUDGET_MS,
  WocMarketService as RealWocMarketService,
  WOC_MARKET_ME_READOUT_DEADLINE_MS,
} from '../../server/woc_market';
import { WocWireDriftWarner } from '../../server/woc_market_drift_warn';
import { createDevWocMarketEconomy } from '../../server/woc_market_proxy';
import {
  bustWocMarketActivity,
  registerWocMarketReadCacheForBusts,
  WOC_MARKET_BROWSE_CACHE_MAX_PAGE,
  WocMarketReadCache,
} from '../../server/woc_market_read_cache';
import {
  configureWocMarketRuntime,
  resetWocMarketRuntimeForTests,
  routes,
} from '../../server/woc_market_routes';
import {
  WOC_MARKET_RESTRICTED_POLICY,
  WOC_MARKET_WIRE_FAIL_REASONS,
  WOC_MARKET_WIRE_PENDING_REASONS,
} from '../../server/woc_market_rules';
import { ITEMS } from '../../src/sim/data';
import { fakeCtx } from './helpers';

const REALM = 'Claudemoon';
const BASE_MS = 1_820_000_000_000;

const BROWSE_Q = {
  page: 0,
  pageSize: 25,
  quality: null,
  format: null,
  category: null,
  subcategory: null,
  itemIds: null,
  sort: 'ending',
} as const;

/** A minimal listing row: only the fields the detail path and views read. */
function listingRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 4,
    realm: REALM,
    directedBuyerAccount: null,
    sellerAccount: 3,
    sellerName: 'Selara',
    item: { itemId: 'sunblade', count: 1 },
    itemId: 'sunblade',
    quality: 'epic',
    format: 'auction',
    startCents: 5000,
    reserveCents: null,
    buyNowCents: null,
    offerNext: false,
    status: 'active',
    resolution: null,
    currentBidCents: null,
    buyNowLockAccount: null,
    buyNowLockExpiresMs: null,
    cancelRequestedAtMs: null,
    endsAtMs: BASE_MS + 3_600_000,
    createdAtMs: BASE_MS,
    ...over,
  };
}

/** A service over a PARTIAL db stub (the wire-pins partial-injection idiom):
 *  each test defines only the reads it drives, and a read the test did not
 *  expect throws loudly instead of vanishing into a default. */
function makeService(
  dbStub: Partial<Record<string, unknown>>,
  opts: {
    readCache?: WocMarketReadCache;
    verifiedWallet?: (a: number) => Promise<string | null>;
  } = {},
): WocMarketService {
  const clock = BASE_MS;
  const deps: WocMarketDeps = {
    db: dbStub as unknown as WocMarketDb,
    economy: createDevWocMarketEconomy(() => clock),
    custody: {
      // Reads never touch custody; a call here is a test bug.
      get sim() {
        throw new Error('custody not exercised by hot reads');
      },
    } as unknown as WocMarketDeps['custody'],
    verifiedWallet: opts.verifiedWallet ?? (async () => null),
    balanceTokens: async () => null,
    stepUpDevSig: true,
    config: {
      enabled: true,
      realm: REALM,
      policy: WOC_MARKET_RESTRICTED_POLICY,
      confirmingReviewMs: 6 * 3600 * 1000,
    },
    ...(opts.readCache ? { readCache: opts.readCache } : {}),
    now: () => clock,
  };
  void clock;
  return new RealWocMarketService(deps);
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => {
  resetWocMarketRuntimeForTests();
  resetWocMarketMutationRateLimits();
  resetRateLimitClock();
});

describe('service reads through the cache', () => {
  it('collapses a concurrent browse burst into ONE db read', async () => {
    const gate = deferred<{ rows: never[]; hasMore: boolean }>();
    const browseListings = vi.fn(() => gate.promise);
    const service = makeService(
      { browseListings },
      { readCache: new WocMarketReadCache({ now: () => BASE_MS }) },
    );
    const reads = [service.browse(BROWSE_Q), service.browse(BROWSE_Q), service.browse(BROWSE_Q)];
    expect(browseListings).toHaveBeenCalledTimes(1);
    gate.resolve({ rows: [], hasMore: false });
    await Promise.all(reads);
    expect(browseListings).toHaveBeenCalledTimes(1);
    // And the query shape still reaches the db intact on the one real read.
    expect(browseListings).toHaveBeenCalledWith(REALM, BROWSE_Q);
  });

  it('without the injected cache every browse read hits the db (the optionality contract)', async () => {
    const browseListings = vi.fn(async () => ({ rows: [], hasMore: false }));
    const service = makeService({ browseListings });
    await service.browse(BROWSE_Q);
    await service.browse(BROWSE_Q);
    expect(browseListings).toHaveBeenCalledTimes(2);
  });

  it('the directed-listing party gate runs per request OVER the warm cache: a stranger still reads null', async () => {
    const directed = listingRow({ directedBuyerAccount: 8 });
    const listingById = vi.fn(async () => directed);
    const service = makeService(
      { listingById },
      { readCache: new WocMarketReadCache({ now: () => BASE_MS }) },
    );
    // The buyer party warms the cache and sees the listing.
    const forBuyer = await service.listingDetail(4, 8);
    expect(forBuyer?.listing.id).toBe(4);
    // A stranger reads the SAME warm cache entry and must still get the
    // missing-id answer: the shared row never widens who sees a directed
    // sale (and the db was asked exactly once, proving the entry WAS shared).
    const forStranger = await service.listingDetail(4, 9);
    expect(forStranger).toBeNull();
    // The seller party still sees it warm too.
    const forSeller = await service.listingDetail(4, 3);
    expect(forSeller?.listing.id).toBe(4);
    expect(listingById).toHaveBeenCalledTimes(1);
  });

  it('sales history is keyed per item and shared across callers (known items only)', async () => {
    const [itemA, itemB] = Object.keys(ITEMS);
    const salesForItem = vi.fn(async (_realm: string, itemId: string) => [{ id: 1, itemId }]);
    const service = makeService(
      { salesForItem },
      { readCache: new WocMarketReadCache({ now: () => BASE_MS }) },
    );
    await service.salesHistory(itemA);
    await service.salesHistory(itemA);
    await service.salesHistory(itemB);
    expect(salesForItem).toHaveBeenCalledTimes(2);
  });

  it('sales history bypasses the cache for a non-default limit WITHOUT poisoning the shared key', async () => {
    const [itemA] = Object.keys(ITEMS);
    const salesForItem = vi.fn(async (_realm: string, _itemId: string, limit: number) =>
      Array.from({ length: Math.min(limit, 3) }, (_, i) => ({ id: i })),
    );
    const service = makeService(
      { salesForItem },
      { readCache: new WocMarketReadCache({ now: () => BASE_MS }) },
    );
    const first = await service.salesHistory(itemA);
    // The odd limit pays its own read...
    await service.salesHistory(itemA, 2);
    expect(salesForItem).toHaveBeenCalledTimes(2);
    // ...and the shared default-limit entry is untouched by it.
    const again = await service.salesHistory(itemA);
    expect(again).toBe(first);
    expect(salesForItem).toHaveBeenCalledTimes(2);
  });

  it('sales history for an UNKNOWN item id never occupies a cache slot', async () => {
    const salesForItem = vi.fn(async () => []);
    const service = makeService(
      { salesForItem },
      { readCache: new WocMarketReadCache({ now: () => BASE_MS }) },
    );
    await service.salesHistory('zz_not_a_real_item_zz');
    await service.salesHistory('zz_not_a_real_item_zz');
    // Uncached both times: free-text ids must not evict real items' entries.
    expect(salesForItem).toHaveBeenCalledTimes(2);
  });

  it('an item-filtered browse bypasses the cache (filter lists are caller-minted key entropy)', async () => {
    const browseListings = vi.fn(async () => ({ rows: [], hasMore: false }));
    const service = makeService(
      { browseListings },
      { readCache: new WocMarketReadCache({ now: () => BASE_MS }) },
    );
    const filtered = { ...BROWSE_Q, itemIds: ['sunblade_of_dawn'] };
    await service.browse(filtered);
    await service.browse(filtered);
    expect(browseListings).toHaveBeenCalledTimes(2);
    // The unfiltered page still caches beside it.
    await service.browse(BROWSE_Q);
    await service.browse(BROWSE_Q);
    expect(browseListings).toHaveBeenCalledTimes(3);
  });
});

describe('the activity fan-out', () => {
  function countingActivityDb() {
    let inFlight = 0;
    let peak = 0;
    const gauge = async <T>(value: T): Promise<T> => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      // Two microtask hops: enough that a Promise.all fan-out would overlap
      // here, so the peak gauge is decisive against a regression to parallel.
      await Promise.resolve();
      await Promise.resolve();
      inFlight--;
      return value;
    };
    return {
      peak: () => peak,
      db: {
        listingsBySeller: vi.fn((_r: string, _a: number) => gauge([])),
        bidsByAccount: vi.fn((_r: string, _a: number, _l: number) => gauge([])),
        settlementsByAccount: vi.fn((_r: string, _a: number, _l: number) => gauge([])),
        strikeInfo: vi.fn((_a: number) => gauge(null)),
        termsAcceptedAt: vi.fn((_a: number) => gauge(null)),
      },
      gauge,
    };
  }

  it('holds at most ONE read in flight at a time (the pool-hold bound, counted)', async () => {
    const counting = countingActivityDb();
    const service = makeService(counting.db, {
      verifiedWallet: (a) => counting.gauge(a === 7 ? 'wallet-7' : null),
    });
    const out = await service.myActivity(7);
    // All six reads ran, each exactly once (a silently dropped read would
    // keep the peak honest while shrinking the readout; a seventh read
    // added later must move these counts in the same change)...
    expect(counting.db.listingsBySeller).toHaveBeenCalledTimes(1);
    expect(counting.db.bidsByAccount).toHaveBeenCalledTimes(1);
    expect(counting.db.settlementsByAccount).toHaveBeenCalledTimes(1);
    expect(counting.db.strikeInfo).toHaveBeenCalledTimes(1);
    expect(counting.db.termsAcceptedAt).toHaveBeenCalledTimes(1);
    expect(out.wallet).toBe('wallet-7');
    // ...and never two at once: the six-way Promise.all drew six of the
    // shared pool's ten clients per request, which is the H11 finding.
    expect(counting.peak()).toBe(1);
  });

  it('caches the readout per account with the account as the key', async () => {
    const counting = countingActivityDb();
    const cache = new WocMarketReadCache({ now: () => BASE_MS });
    const service = makeService(counting.db, {
      readCache: cache,
      verifiedWallet: (a) => counting.gauge(a === 7 ? 'wallet-7' : null),
    });
    const seven = await service.myActivity(7);
    const eight = await service.myActivity(8);
    expect(seven.wallet).toBe('wallet-7');
    // Account 8's readout is its own entry, never account 7's warm one.
    expect(eight.wallet).toBeNull();
    // A warm re-read serves account 7 without touching the db again.
    const calls = counting.db.strikeInfo.mock.calls.length;
    const sevenAgain = await service.myActivity(7);
    expect(sevenAgain).toBe(seven);
    expect(counting.db.strikeInfo.mock.calls.length).toBe(calls);
  });
});

describe('route-layer busts (the full handler-to-surface table)', () => {
  function handlerFor(method: string, routePath: string) {
    const route = routes.find((r) => r.method === method && r.path === routePath);
    if (!route) throw new Error(`no route ${method} ${routePath}`);
    return route.handler;
  }

  /** Fixtures rich enough for the wire views the handlers build. */
  function fullListing(over: Record<string, unknown> = {}): Record<string, unknown> {
    return listingRow({ cancelRequestedAtMs: null, ...over });
  }
  const bidRow = {
    id: 9,
    listingId: 4,
    amountCents: 5000,
    status: 'pending_bond',
    bondCents: 250,
    bondState: 'pending',
    bondReference: null,
    bondQuoteExpiresAtMs: null,
    bondSignature: null,
    placedAtMs: BASE_MS,
  };
  const settlementRow = {
    id: 21,
    listingId: 4,
    attempt: 1,
    amountCents: 5000,
    state: 'offered',
    quoteReference: null,
    quoteExpiresAtMs: null,
    failReason: null,
    deadlineAtMs: BASE_MS + 600_000,
    createdAtMs: BASE_MS,
  };
  const quoteIntent = {
    ok: true,
    reference: 'ref-1',
    transactionBase64: 'dHg=',
    signatureRequired: true,
    amount: { base: '1', tokens: 1 },
    seller: null,
    burn: null,
    treasury: null,
    bondCents: 250,
    expiresAtMs: BASE_MS + 90_000,
  };
  const offerRow = {
    id: 5,
    sellerName: 'Selara',
    buyerName: 'Aldan',
    itemId: 'sunblade',
    usdCents: 5000,
    status: 'pending',
    listingId: null,
    expiresAtMs: BASE_MS + 600_000,
    listingStatus: null,
    listingResolution: null,
    settlementState: null,
    buyerAccepted: true,
    sellerAccepted: false,
    buyerAccount: 7,
    sellerAccount: 8,
  };

  interface BustCase {
    name: string;
    method: string;
    path: string;
    ctx: () => ReturnType<typeof fakeCtx>;
    service: Record<string, unknown>;
    /** Which warmed surfaces the handler must drop; everything else must
     *  STAY WARM (a wrong-kind bust swap is the regression this catches). */
    cold: ReadonlyArray<'listings' | 'me7' | 'me8' | 'me9' | 'history'>;
    /** The handler THROWS (a refused mutation): the actor's readout must
     *  still drop (a refusal can follow committed state: recorded terms, a
     *  recorded signature), while the shared surfaces stay warm. */
    refuses?: true;
  }

  const post = (url: string, over: Record<string, unknown> = {}) =>
    fakeCtx({ method: 'POST', url, account: { accountId: 7, scope: 'full' }, ...over });

  const CASES: BustCase[] = [
    {
      name: 'createListing busts the listings surface and the seller readout',
      method: 'POST',
      path: '/api/woc-market/listings',
      ctx: () =>
        post('/api/woc-market/listings', {
          body: {
            characterId: 1,
            itemIndex: 0,
            itemId: 'sunblade',
            format: 'auction',
            startCents: 5000,
            durationHours: 24,
          },
        }),
      service: { createListing: async () => ({ ok: true, listing: fullListing() }) },
      cold: ['listings', 'me7'],
    },
    {
      name: 'cancelListing busts the listings surface and the seller readout',
      method: 'POST',
      path: '/api/woc-market/listings/:id/cancel',
      ctx: () => post('/api/woc-market/listings/4/cancel', { params: { id: '4' } }),
      service: { cancelListing: async () => ({ ok: true }) },
      cold: ['listings', 'me7'],
    },
    {
      name: 'placeBid busts the listings surface and the bidder readout',
      method: 'POST',
      path: '/api/woc-market/listings/:id/bids',
      ctx: () =>
        post('/api/woc-market/listings/4/bids', {
          params: { id: '4' },
          body: { characterId: 1, amountCents: 5000, acceptTerms: true },
        }),
      service: { placeBid: async () => ({ ok: true, bid: bidRow, bond: quoteIntent }) },
      cold: ['listings', 'me7'],
    },
    {
      name: 'bondQuote busts ONLY the bidder readout (no listings churn)',
      method: 'POST',
      path: '/api/woc-market/bids/:id/bond-quote',
      ctx: () => post('/api/woc-market/bids/9/bond-quote', { params: { id: '9' } }),
      service: { refreshBondQuote: async () => ({ ok: true, bond: quoteIntent }) },
      cold: ['me7'],
    },
    {
      name: 'confirmBond busts the listings surface and the bidder readout',
      method: 'POST',
      path: '/api/woc-market/bids/:id/bond',
      ctx: () =>
        post('/api/woc-market/bids/9/bond', {
          params: { id: '9' },
          body: { signature: 'devsig:abc' },
        }),
      service: { confirmBond: async () => ({ ok: true, standing: true }) },
      cold: ['listings', 'me7'],
    },
    {
      name: 'abandonBid busts the listings surface and the bidder readout',
      method: 'POST',
      path: '/api/woc-market/bids/:id/abandon',
      ctx: () => post('/api/woc-market/bids/9/abandon', { params: { id: '9' } }),
      service: { abandonBid: async () => ({ ok: true }) },
      cold: ['listings', 'me7'],
    },
    {
      name: 'buyNow busts the listings surface and the buyer readout',
      method: 'POST',
      path: '/api/woc-market/listings/:id/buy-now',
      ctx: () =>
        post('/api/woc-market/listings/4/buy-now', {
          params: { id: '4' },
          body: { characterId: 1, acceptTerms: true },
        }),
      service: {
        buyNow: async () => ({ ok: true, settlement: settlementRow, quote: quoteIntent }),
      },
      cold: ['listings', 'me7'],
    },
    {
      name: 'settlementQuote busts ONLY the buyer readout',
      method: 'POST',
      path: '/api/woc-market/settlements/:id/quote',
      ctx: () => post('/api/woc-market/settlements/21/quote', { params: { id: '21' } }),
      service: { settlementQuote: async () => ({ ok: true, quote: quoteIntent }) },
      cold: ['me7'],
    },
    {
      name: 'confirmSettlement busts the listings surface and the buyer readout',
      method: 'POST',
      path: '/api/woc-market/settlements/:id/confirm',
      ctx: () =>
        post('/api/woc-market/settlements/21/confirm', {
          params: { id: '21' },
          body: { signature: 'sig123' },
        }),
      // 'confirmed' means the EAGER delivery inserted the sale on this very
      // request, so the recorded history changed under a route mutation: the
      // whole history map drops (the arm knows only the settlement id).
      service: { confirmSettlement: async () => ({ ok: true, state: 'confirmed', reason: null }) },
      cold: ['listings', 'me7', 'history'],
    },
    {
      // Viewer 7, seller 8, directed buyer 9: THREE distinct accounts, so
      // each of the two conditional party busts is exercised on its own key
      // (aliasing the buyer to the viewer once let a wrong-field swap pass).
      name: 'acceptOffer with an escrowed listing busts the viewer AND both parties',
      method: 'POST',
      path: '/api/woc-market/offers/:id/accept',
      ctx: () =>
        post('/api/woc-market/offers/5/accept', {
          params: { id: '5' },
          body: { characterId: 1 },
        }),
      service: {
        acceptDirectedOffer: async () => ({
          ok: true,
          listing: fullListing({ sellerAccount: 8, directedBuyerAccount: 9 }),
        }),
      },
      cold: ['listings', 'me7', 'me8', 'me9'],
    },
    {
      name: 'acceptOffer with NO listing yet busts only the acting side',
      method: 'POST',
      path: '/api/woc-market/offers/:id/accept',
      ctx: () =>
        post('/api/woc-market/offers/5/accept', {
          params: { id: '5' },
          body: { characterId: 1 },
        }),
      service: { acceptDirectedOffer: async () => ({ ok: true, listing: null }) },
      cold: ['listings', 'me7'],
    },
    {
      name: 'createOffer busts the actor readout (guardTerms can record first-time consent)',
      method: 'POST',
      path: '/api/woc-market/offers',
      ctx: () =>
        post('/api/woc-market/offers', {
          body: {
            characterId: 1,
            sellerCharacterName: 'Selara',
            usdCents: 5000,
            itemId: 'sunblade',
            acceptTerms: true,
          },
        }),
      service: { createDirectedOffer: async () => ({ ok: true, offer: offerRow }) },
      cold: ['me7'],
    },
    {
      name: 'stepUpChallenge busts nothing (challenge state is not a cached surface)',
      method: 'POST',
      path: '/api/woc-market/step-up/challenge',
      ctx: () =>
        post('/api/woc-market/step-up/challenge', {
          body: { operation: 'accept_directed_offer', offerId: 5 },
        }),
      service: {
        issueStepUpChallenge: async () => ({
          ok: true,
          challenge: { challengeId: 3, message: 'm', expiresAtMs: BASE_MS + 60_000 },
        }),
      },
      cold: [],
    },
    {
      name: 'a REFUSED placeBid still busts the bidder readout, nothing shared',
      method: 'POST',
      path: '/api/woc-market/listings/:id/bids',
      ctx: () =>
        post('/api/woc-market/listings/4/bids', {
          params: { id: '4' },
          body: { characterId: 1, amountCents: 5000, acceptTerms: true },
        }),
      service: { placeBid: async () => ({ ok: false, reason: 'bid_too_low' }) },
      cold: ['me7'],
      refuses: true,
    },
    {
      name: 'a REFUSED confirmSettlement still busts the buyer readout (failed transition committed)',
      method: 'POST',
      path: '/api/woc-market/settlements/:id/confirm',
      ctx: () =>
        post('/api/woc-market/settlements/21/confirm', {
          params: { id: '21' },
          body: { signature: 'sig123' },
        }),
      service: { confirmSettlement: async () => ({ ok: false, reason: 'confirm_failed' }) },
      cold: ['me7'],
      refuses: true,
    },
    {
      name: 'a REFUSED createOffer still busts the actor readout (terms recorded before the refusal)',
      method: 'POST',
      path: '/api/woc-market/offers',
      ctx: () =>
        post('/api/woc-market/offers', {
          body: {
            characterId: 1,
            sellerCharacterName: 'Selara',
            usdCents: 5000,
            itemId: 'sunblade',
            acceptTerms: true,
          },
        }),
      service: { createDirectedOffer: async () => ({ ok: false, reason: 'self_offer' }) },
      cold: ['me7'],
      refuses: true,
    },
    // Every remaining mutating handler gets its refusal row too: the source
    // comment claims the actor-bust-on-refusal rule for ALL of them, and the
    // 25-call tripwire is order-blind, so only these rows pin the
    // bust-BEFORE-throw ordering per handler.
    {
      name: 'a REFUSED createListing still busts the seller readout, nothing shared',
      method: 'POST',
      path: '/api/woc-market/listings',
      ctx: () =>
        post('/api/woc-market/listings', {
          body: {
            characterId: 1,
            itemIndex: 0,
            itemId: 'sunblade',
            format: 'auction',
            startCents: 5000,
            durationHours: 24,
          },
        }),
      service: { createListing: async () => ({ ok: false, reason: 'unknown_item' }) },
      cold: ['me7'],
      refuses: true,
    },
    {
      name: 'a REFUSED cancelListing still busts the seller readout, nothing shared',
      method: 'POST',
      path: '/api/woc-market/listings/:id/cancel',
      ctx: () => post('/api/woc-market/listings/4/cancel', { params: { id: '4' } }),
      service: { cancelListing: async () => ({ ok: false, reason: 'not_found' }) },
      cold: ['me7'],
      refuses: true,
    },
    {
      name: 'a REFUSED bondQuote still busts the bidder readout (drift adoption commits)',
      method: 'POST',
      path: '/api/woc-market/bids/:id/bond-quote',
      ctx: () => post('/api/woc-market/bids/9/bond-quote', { params: { id: '9' } }),
      service: { refreshBondQuote: async () => ({ ok: false, reason: 'not_found' }) },
      cold: ['me7'],
      refuses: true,
    },
    {
      name: 'a REFUSED abandonBid still busts the bidder readout, nothing shared',
      method: 'POST',
      path: '/api/woc-market/bids/:id/abandon',
      ctx: () => post('/api/woc-market/bids/9/abandon', { params: { id: '9' } }),
      service: { abandonBid: async () => ({ ok: false, reason: 'not_found' }) },
      cold: ['me7'],
      refuses: true,
    },
    {
      name: 'a REFUSED confirmBond still busts the bidder readout (signature recorded first)',
      method: 'POST',
      path: '/api/woc-market/bids/:id/bond',
      ctx: () =>
        post('/api/woc-market/bids/9/bond', {
          params: { id: '9' },
          body: { signature: 'devsig:abc' },
        }),
      service: { confirmBond: async () => ({ ok: false, reason: 'confirm_failed' }) },
      cold: ['me7'],
      refuses: true,
    },
    {
      name: 'a REFUSED buyNow still busts the buyer readout (settlement can insert then expire)',
      method: 'POST',
      path: '/api/woc-market/listings/:id/buy-now',
      ctx: () =>
        post('/api/woc-market/listings/4/buy-now', {
          params: { id: '4' },
          body: { characterId: 1, acceptTerms: true },
        }),
      service: { buyNow: async () => ({ ok: false, reason: 'quote_unavailable' }) },
      cold: ['me7'],
      refuses: true,
    },
    {
      name: 'a REFUSED settlementQuote still busts the buyer readout, nothing shared',
      method: 'POST',
      path: '/api/woc-market/settlements/:id/quote',
      ctx: () => post('/api/woc-market/settlements/21/quote', { params: { id: '21' } }),
      service: { settlementQuote: async () => ({ ok: false, reason: 'not_found' }) },
      cold: ['me7'],
      refuses: true,
    },
    {
      name: 'a REFUSED acceptOffer still busts the acting side only',
      method: 'POST',
      path: '/api/woc-market/offers/:id/accept',
      ctx: () =>
        post('/api/woc-market/offers/5/accept', {
          params: { id: '5' },
          body: { characterId: 1 },
        }),
      service: { acceptDirectedOffer: async () => ({ ok: false, reason: 'not_found' }) },
      cold: ['me7'],
      refuses: true,
    },
    {
      name: 'a confirmSettlement still CONFIRMING busts listings and buyer, never history',
      method: 'POST',
      path: '/api/woc-market/settlements/:id/confirm',
      ctx: () =>
        post('/api/woc-market/settlements/21/confirm', {
          params: { id: '21' },
          body: { signature: 'sig123' },
        }),
      // The history drop is gated on the DECIDED 'confirmed' answer (the
      // eager delivery's sale insert); an undecided confirm changed no sale.
      service: {
        confirmSettlement: async () => ({
          ok: true,
          state: 'confirming',
          reason: 'not_yet_visible',
        }),
      },
      cold: ['listings', 'me7'],
    },
    {
      name: 'declineOffer busts nothing',
      method: 'POST',
      path: '/api/woc-market/offers/:id/decline',
      ctx: () => post('/api/woc-market/offers/5/decline', { params: { id: '5' } }),
      service: { resolveDirectedOffer: async () => ({ ok: true }) },
      cold: [],
    },
    {
      name: 'withdrawOffer busts nothing',
      method: 'POST',
      path: '/api/woc-market/offers/:id/withdraw',
      ctx: () => post('/api/woc-market/offers/5/withdraw', { params: { id: '5' } }),
      service: { resolveDirectedOffer: async () => ({ ok: true }) },
      cold: [],
    },
    {
      name: 'adminSuspendListing busts the listings surface and nothing player-scoped',
      method: 'POST',
      path: '/admin/api/woc-market/listings/:id/suspend',
      ctx: () => {
        const ctx = fakeCtx({ method: 'POST', url: '/admin/api/woc-market/listings/4/suspend' });
        ctx.state.set('adminTargetId', 4);
        return ctx;
      },
      service: { adminSuspendListing: async () => ({ ok: true }) },
      cold: ['listings'],
    },
    {
      name: 'adminSaleExcluded busts HISTORY, never the listings surface',
      method: 'POST',
      path: '/admin/api/woc-market/sales/:id/excluded',
      ctx: () => {
        const ctx = fakeCtx({
          method: 'POST',
          url: '/admin/api/woc-market/sales/6/excluded',
          body: { excluded: true },
        });
        ctx.state.set('adminTargetId', 6);
        return ctx;
      },
      service: { adminSetSaleExcluded: async () => ({ ok: true }) },
      cold: ['history'],
    },
    {
      name: 'adminClearStrikes busts the target readout only',
      method: 'POST',
      path: '/admin/api/woc-market/accounts/:id/clear-strikes',
      ctx: () => {
        const ctx = fakeCtx({
          method: 'POST',
          url: '/admin/api/woc-market/accounts/7/clear-strikes',
        });
        ctx.state.set('adminTargetId', 7);
        return ctx;
      },
      service: { adminClearStrikes: async () => ({ ok: true }) },
      cold: ['me7'],
    },
  ];

  for (const testCase of CASES) {
    it(testCase.name, async () => {
      const cache = new WocMarketReadCache({ now: () => BASE_MS });
      let generation = 1;
      // Warm every surface at generation 1, then bump: a surface that still
      // answers 1 stayed warm, one that answers 2 was busted. No TTL is in
      // play, so the bust alone decides.
      const probes = {
        browse: () => cache.browse(BROWSE_Q, async () => ({ generation })),
        row: () => cache.listingRow(4, async () => ({ generation })),
        me7: () => cache.myActivity(7, async () => ({ generation })),
        me8: () => cache.myActivity(8, async () => ({ generation })),
        me9: () => cache.myActivity(9, async () => ({ generation })),
        history: () => cache.sales('sunblade', async () => ({ generation })),
      } as const;
      for (const warm of Object.values(probes)) await warm();
      configureWocMarketRuntime({
        service: testCase.service as unknown as WocMarketService,
        readCache: cache,
      });
      if (testCase.refuses) {
        // The refusal must still surface to the pipeline (the bust is a side
        // effect of the attempt, never a swallow of the refusal).
        await expect(handlerFor(testCase.method, testCase.path)(testCase.ctx())).rejects.toThrow();
      } else {
        await handlerFor(testCase.method, testCase.path)(testCase.ctx());
      }
      generation = 2;
      const expectGen = async (
        probe: () => Promise<unknown>,
        surface: 'listings' | 'me7' | 'me8' | 'me9' | 'history',
      ) => {
        const value = (await probe()) as { generation?: number } & {
          rows?: { generation: number }[];
        };
        const got = value.rows ? value.rows[0]?.generation : value.generation;
        expect(got, `${surface} for ${testCase.name}`).toBe(
          testCase.cold.includes(surface) ? 2 : 1,
        );
      };
      await expectGen(probes.browse, 'listings');
      await expectGen(probes.row, 'listings');
      await expectGen(probes.me7, 'me7');
      await expectGen(probes.me8, 'me8');
      await expectGen(probes.me9, 'me9');
      await expectGen(probes.history, 'history');
    });
  }

  it('every bust call in the routes source is accounted for (count tripwire)', () => {
    const src = readFileSync(
      path.join(__dirname, '..', '..', 'server', 'woc_market_routes.ts'),
      'utf8',
    );
    const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    // 25 = eight mutations at two busts each (the actor bust now precedes
    // the refusal throw), the two quote refreshes at one, createOffer's
    // actor bust, the three moderation arms at one each, acceptOffer's two
    // extra party busts, and confirmSettlement's eager-delivery history
    // drop. The TABLE above is the behavioral authority (it catches a
    // wrong-kind swap); this count only catches a call deleted wholesale.
    expect(code.match(/readCache\(\)\?\.bust/g)).toHaveLength(25);
  });

  it('handlers render cleanly over FROZEN cached values, twice in a row', async () => {
    // The freeze turns an in-place mutation by a handler into a thrown
    // TypeError on the SECOND request of a TTL window; this drives the two
    // read handlers through a REAL service and REAL cache to prove none
    // mutates today.
    const knownItem = Object.keys(ITEMS)[0];
    const cache = new WocMarketReadCache({ now: () => BASE_MS });
    const service = makeService(
      {
        browseListings: async () => ({ rows: [fullListing()], hasMore: false }),
        listingById: async () => fullListing({ id: 4, itemId: knownItem }),
        salesForItem: async () => [
          {
            id: 6,
            itemId: knownItem,
            priceCents: 5000,
            sellerName: 'Selara',
            buyerName: 'Aldan',
            atMs: BASE_MS,
          },
        ],
        listingsBySeller: async () => [fullListing()],
        bidsByAccount: async () => [{ ...bidRow, itemId: 'sunblade' }],
        settlementsByAccount: async () => [{ ...settlementRow, itemId: 'sunblade' }],
        strikeInfo: async () => ({ strikes: 1, suspendedUntilMs: null }),
        termsAcceptedAt: async () => BASE_MS,
      },
      { readCache: cache },
    );
    configureWocMarketRuntime({ service, readCache: cache });
    // All four cached read surfaces render twice over the warm shared value:
    // detail exercises the estimateView leg and history exercises saleView,
    // which a listings+me-only loop left unproven against the freeze.
    for (const [method, routePath, url, params] of [
      ['GET', '/api/woc-market/listings', '/api/woc-market/listings', {}],
      ['GET', '/api/woc-market/me', '/api/woc-market/me', {}],
      ['GET', '/api/woc-market/listings/:id', '/api/woc-market/listings/4', { id: '4' }],
      [
        'GET',
        '/api/woc-market/history/:itemId',
        `/api/woc-market/history/${knownItem}`,
        { itemId: knownItem },
      ],
    ] as const) {
      for (let round = 0; round < 2; round++) {
        const ctx = fakeCtx({ url, params, account: { accountId: 7, scope: 'read' } });
        await handlerFor(method, routePath)(ctx);
        const res = ctx.res as unknown as { statusCode: number };
        expect(res.statusCode, `${routePath} round ${round + 1}`).toBe(200);
      }
    }
  });
});

describe('the sweep segment plan', () => {
  it('pins which segments run locked: the money arm is locked, the confirm polls are not', () => {
    const service = makeService({});
    const plan = service.sweepSegments();
    expect(plan).not.toBeNull();
    // The exact plan shape. chain-polls UNLOCKED is the H11 fix (read-only
    // confirm round trips must not camp the lock client); bond-payouts
    // LOCKED is the money-safety call (bondsDue is an unclaimed read, and a
    // refund RPC must have game-side exclusion, not just the service's
    // reference idempotence). Flipping either direction is a conscious
    // retune of that reasoning, never a drive-by.
    expect(plan?.segments.map((s) => [s.name, s.locked])).toEqual([
      ['expiry', true],
      ['chain-polls', false],
      ['delivery', true],
      ['bond-payouts', true],
    ]);
  });

  it('answers null when the market is disabled', () => {
    const service = makeService({});
    // makeService enables the market; build a disabled twin inline.
    const disabled = new RealWocMarketService({
      ...(service as unknown as { deps: WocMarketDeps }).deps,
      config: {
        enabled: false,
        realm: REALM,
        policy: WOC_MARKET_RESTRICTED_POLICY,
        confirmingReviewMs: 6 * 3600 * 1000,
      },
    });
    expect(disabled.sweepSegments()).toBeNull();
  });

  it('an aborted pass still reports once, with zero-scored arms that can never read as saturated', () => {
    const passes: { stats: Record<string, number>; saturated: readonly string[] }[] = [];
    const clock = BASE_MS;
    const service = new RealWocMarketService({
      db: {} as unknown as WocMarketDb,
      economy: createDevWocMarketEconomy(() => clock),
      custody: {} as unknown as WocMarketDeps['custody'],
      verifiedWallet: async () => null,
      balanceTokens: async () => null,
      stepUpDevSig: true,
      config: {
        enabled: true,
        realm: REALM,
        policy: WOC_MARKET_RESTRICTED_POLICY,
        confirmingReviewMs: 6 * 3600 * 1000,
      },
      onSweepPass: (stats, saturated) => {
        passes.push({ stats: stats as unknown as Record<string, number>, saturated });
      },
      now: () => clock,
    });
    void clock;
    const plan = service.sweepSegments();
    // A lost-lock abort runs NO segment; finish still reports exactly once.
    plan?.finish();
    expect(passes).toHaveLength(1);
    expect(Object.values(passes[0].stats).every((n) => n === 0)).toBe(true);
    expect(passes[0].saturated).toEqual([]);
  });
});

describe('the bond-payout budget', () => {
  it('a degraded service stops the walk at the wall-clock budget; the rest stays due', async () => {
    let clock = BASE_MS;
    const bondsDue = vi.fn(async () => [
      { id: 1, bondReference: 'woc_bond:1', bondState: 'refund_due' },
      { id: 2, bondReference: 'woc_bond:2', bondState: 'refund_due' },
      { id: 3, bondReference: 'woc_bond:3', bondState: 'refund_due' },
    ]);
    const setBondState = vi.fn(async () => true);
    const refundBond = vi.fn(async () => {
      // Each RPC rides its full timeout under the brownout this models.
      clock += 31_000;
      return { done: true, reason: null };
    });
    const passes: { stats: Record<string, number>; saturated: readonly string[] }[] = [];
    const service = new RealWocMarketService({
      db: { bondsDue, setBondState } as unknown as WocMarketDb,
      economy: {
        refundBond,
        forfeitBond: refundBond,
      } as unknown as WocMarketDeps['economy'],
      custody: {} as unknown as WocMarketDeps['custody'],
      verifiedWallet: async () => null,
      balanceTokens: async () => null,
      stepUpDevSig: true,
      config: {
        enabled: true,
        realm: REALM,
        policy: WOC_MARKET_RESTRICTED_POLICY,
        confirmingReviewMs: 6 * 3600 * 1000,
      },
      onSweepPass: (stats, saturated) => {
        passes.push({ stats: stats as unknown as Record<string, number>, saturated });
      },
      onSweepError: () => {},
      now: () => clock,
    });
    const plan = service.sweepSegments();
    const payouts = plan?.segments.find((seg) => seg.name === 'bond-payouts');
    expect(payouts?.locked).toBe(true);
    await payouts?.run();
    plan?.finish();
    // One RPC consumed the whole budget, so the walk stopped: the LOCKED
    // segment's hold is bounded near the budget plus one timeout, never the
    // whole batch, and rows 2 and 3 stay durably due for the next pass.
    expect(refundBond).toHaveBeenCalledTimes(1);
    expect(setBondState).toHaveBeenCalledTimes(1);
    // A budget break reports the FETCHED count, never the walked one: the
    // two undrained rows are a real money backlog, and a walked-only stat
    // would silence the saturation signal in exactly this degraded case.
    expect(passes[0]?.stats.bonds).toBe(3);
    // The break itself joins the saturated list: a SUB-batch break (3 due is
    // far under SWEEP_BATCH) would otherwise read as a drained pass by count
    // alone, silent exactly when the backlog is small.
    expect(passes[0]?.saturated).toContain('bonds');
  });

  it('a healthy service walks the whole batch inside the budget (the lower bound)', async () => {
    // The degraded case above only bounds the budget from ABOVE (any value
    // under one RPC's cost passes it); this arm reds if the budget were
    // quietly dropped toward zero, where a healthy 1s-per-RPC batch would
    // stop mid-walk and defer real refunds every pass.
    let clock = BASE_MS;
    const bondsDue = vi.fn(async () => [
      { id: 1, bondReference: 'woc_bond:1', bondState: 'refund_due' },
      { id: 2, bondReference: 'woc_bond:2', bondState: 'refund_due' },
      { id: 3, bondReference: 'woc_bond:3', bondState: 'refund_due' },
    ]);
    const setBondState = vi.fn(async () => true);
    const refundBond = vi.fn(async () => {
      clock += 1_000;
      return { done: true, reason: null };
    });
    const passes: { saturated: readonly string[] }[] = [];
    const service = new RealWocMarketService({
      db: { bondsDue, setBondState } as unknown as WocMarketDb,
      economy: {
        refundBond,
        forfeitBond: refundBond,
      } as unknown as WocMarketDeps['economy'],
      custody: {} as unknown as WocMarketDeps['custody'],
      verifiedWallet: async () => null,
      balanceTokens: async () => null,
      stepUpDevSig: true,
      config: {
        enabled: true,
        realm: REALM,
        policy: WOC_MARKET_RESTRICTED_POLICY,
        confirmingReviewMs: 6 * 3600 * 1000,
      },
      onSweepPass: (_stats, saturated) => {
        passes.push({ saturated });
      },
      onSweepError: () => {},
      now: () => clock,
    });
    const plan = service.sweepSegments();
    await plan?.segments.find((seg) => seg.name === 'bond-payouts')?.run();
    plan?.finish();
    expect(refundBond).toHaveBeenCalledTimes(3);
    expect(setBondState).toHaveBeenCalledTimes(3);
    expect(passes[0]?.saturated).not.toContain('bonds');
  });

  it('the budget value is the pinned 30 seconds', () => {
    // The budget is only exercised from above (a slow RPC) and below (a
    // fast batch); the VALUE itself must not drift silently, because it is
    // the locked segment's hold ceiling and sits deliberately under the
    // watchdog's 60s alarm.
    expect(BOND_PAYOUT_BUDGET_MS).toBe(30_000);
  });
});

describe('the read limiter', () => {
  it('mounts the read policy on the five hot GETs and the offers poll, BY IDENTITY', () => {
    // The rateLimit factory tags its middleware with the policy name, so
    // this pin survives route-table reordering (the source-scan shape did
    // not) and proves the mounted object, not a string in a comment.
    const policyOf = (method: string, routePath: string): string | undefined => {
      const route = routes.find((r) => r.method === method && r.path === routePath);
      if (!route) throw new Error(`no route ${method} ${routePath}`);
      for (const mw of route.middleware ?? []) {
        const name = (mw as { rateLimitPolicyName?: string }).rateLimitPolicyName;
        if (name !== undefined) return name;
      }
      return undefined;
    };
    for (const routePath of [
      '/api/woc-market/status',
      '/api/woc-market/listings',
      '/api/woc-market/listings/:id',
      '/api/woc-market/me',
      '/api/woc-market/history/:itemId',
      '/api/woc-market/offers',
    ]) {
      expect(policyOf('GET', routePath), routePath).toBe('woc_market_read');
    }
    // The enumeration-shaped read stays on the SMALLER bucket on purpose:
    // trade-partner answers "does this character exist and can it be paid",
    // and the widened polling budget must not widen harvesting.
    expect(policyOf('GET', '/api/woc-market/trade-partner')).toBe('woc_market_quote');
    expect(policyOf('GET', '/api/woc-market/estimate')).toBe('woc_market_quote');
  });

  it('all read-bucket GETs share ONE budget (exhausting via one route refuses the next)', async () => {
    setRateLimitClock(() => BASE_MS);
    const viaListings = rateLimit(WOC_MARKET_READ_POLICY);
    const viaMe = rateLimit(WOC_MARKET_READ_POLICY);
    const ctx = () => fakeCtx({ account: { accountId: 7, scope: 'read' } });
    for (let i = 0; i < WOC_MARKET_READ_MAX_PER_MINUTE; i++) {
      await viaListings(ctx(), async () => {});
    }
    // A SEPARATE middleware instance over the same policy: the sliding
    // window is the shared 'read' action bucket, so the refusal crosses
    // routes (a per-route policy object would double the effective budget).
    await expect(viaMe(ctx(), async () => {})).rejects.toMatchObject({
      status: 429,
      code: 'rate_limit.exceeded',
    });
  });

  it('answers 429 with retryAfterSeconds past the read budget, and admits under it', async () => {
    setRateLimitClock(() => BASE_MS);
    const middleware = rateLimit(WOC_MARKET_READ_POLICY);
    const ctx = () => fakeCtx({ account: { accountId: 7, scope: 'read' } });
    for (let i = 0; i < WOC_MARKET_READ_MAX_PER_MINUTE; i++) {
      await middleware(ctx(), async () => {});
    }
    await expect(middleware(ctx(), async () => {})).rejects.toMatchObject({
      status: 429,
      code: 'rate_limit.exceeded',
      params: { retryAfterSeconds: 60 },
    });
  });

  it('the retuned budget is 240 and the policy is TIER-1 ONLY (no pg write per allowed poll)', () => {
    expect(WOC_MARKET_READ_MAX_PER_MINUTE).toBe(240);
    expect(WOC_MARKET_READ_POLICY.limit).toBe(WOC_MARKET_READ_MAX_PER_MINUTE);
    expect(WOC_MARKET_READ_POLICY.keyClass).toBe('ip+account');
    // tier2 'none' is the load-bearing half of the retune: 'global' spends
    // two rate_limits UPSERTs per ALLOWED request, which on the polled
    // surface would out-cost the reads the caches remove. Flipping this
    // back is a measured decision, not a tidy-up.
    expect(WOC_MARKET_READ_POLICY.tier2).toBe('none');
  });
});

describe('production wiring (server/main.ts, source-pinned)', () => {
  const src = readFileSync(path.join(__dirname, '..', '..', 'server', 'main.ts'), 'utf8');
  const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  it('one read-cache instance reaches the service, the runtime, and the wallet-bust registration', () => {
    // The failure this pins: two instances (or a dropped wiring) mean busts
    // silently miss on a money surface while every unit test stays green.
    expect(code.match(/new WocMarketReadCache\(\)/g)).toHaveLength(1);
    expect(code).toContain('readCache: wocMarketReadCache,');
    expect(code).toContain(
      'configureWocMarketRuntime({\n  service: wocMarketService,\n  readCache: wocMarketReadCache,\n  authGuardDb: wocAuthGuardCache,\n})',
    );
    expect(code).toContain('registerWocMarketReadCacheForBusts(wocMarketReadCache)');
    expect(code).toContain('readCaches: wocMarketReadCache.stats()');
    // The auth-guard read cache (the second settled rider): ONE configure
    // call arms the singleton over the two REAL row fetchers, the SAME
    // instance rides the runtime injection above, its stats join this
    // readout, and shutdown FLUSHES the cache while keeping the singleton
    // armed: the runtime retains the same instance, so nulling the bust
    // target would leave a second in-process boot reading through a cache
    // no writer can bust (the review round's W2 shape).
    expect(code.match(/configureWocAuthGuardCache\(/g)).toHaveLength(1);
    expect(code).toContain('fetchTokenRow: authTokenRowForToken,');
    expect(code).toContain('fetchModerationRow: moderationRowForAccount,');
    expect(code).toContain('authGuard: wocAuthGuardCacheStats()');
    expect(code).toContain('wocAuthGuardCache.bustAll();');
    expect(code).not.toContain('resetWocAuthGuardCache');
    // The quota NOTIFY listener busts the guard cache on BOTH arms, closing
    // the cross-process gap for the policy columns (the one projection slice
    // with an existing broadcast channel).
    expect(code).toContain('onChange: (accountId, policy) => {');
    expect(code.match(/bustWocAuthGuardAccount\(accountId\)/g)).toHaveLength(2);
    // The two degraded-state counters ride the same readout: the price
    // cache's memo ages and the idle-kill count (a stall storm's client
    // evictions must be a number an operator can watch, not log volume).
    expect(code).toContain('priceCache: wocMarketEconomy.priceCacheAges?.() ?? null');
    expect(code).toContain('idleTxKills: wocMarketIdleTxKillCount()');
    // The 55P03 twin: every guard now carries the lock-wait bound, so its
    // fire rate is the tuning signal for ESCROW_LOCK_TIMEOUT_MS.
    expect(code).toContain('lockWaitTimeouts: wocMarketLockWaitTimeoutCount()');
    // The remaining two contention classes (the write-path rider's label):
    // without them, deadlocks and never-started checkouts hide inside the
    // same 'contended' the lock counter explains.
    expect(code).toContain('deadlocks: wocMarketDeadlockCount()');
    expect(code).toContain('txNeverStarted: wocMarketTxNeverStartedCount()');
    // The realm-global escrow gate: ONE instance, wired into custody AND
    // serving its stats on the readout (a second instance would split the
    // realm bound in two and neither half would bind).
    expect(code.match(/createWocEscrowGate\(\)/g)).toHaveLength(1);
    expect(code).toContain('{ escrowGate: wocEscrowGate }');
    expect(code).toContain('escrowGate: wocEscrowGate.stats()');
    // The extract-side serialize cost, the number the SAVE_IDLE sizing
    // argument rests on.
    expect(code).toContain('escrowSerialize: wocEscrowSerializeStats()');
    // The custody mail overlay readout: pendingBake plus the last merge's
    // counts and ok flag, the stuck-parcel signal an operator needs without
    // a log grep.
    expect(code).toContain('custodyOverlay: custodyOverlayStats()');
    // The character-save FIFO gauge reads the queue's live key count.
    expect(code).toContain('savePendingKeys: () => game.characterSaveQueues.pendingKeys()');
    // The drain rung's wiring: shutdown calls markDraining() first, and the
    // service reads the health flag live through this thunk.
    expect(code).toContain('draining: () => !isReady()');
    // The realm-gate pre-check rides the gate's RECLAIMING probe (a bare
    // stats read makes a full wedge's saturation permanent: the fix-round
    // review's blocking find), and the gauge source feeds the exported
    // occupancy metric off the same instance.
    expect(code).toContain('if (!wocEscrowGate.saturated()) return false;');
    expect(code).toContain("gameMetricsCounters().wocEscrowQueue('realm_refused')");
    // The background-gate starvation arm inside the FIFO job counts BEFORE it
    // throws (the enum member alone proves nothing about emission; this is
    // the realm_refused idiom for a closure only main.ts can host).
    expect(code).toContain("gameMetricsCounters().wocEscrowQueue('permit_refused');");
    expect(code).toContain("throw new Error('woc escrow refused: no background database permit');");
    expect(code).toContain('escrowGateInFlight: () => wocEscrowGate.stats().inFlight');
    // The stamp-ledger crossing counter rides the readout beside the
    // serialize stats.
    expect(code).toContain('stampHighWater: wocStampHighWaterCount()');
    expect(code).toContain('parkRefusals: wocParkRefusalCount()');
    // The pg pool gauge (the pre-enable review's pool-wait observability):
    // sustained waiting > 0 is the brownout precursor, and this readout is
    // where an operator already looks.
    expect(code).toContain(
      'pgPool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }',
    );
  });

  it('the sweep shell gets the segment plan and the watchdog, and shutdown stops the watchdog', () => {
    expect(code).toContain('plan: () => wocMarketService.sweepSegments()');
    expect(code).toContain('watchdog: wocMarketSweepWatchdog,');
    expect(code).toContain('wocMarketSweepWatchdog.stop()');
  });

  it('the wallet-link writes bust the activity readout (server/db.ts, source-pinned)', () => {
    const dbSrc = readFileSync(path.join(__dirname, '..', '..', 'server', 'db.ts'), 'utf8')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const link = dbSrc.slice(
      dbSrc.indexOf('export async function linkWalletToAccount'),
      dbSrc.indexOf('export async function unlinkWallet'),
    );
    const unlink = dbSrc.slice(
      dbSrc.indexOf('export async function unlinkWallet'),
      dbSrc.indexOf('export async function unlinkWallet') + 400,
    );
    expect(link).toContain('bustWocMarketActivity(accountId)');
    expect(unlink).toContain('bustWocMarketActivity(accountId)');
  });

  it('the drift-warn channel recognizes EXACTLY the wire-screen vocabularies (behavioral)', () => {
    // Behavioral, not a source-text scan (the module's own header names the
    // Sets, so a toContain pin was satisfiable by a comment): every word the
    // wire screens recognize warns NOTHING, one off-vocabulary word warns
    // exactly once, so the two judges provably share one notion of
    // "recognized" per vocabulary.
    const warner = new WocWireDriftWarner();
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const word of WOC_MARKET_WIRE_PENDING_REASONS) warner.notePending(word);
      for (const word of WOC_MARKET_WIRE_FAIL_REASONS) warner.noteFail(word);
      expect(spy).not.toHaveBeenCalled();
      warner.notePending('never_a_verdict');
      warner.noteFail('never_a_verdict');
      expect(spy).toHaveBeenCalledTimes(2);
      // Cross-vocabulary leakage in EITHER direction would let one screen's
      // additions silently mute the other channel: a fail-only word is not a
      // pending word, and a pending-only word is not a fail word.
      const failOnly = WOC_MARKET_WIRE_FAIL_REASONS.filter(
        (w) => !(WOC_MARKET_WIRE_PENDING_REASONS as readonly string[]).includes(w),
      );
      expect(failOnly.length).toBeGreaterThan(0);
      warner.notePending(failOnly[0]);
      expect(spy).toHaveBeenCalledTimes(3);
      const pendingOnly = WOC_MARKET_WIRE_PENDING_REASONS.filter(
        (w) => !(WOC_MARKET_WIRE_FAIL_REASONS as readonly string[]).includes(w),
      );
      expect(pendingOnly.length).toBeGreaterThan(0);
      warner.noteFail(pendingOnly[0]);
      expect(spy).toHaveBeenCalledTimes(4);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('cross-domain wallet busts', () => {
  it('bustWocMarketActivity reaches the registered instance and only the named account', async () => {
    const cache = new WocMarketReadCache({ now: () => BASE_MS });
    registerWocMarketReadCacheForBusts(cache);
    try {
      let generation = 1;
      await cache.myActivity(7, async () => ({ generation }));
      await cache.myActivity(8, async () => ({ generation }));
      generation = 2;
      bustWocMarketActivity(7);
      expect((await cache.myActivity(7, async () => ({ generation }))).generation).toBe(2);
      expect((await cache.myActivity(8, async () => ({ generation }))).generation).toBe(1);
    } finally {
      registerWocMarketReadCacheForBusts(null);
    }
    // Unregistered: a bust is a safe no-op (boot ordering, tests).
    expect(() => bustWocMarketActivity(7)).not.toThrow();
  });
});

describe('cache bounds under key churn', () => {
  it('the browse refresh registry stays bounded under hundreds of distinct keys', async () => {
    const cache = new WocMarketReadCache({ now: () => BASE_MS });
    for (let page = 0; page < 300; page++) {
      await cache.browse({ ...BROWSE_Q, page }, async () => ({ rows: [], hasMore: false }));
    }
    const stats = cache.stats().browse;
    // The LRU holds its cap (192: sized OVER the closed 144-key browse space
    // now that the filters ship, see WOC_MARKET_BROWSE_CACHE_MAX_ENTRIES);
    // the thunk registry is pruned against it at the documented 2x bound, so
    // per-request closures can never accumulate.
    expect(stats.entries).toBe(192);
    expect(stats.refreshRegistry).toBeLessThanOrEqual(385);
    expect(stats.evictions).toBeGreaterThan(0);
  });
});

describe('the browse page fence', () => {
  it('caches shallow pages, bypasses deep ones (page keys are caller-minted entropy)', async () => {
    const browseListings = vi.fn(async () => ({ rows: [], hasMore: false }));
    const service = makeService(
      { browseListings },
      { readCache: new WocMarketReadCache({ now: () => BASE_MS }) },
    );
    // The deepest cacheable page: two reads share one db round trip.
    const shallow = { ...BROWSE_Q, page: WOC_MARKET_BROWSE_CACHE_MAX_PAGE };
    await service.browse(shallow);
    await service.browse(shallow);
    expect(browseListings).toHaveBeenCalledTimes(1);
    // One past the fence: every read pays its own OFFSET walk (the limiter
    // is the bound), and no cache slot is minted for a mintable key.
    const deep = { ...BROWSE_Q, page: WOC_MARKET_BROWSE_CACHE_MAX_PAGE + 1 };
    await service.browse(deep);
    await service.browse(deep);
    expect(browseListings).toHaveBeenCalledTimes(3);
  });

  it('the fence value is the pinned 2 (pages 0 to 2 carry the cross-player win)', () => {
    expect(WOC_MARKET_BROWSE_CACHE_MAX_PAGE).toBe(2);
  });
});

describe('the activity readout deadline', () => {
  function slowActivityDb(clockRef: { ms: number }, perReadMs: number) {
    const read = async <T>(value: T): Promise<T> => {
      clockRef.ms += perReadMs;
      return value;
    };
    return {
      listingsBySeller: vi.fn((_r: string, _a: number) => read([])),
      bidsByAccount: vi.fn((_r: string, _a: number, _l: number) => read([])),
      settlementsByAccount: vi.fn((_r: string, _a: number, _l: number) => read([])),
      strikeInfo: vi.fn((_a: number) => read(null)),
      termsAcceptedAt: vi.fn((_a: number) => read(null)),
    };
  }

  function serviceOn(clockRef: { ms: number }, db: Record<string, unknown>) {
    return new RealWocMarketService({
      db: db as unknown as WocMarketDb,
      economy: createDevWocMarketEconomy(() => clockRef.ms),
      custody: {} as unknown as WocMarketDeps['custody'],
      verifiedWallet: async () => null,
      balanceTokens: async () => null,
      stepUpDevSig: true,
      config: {
        enabled: true,
        realm: REALM,
        policy: WOC_MARKET_RESTRICTED_POLICY,
        confirmingReviewMs: 6 * 3600 * 1000,
      },
      now: () => clockRef.ms,
    });
  }

  it.each([
    // perReadMs chosen so the crossing lands after a DIFFERENT read each
    // time: every one of the five between-read checks is load-bearing on its
    // own, so deleting any single deadline() call must fail one row here.
    [5_000, 'bidsByAccount', 'settlementsByAccount'],
    [2_100, 'settlementsByAccount', 'strikeInfo'],
    [1_600, 'strikeInfo', 'termsAcceptedAt'],
  ] as const)(
    'at %dms per read the walk stops right after %s (the next read never runs)',
    async (perReadMs, lastCalled, firstUncalled) => {
      const clockRef = { ms: BASE_MS };
      const db = slowActivityDb(clockRef, perReadMs);
      await expect(serviceOn(clockRef, db).myActivity(7)).rejects.toThrow(
        /activity readout deadline/,
      );
      expect(db[lastCalled]).toHaveBeenCalledTimes(1);
      expect(db[firstUncalled]).not.toHaveBeenCalled();
    },
  );

  it('the FIFTH check cuts before the wallet read (the last arm is live too)', async () => {
    const clockRef = { ms: BASE_MS };
    const db = slowActivityDb(clockRef, 1_250);
    const verifiedWallet = vi.fn(async () => null);
    const service = new RealWocMarketService({
      db: db as unknown as WocMarketDb,
      economy: createDevWocMarketEconomy(() => clockRef.ms),
      custody: {} as unknown as WocMarketDeps['custody'],
      verifiedWallet,
      balanceTokens: async () => null,
      stepUpDevSig: true,
      config: {
        enabled: true,
        realm: REALM,
        policy: WOC_MARKET_RESTRICTED_POLICY,
        confirmingReviewMs: 6 * 3600 * 1000,
      },
      now: () => clockRef.ms,
    });
    // Five reads at 1250ms cross at 6250: the readout must REJECT (a deleted
    // fifth check would let the instant wallet read complete it) and the
    // wallet dep is never consulted.
    await expect(service.myActivity(7)).rejects.toThrow(/activity readout deadline/);
    expect(db.termsAcceptedAt).toHaveBeenCalledTimes(1);
    expect(verifiedWallet).not.toHaveBeenCalled();
  });

  it('a healthy readout completes all six reads untouched by the deadline', async () => {
    const clockRef = { ms: BASE_MS };
    const db = slowActivityDb(clockRef, 200);
    const out = await serviceOn(clockRef, db).myActivity(7);
    expect(out.listings).toEqual([]);
    expect(db.termsAcceptedAt).toHaveBeenCalledTimes(1);
  });

  it('the deadline value is one checkout timeout plus slack', () => {
    expect(WOC_MARKET_ME_READOUT_DEADLINE_MS).toBe(6_000);
  });
});

describe('the limiter mount floor', () => {
  it('EVERY player-surface GET carries some rate-limit policy (derived, not enumerated)', () => {
    // The by-identity table above pins WHICH bucket each known GET rides;
    // this derived sweep is the floor that catches a NEW client-triggerable
    // GET shipped with no limiter at all (an unmetered read is sustainable
    // at whatever rate a client cares to send). Filtered on the TYPED
    // surface field, never a path prefix a new route could dodge.
    const gets = routes.filter((r) => r.method === 'GET' && r.surface === 'api');
    expect(gets.length).toBeGreaterThanOrEqual(7);
    for (const route of gets) {
      const tagged = (route.middleware ?? []).some(
        (mw) => typeof (mw as { rateLimitPolicyName?: string }).rateLimitPolicyName === 'string',
      );
      expect(tagged, `${route.path} carries a rate-limit policy`).toBe(true);
    }
    // The admin surface is the ONE deliberate carve-out: operator-only
    // behind the admin auth, not client-triggerable, so it carries no
    // player limiter. Pinned so the carve-out stays exactly this wide.
    const adminGets = routes.filter((r) => r.method === 'GET' && r.surface === 'admin');
    expect(adminGets.map((r) => r.path)).toEqual(['/admin/api/woc-market/listings']);
  });

  it('two ACCOUNTS behind one IP share the fused per-IP read window (the NAT sizing premise)', async () => {
    setRateLimitClock(() => BASE_MS);
    const middleware = rateLimit(WOC_MARKET_READ_POLICY);
    // Both ctxs share the fake request's one source address, so the refusal
    // below can only come from the shared per-IP arm (account 8's own
    // account window is untouched).
    const ctxFor = (accountId: number) => fakeCtx({ account: { accountId, scope: 'read' } });
    // Account 7 spends the whole IP window from one address...
    for (let i = 0; i < WOC_MARKET_READ_MAX_PER_MINUTE; i++) {
      await middleware(ctxFor(7), async () => {});
    }
    // ...and account 8 on the SAME address is refused: the 240 sizing is
    // sized for NAT-mates sharing one bucket, so the sharing itself must
    // hold (an account-only window would double the effective budget).
    await expect(middleware(ctxFor(8), async () => {})).rejects.toMatchObject({
      status: 429,
      code: 'rate_limit.exceeded',
    });
  });
});
