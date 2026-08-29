// The $WOC Exchange wire-shape pins (server/woc_market_routes.ts): every market
// view serializer's EXACT key set, driven through the real route handlers.
//
// Why key-set equality and not spot checks: the serializers are hand-written
// projections, so a field the service computes can be dropped silently (H8:
// estimateView lost `split`, quoteView lost `signatureRequired`, and the only
// symptom was a blank fee line). A sorted Object.keys equality fails on a
// dropped field AND on a rename, which is the whole point; the expected lists
// are hand-written literals on purpose (a list derived from the serializer
// would pin nothing).
//
// The value tests beside the pins cover the screening rules: the fail/pending
// reason words a view may carry are an enumerable vocabulary (rules.ts), never
// arbitrary service text.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_woc_market_wire_pins';

import { afterEach, describe, expect, it } from 'vitest';
import type {
  WocBidRow,
  WocDirectedOfferRow,
  WocEstimate,
  WocListingRow,
  WocMarketService,
  WocQuoteIntent,
  WocSaleRow,
  WocSettlementRow,
  WocStrikeRow,
} from '../../server/woc_market';
import {
  configureWocMarketRuntime,
  resetWocMarketGuardDbForTests,
  resetWocMarketRuntimeForTests,
  routes,
} from '../../server/woc_market_routes';
import { WOC_MARKET_DIRECTED_HOLD_SECONDS } from '../../server/woc_market_rules';
import { type FakeCtxOverrides, type FakeRes, fakeCtx } from './helpers';

const VIEWER = 7;
const SELLER = 99;
const FAR_FUTURE_MS = 4_000_000_000_000;

function handlerFor(method: string, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route registered for ${method} ${path}`);
  return route.handler;
}

function readCtx(over: FakeCtxOverrides = {}) {
  return fakeCtx({
    method: 'GET',
    url: '/api/woc-market/listings',
    account: { accountId: VIEWER, scope: 'read' },
    ...over,
  });
}

function sent(ctx: { res: unknown }): { status: number; body: Record<string, unknown> } {
  const res = ctx.res as unknown as FakeRes;
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, unknown> };
}

function service(overrides: Partial<WocMarketService>): void {
  configureWocMarketRuntime({ service: overrides as unknown as WocMarketService });
}

afterEach(() => {
  resetWocMarketRuntimeForTests();
  resetWocMarketGuardDbForTests();
});

// ---------------------------------------------------------------------------
// Fixtures: full rows so the serializers see every source field they could
// project (a pin over a partial row could miss a projected-but-undefined key).
// ---------------------------------------------------------------------------

function listingRow(over: Partial<WocListingRow> = {}): WocListingRow {
  return {
    id: 41,
    directedBuyerAccount: null,
    realm: 'Claudemoon',
    sellerAccount: SELLER,
    sellerCharacter: 12,
    sellerName: 'Aurelia',
    sellerWallet: 'SELLERWALLETPUBKEY111111111111111111111111',
    item: { itemId: 'deathlord_warplate', count: 1 },
    itemId: 'deathlord_warplate',
    quality: 'epic',
    format: 'auction_buy_now',
    startCents: 2500,
    reserveCents: 10_000,
    buyNowCents: 25_000,
    offerNext: true,
    status: 'active',
    resolution: null,
    itemDisposed: false,
    currentBidCents: 5000,
    currentBidId: 8,
    soldCents: null,
    endsAtMs: FAR_FUTURE_MS,
    baseEndsAtMs: FAR_FUTURE_MS,
    buyNowLockAccount: 1234,
    buyNowLockExpiresMs: FAR_FUTURE_MS,
    createdAtMs: 1_799_000_000_000,
    cancelRequestedAtMs: null,
    ...over,
  };
}

function bidRow(over: Partial<WocBidRow> = {}): WocBidRow {
  return {
    id: 8,
    listingId: 41,
    account: VIEWER,
    characterId: 3,
    characterName: 'Sable',
    wallet: 'BIDDERWALLETPUBKEY111111111111111111111111',
    amountCents: 5000,
    status: 'pending_bond',
    bondCents: 250,
    bondState: 'pending',
    bondReference: 'WMB_ref1',
    bondQuoteExpiresAtMs: FAR_FUTURE_MS,
    bondSignature: null,
    bondSignatureAtMs: null,
    placedAtMs: 1_799_000_100_000,
    ...over,
  };
}

function settlementRow(over: Partial<WocSettlementRow> = {}): WocSettlementRow {
  return {
    id: 5,
    listingId: 41,
    bidId: null,
    attempt: 0,
    buyerAccount: VIEWER,
    buyerCharacter: 3,
    buyerName: 'Sable',
    buyerWallet: 'BIDDERWALLETPUBKEY111111111111111111111111',
    amountCents: 25_000,
    state: 'offered',
    quoteReference: 'WMS_ref1',
    quoteExpiresAtMs: FAR_FUTURE_MS,
    txSignature: null,
    failReason: null,
    settledAmountBase: null,
    deadlineAtMs: FAR_FUTURE_MS,
    createdAtMs: 1_799_000_200_000,
    ...over,
  };
}

function saleRow(): WocSaleRow {
  return {
    id: 11,
    realm: 'Claudemoon',
    listingId: 41,
    itemId: 'deathlord_warplate',
    item: { itemId: 'deathlord_warplate', count: 1 },
    priceCents: 25_000,
    amountBase: '25000000000',
    sellerAccount: SELLER,
    buyerAccount: VIEWER,
    sellerName: 'Aurelia',
    buyerName: 'Sable',
    excluded: false,
    atMs: 1_799_000_300_000,
  };
}

function strikeRow(): WocStrikeRow {
  return { accountId: VIEWER, strikes: 1, suspendedUntilMs: null };
}

function offerRow(over: Partial<WocDirectedOfferRow> = {}): WocDirectedOfferRow {
  return {
    id: 21,
    realm: 'Claudemoon',
    sellerAccount: SELLER,
    sellerCharacter: 12,
    sellerName: 'Aurelia',
    buyerAccount: VIEWER,
    buyerName: 'Sable',
    itemRef: null,
    itemId: 'deathlord_warplate',
    itemPin: 'pin1',
    usdCents: 25_000,
    status: 'pending',
    listingId: null,
    createdAtMs: 1_799_000_000_000,
    expiresAtMs: FAR_FUTURE_MS,
    buyerAccepted: true,
    sellerAccepted: false,
    listingStatus: null,
    listingResolution: null,
    settlementState: null,
    ...over,
  };
}

function quoteIntent(over: Partial<WocQuoteIntent> = {}): WocQuoteIntent {
  return {
    ok: true,
    reference: 'WMS_ref1',
    transactionBase64: 'dHg=',
    signatureRequired: true,
    amount: { base: '25000000000', tokens: 25 },
    seller: { base: '22500000000', tokens: 22.5 },
    burn: { base: '750000000', tokens: 0.75 },
    treasury: { base: '1750000000', tokens: 1.75 },
    bondCents: null,
    expiresAtMs: FAR_FUTURE_MS,
    reason: null,
    ...over,
  };
}

function estimate(over: Partial<WocEstimate> = {}): WocEstimate {
  return {
    available: true,
    usdCents: 25_000,
    amount: { base: '25000000000', tokens: 25 },
    asOfMs: 1_799_000_400_000,
    split: { sellerCents: 22_500, burnCents: 750, treasuryCents: 1750 },
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Drivers: each returns the serialized view straight off the wire body.
// ---------------------------------------------------------------------------

async function browseListingView(
  over: Partial<WocListingRow> = {},
): Promise<Record<string, unknown>> {
  service({ browse: async () => ({ rows: [listingRow(over)], hasMore: false }) });
  const ctx = readCtx();
  await handlerFor('GET', '/api/woc-market/listings')(ctx);
  const { status, body } = sent(ctx);
  expect(status).toBe(200);
  return (body.listings as Record<string, unknown>[])[0];
}

async function meBody(over: {
  bids?: (WocBidRow & { itemId?: string })[];
  settlements?: (WocSettlementRow & { itemId?: string })[];
}): Promise<Record<string, unknown>> {
  service({
    myActivity: async () => ({
      listings: [listingRow()],
      // The activity reads are item-named (the joined listing's item); the
      // default fixture carries one like the real read, and a test may pass
      // its own (including '' for the pruned-listing arm).
      bids: (over.bids ?? [bidRow()]).map((b) => ({ itemId: 'deathlord_warplate', ...b })),
      settlements: (over.settlements ?? [settlementRow()]).map((s) => ({
        itemId: 'deathlord_warplate',
        ...s,
      })),
      strikes: strikeRow(),
      termsAcceptedAtMs: 1_799_000_000_000,
      wallet: 'BIDDERWALLETPUBKEY111111111111111111111111',
    }),
  });
  const ctx = readCtx({ url: '/api/woc-market/me' });
  await handlerFor('GET', '/api/woc-market/me')(ctx);
  const { status, body } = sent(ctx);
  expect(status).toBe(200);
  return body;
}

async function estimateBody(est: WocEstimate): Promise<Record<string, unknown>> {
  service({ estimate: async () => est });
  const ctx = readCtx({ url: '/api/woc-market/estimate?cents=25000', query: { cents: '25000' } });
  await handlerFor('GET', '/api/woc-market/estimate')(ctx);
  const { status, body } = sent(ctx);
  expect(status).toBe(200);
  return body;
}

async function settlementQuoteBody(intent: WocQuoteIntent): Promise<Record<string, unknown>> {
  service({ settlementQuote: async () => ({ ok: true as const, quote: intent }) });
  const ctx = readCtx({
    method: 'POST',
    url: '/api/woc-market/settlements/5/quote',
    params: { id: '5' },
    body: {},
  });
  await handlerFor('POST', '/api/woc-market/settlements/:id/quote')(ctx);
  const { status, body } = sent(ctx);
  expect(status).toBe(200);
  return body;
}

async function historySaleView(): Promise<Record<string, unknown>> {
  service({ salesHistory: async () => [saleRow()] });
  const ctx = readCtx({
    url: '/api/woc-market/history/deathlord_warplate',
    params: { itemId: 'deathlord_warplate' },
  });
  await handlerFor('GET', '/api/woc-market/history/:itemId')(ctx);
  const { status, body } = sent(ctx);
  expect(status).toBe(200);
  return (body.sales as Record<string, unknown>[])[0];
}

async function sellerHistoryBody(): Promise<Record<string, unknown>> {
  service({
    sellerSalesHistory: async () => ({
      sales: [saleRow()],
      profile: { guildName: 'Monarchs' },
    }),
  });
  const ctx = readCtx({
    url: '/api/woc-market/seller-history/Selara',
    params: { name: 'Selara' },
  });
  await handlerFor('GET', '/api/woc-market/seller-history/:name')(ctx);
  const { status, body } = sent(ctx);
  expect(status).toBe(200);
  return body;
}

async function offersOfferView(): Promise<Record<string, unknown>> {
  service({ directedOffers: async () => [offerRow()] });
  const ctx = readCtx({ url: '/api/woc-market/offers' });
  await handlerFor('GET', '/api/woc-market/offers')(ctx);
  const { status, body } = sent(ctx);
  expect(status).toBe(200);
  return (body.offers as Record<string, unknown>[])[0];
}

// ---------------------------------------------------------------------------
// The key-set pins
// ---------------------------------------------------------------------------

describe('market wire views expose exactly their pinned key sets', () => {
  it('listingView', async () => {
    expect(Object.keys(await browseListingView()).sort()).toEqual(
      [
        'buyNowCents',
        'buyNowLocked',
        'cancelPending',
        'createdAtMs',
        'currentBidCents',
        'directed',
        'endsAtMs',
        'format',
        'hasReserve',
        'id',
        'item',
        'itemId',
        'mine',
        'minNextBidBondCents',
        'minNextBidCents',
        'offerNext',
        'quality',
        'reserveMet',
        'sellerName',
        'soldCents',
        'startCents',
        'status',
        'resolution',
      ].sort(),
    );
  });

  it('bidView', async () => {
    const body = await meBody({});
    const view = (body.bids as Record<string, unknown>[])[0];
    expect(Object.keys(view).sort()).toEqual(
      [
        'amountCents',
        'bondCents',
        'bondConfirming',
        'bondQuoteExpiresAtMs',
        'bondReference',
        'bondState',
        'id',
        'itemId',
        'listingId',
        'placedAtMs',
        'status',
      ].sort(),
    );
  });

  it('settlementView', async () => {
    const body = await meBody({});
    const view = (body.settlements as Record<string, unknown>[])[0];
    expect(Object.keys(view).sort()).toEqual(
      [
        'amountCents',
        'attempt',
        'createdAtMs',
        'deadlineAtMs',
        'failReason',
        'id',
        'itemId',
        'listingId',
        'quoteExpiresAtMs',
        'quoteReference',
        'state',
      ].sort(),
    );
  });

  it('strikeView', async () => {
    const body = await meBody({});
    expect(Object.keys(body.strikes as Record<string, unknown>).sort()).toEqual([
      'strikes',
      'suspendedUntilMs',
    ]);
  });

  it('saleView', async () => {
    expect(Object.keys(await historySaleView()).sort()).toEqual(
      // No `item`: the full InvSlot was dead wire weight (no client reader);
      // itemId is the identity the history caller already keys by.
      ['atMs', 'buyerName', 'id', 'itemId', 'priceCents', 'sellerName'].sort(),
    );
  });

  it('sellerHistoryView', async () => {
    // The seller click-through's readout: the same saleView rows plus the
    // public profile line: ONLY facts the world already shows (the nameplate
    // guild tag). The character creation date was dropped as an unspecced
    // account-age disclosure, so the seller shape is exactly guildName.
    const body = await sellerHistoryBody();
    expect(Object.keys(body).sort()).toEqual(['sales', 'seller'].sort());
    expect(Object.keys(body.seller as Record<string, unknown>).sort()).toEqual(['guildName']);
    expect(Object.keys((body.sales as Record<string, unknown>[])[0]).sort()).toEqual(
      ['atMs', 'buyerName', 'id', 'itemId', 'priceCents', 'sellerName'].sort(),
    );
  });

  it('quoteView', async () => {
    const body = await settlementQuoteBody(quoteIntent());
    expect(Object.keys(body.quote as Record<string, unknown>).sort()).toEqual(
      [
        'amount',
        'bondCents',
        'burn',
        'expiresAtMs',
        'reference',
        'seller',
        'signatureRequired',
        'transactionBase64',
        'treasury',
      ].sort(),
    );
  });

  it('estimateView', async () => {
    const body = await estimateBody(estimate());
    expect(Object.keys(body).sort()).toEqual(
      ['amount', 'asOfMs', 'available', 'split', 'usdCents'].sort(),
    );
  });

  it('offerView', async () => {
    expect(Object.keys(await offersOfferView()).sort()).toEqual(
      [
        'buyerAccepted',
        'buyerName',
        'expiresAtMs',
        'id',
        'itemId',
        'listingId',
        'listingResolution',
        'listingStatus',
        'role',
        'sellerAccepted',
        'sellerName',
        'settlementState',
        'status',
        'usdCents',
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// The carried values (H8): the service computed them, the player receives them.
// ---------------------------------------------------------------------------

describe('estimateView carries the service fee split and print time', () => {
  it('passes the split legs through byte-for-byte', async () => {
    const body = await estimateBody(estimate());
    expect(body.split).toEqual({ sellerCents: 22_500, burnCents: 750, treasuryCents: 1750 });
    expect(body.asOfMs).toBe(1_799_000_400_000);
  });

  it('sends an explicit null split when the service offered none', async () => {
    const body = await estimateBody(estimate({ split: null, asOfMs: null }));
    expect(body.split).toBeNull();
    expect(body.asOfMs).toBeNull();
  });
});

describe('quoteView carries signatureRequired', () => {
  it('true for a wallet-signed quote', async () => {
    const body = await settlementQuoteBody(quoteIntent({ signatureRequired: true }));
    expect((body.quote as Record<string, unknown>).signatureRequired).toBe(true);
  });

  it('false for the dev economy quote, which no wallet can sign', async () => {
    const body = await settlementQuoteBody(quoteIntent({ signatureRequired: false }));
    expect((body.quote as Record<string, unknown>).signatureRequired).toBe(false);
  });

  it('carries the service bondCents figure by value', async () => {
    // The key-set pin catches deletion; this catches a hard-coded null.
    const body = await settlementQuoteBody(quoteIntent({ bondCents: 250 }));
    expect((body.quote as Record<string, unknown>).bondCents).toBe(250);
  });
});

describe('the place-bid response wraps bidView and quoteView', () => {
  it('pins the wrapper keys and the bond figure through the real route', async () => {
    service({
      placeBid: async () => ({
        ok: true as const,
        bid: bidRow({ bondCents: 250 }),
        bond: quoteIntent({ reference: 'WMB_ref1', bondCents: 250 }),
      }),
    });
    const ctx = readCtx({
      method: 'POST',
      url: '/api/woc-market/listings/41/bids',
      params: { id: '41' },
      body: { characterId: 3, amountCents: 5000, acceptTerms: true },
    });
    await handlerFor('POST', '/api/woc-market/listings/:id/bids')(ctx);
    const { status, body } = sent(ctx);
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['bid', 'bond']);
    expect((body.bond as Record<string, unknown>).bondCents).toBe(250);
    expect((body.bid as Record<string, unknown>).bondCents).toBe(250);
  });
});

describe('activity rows name the listed item (the pay-row identity)', () => {
  it('carries the joined item id on bid and settlement rows', async () => {
    const body = await meBody({});
    expect((body.bids as Record<string, unknown>[])[0].itemId).toBe('deathlord_warplate');
    expect((body.settlements as Record<string, unknown>[])[0].itemId).toBe('deathlord_warplate');
  });

  it('collapses a pruned-listing empty id to null', async () => {
    const body = await meBody({
      bids: [{ ...bidRow(), itemId: '' }],
      settlements: [{ ...settlementRow(), itemId: '' }],
    });
    expect((body.bids as Record<string, unknown>[])[0].itemId).toBeNull();
    expect((body.settlements as Record<string, unknown>[])[0].itemId).toBeNull();
  });

  it('sends null on a mutation response whose row is not item-joined', async () => {
    service({
      placeBid: async () => ({
        ok: true as const,
        bid: bidRow({ bondCents: 250 }),
        bond: quoteIntent({ reference: 'WMB_ref1', bondCents: 250 }),
      }),
    });
    const ctx = readCtx({
      method: 'POST',
      url: '/api/woc-market/listings/41/bids',
      params: { id: '41' },
      body: { characterId: 3, amountCents: 5000, acceptTerms: true },
    });
    await handlerFor('POST', '/api/woc-market/listings/:id/bids')(ctx);
    const { body } = sent(ctx);
    expect((body.bid as Record<string, unknown>).itemId).toBeNull();
  });
});

describe('settlementView.failReason is the screened verdict vocabulary', () => {
  it('passes a known verifier verdict through verbatim', async () => {
    const body = await meBody({
      settlements: [settlementRow({ state: 'failed', failReason: 'burn_missing' })],
    });
    expect((body.settlements as Record<string, unknown>[])[0].failReason).toBe('burn_missing');
  });

  it('collapses an unknown reason to the stable other token, never raw text', async () => {
    const body = await meBody({
      settlements: [settlementRow({ state: 'failed', failReason: 'some_new_service_word_v9' })],
    });
    expect((body.settlements as Record<string, unknown>[])[0].failReason).toBe('other');
  });

  it('null stays null', async () => {
    const body = await meBody({ settlements: [settlementRow()] });
    expect((body.settlements as Record<string, unknown>[])[0].failReason).toBeNull();
  });
});

describe('the confirm handlers answer the screened pending verdict', () => {
  async function confirmBondBody(out: {
    ok: true;
    standing: boolean;
    pending?: boolean;
    reason?: string | null;
  }): Promise<Record<string, unknown>> {
    service({ confirmBond: async () => out });
    const ctx = readCtx({
      method: 'POST',
      url: '/api/woc-market/bids/8/bond',
      params: { id: '8' },
      body: { signature: 'a'.repeat(64) },
    });
    await handlerFor('POST', '/api/woc-market/bids/:id/bond')(ctx);
    const { status, body } = sent(ctx);
    expect(status).toBe(200);
    return body;
  }

  async function confirmSettlementBody(out: {
    ok: true;
    state: WocSettlementRow['state'];
    reason?: string | null;
  }): Promise<Record<string, unknown>> {
    service({ confirmSettlement: async () => out });
    const ctx = readCtx({
      method: 'POST',
      url: '/api/woc-market/settlements/5/confirm',
      params: { id: '5' },
      body: { signature: 'a'.repeat(64) },
    });
    await handlerFor('POST', '/api/woc-market/settlements/:id/confirm')(ctx);
    const { status, body } = sent(ctx);
    expect(status).toBe(200);
    return body;
  }

  it('bond: a pending verdict names its reason on the wire', async () => {
    const body = await confirmBondBody({
      ok: true,
      standing: false,
      pending: true,
      reason: 'awaiting_finality',
    });
    expect(body).toEqual({ standing: false, pending: true, reason: 'awaiting_finality' });
  });

  it('bond: the handler SCREENS the reason; an unknown word leaves as other', async () => {
    // Without this pin, replacing the screen with a raw passthrough stays
    // green on every vocabulary-word fixture and arbitrary service text
    // reaches the client.
    const body = await confirmBondBody({
      ok: true,
      standing: false,
      pending: true,
      reason: 'some_new_service_word_v9',
    });
    expect(body).toEqual({ standing: false, pending: true, reason: 'other' });
  });

  it('bond: a settled verdict answers a null reason', async () => {
    const body = await confirmBondBody({ ok: true, standing: true });
    expect(body).toEqual({ standing: true, pending: false, reason: null });
  });

  it('settlement: a pending verdict names its reason on the wire', async () => {
    const body = await confirmSettlementBody({
      ok: true,
      state: 'confirming',
      reason: 'not_yet_visible',
    });
    expect(body).toEqual({ state: 'confirming', reason: 'not_yet_visible' });
  });

  it('settlement: the handler SCREENS the reason; an unknown word leaves as other', async () => {
    const body = await confirmSettlementBody({
      ok: true,
      state: 'confirming',
      reason: 'some_new_service_word_v9',
    });
    expect(body).toEqual({ state: 'confirming', reason: 'other' });
  });

  it('settlement: a decided state answers a null reason', async () => {
    const body = await confirmSettlementBody({ ok: true, state: 'confirmed' });
    expect(body).toEqual({ state: 'confirmed', reason: null });
  });
});

// ---------------------------------------------------------------------------
// Listing state booleans: player-meaningful state, never the accounts behind
// it (the cancel-intent and directed markers carry no ids).
// ---------------------------------------------------------------------------

describe('listingView state booleans', () => {
  it('cancelPending follows the cancel-intent stamp, on ACTIVE listings only', async () => {
    expect((await browseListingView()).cancelPending).toBe(false);
    expect(
      (await browseListingView({ cancelRequestedAtMs: 1_799_000_000_000 })).cancelPending,
    ).toBe(true);
    // The stamp is never cleared; a closed listing must not report a pending
    // cancel forever (every server-side consumer of the column pairs it with
    // status = 'active', and the wire follows).
    expect(
      (
        await browseListingView({
          cancelRequestedAtMs: 1_799_000_000_000,
          status: 'closed',
        })
      ).cancelPending,
    ).toBe(false);
  });

  it('directed follows the directed-buyer stamp without leaking the account', async () => {
    expect((await browseListingView()).directed).toBe(false);
    const view = await browseListingView({ directedBuyerAccount: 4242 });
    expect(view.directed).toBe(true);
    expect(JSON.stringify(view)).not.toContain('4242');
  });
});

// ---------------------------------------------------------------------------
// Wrapper key sets: the same drop-a-field failure mode exists one level up
// (a new top-level response field must land in a pin, not silently).
// ---------------------------------------------------------------------------

describe('response wrappers expose exactly their pinned key sets', () => {
  it('POST /step-up/challenge wraps as { challenge } with the exact key set and values', async () => {
    // The step-up issue response (B6/R1): everything the client needs to run
    // the wallet flow and NOTHING else (no digest, no wallet echo, no realm).
    service({
      issueStepUpChallenge: async () => ({
        ok: true,
        challenge: {
          nonce: 'a'.repeat(32),
          message: 'World of ClaudeCraft $WOC Exchange: authorize moving an item into escrow.',
          expiresAtMs: FAR_FUTURE_MS,
          signatureRequired: true,
        },
      }),
    });
    const ctx = readCtx({
      method: 'POST',
      url: '/api/woc-market/step-up/challenge',
      account: { accountId: VIEWER, scope: 'full' },
      body: {
        operation: 'create_listing',
        itemId: 'deathlord_warplate',
        format: 'auction',
        startCents: 2500,
        reserveCents: null,
        buyNowCents: null,
        durationHours: 12,
      },
    });
    await handlerFor('POST', '/api/woc-market/step-up/challenge')(ctx);
    const { status, body } = sent(ctx);
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['challenge']);
    const challenge = body.challenge as Record<string, unknown>;
    expect(Object.keys(challenge).sort()).toEqual([
      'expiresAtMs',
      'message',
      'nonce',
      'signatureRequired',
    ]);
    expect(challenge.nonce).toBe('a'.repeat(32));
    expect(challenge.expiresAtMs).toBe(FAR_FUTURE_MS);
    expect(challenge.signatureRequired).toBe(true);
  });

  it('GET /me', async () => {
    const body = await meBody({});
    expect(Object.keys(body).sort()).toEqual(
      ['bids', 'listings', 'settlements', 'strikes', 'termsAcceptedAtMs', 'walletLinked'].sort(),
    );
  });

  it('GET /status, with the price PROJECTED (reason never crosses)', async () => {
    service({
      status: async () => ({
        enabled: true,
        price: {
          available: true,
          healthy: false,
          // The service's verbatim operational word: the one field the
          // status pass-through used to leak. The projection drops it.
          reason: 'operator_paused_v9',
          tokensPerUsd: 100,
          asOfMs: 1_799_000_400_000,
        },
        maxActiveListings: 12,
      }),
    });
    const ctx = readCtx({ url: '/api/woc-market/status' });
    await handlerFor('GET', '/api/woc-market/status')(ctx);
    const { status, body } = sent(ctx);
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(
      [
        'enabled',
        'price',
        'maxActiveListings',
        'durationsHours',
        'minPriceCents',
        'maxPriceCents',
        'qualityFloor',
        'allowMounts',
        'allowMechChromas',
        'settlementWindowSeconds',
        'directedHoldSeconds',
        'bond',
      ].sort(),
    );
    // The bond schedule and payment window, exactly the rules constants: the
    // client's disclosure copy resolves live figures from these instead of
    // shipping figure-free sentences, so a silent retune must red here.
    expect(body.bond).toEqual({
      rateBps: 500,
      minCents: 100,
      maxCents: 5000,
      pendingTtlSeconds: 300,
    });
    // The p2p hold rides as the rules constant, a positive number of seconds
    // (the trade arm's commitment note renders it through durationText).
    expect(body.directedHoldSeconds).toBe(WOC_MARKET_DIRECTED_HOLD_SECONDS);
    expect(body.directedHoldSeconds).toBeGreaterThan(0);
    // Keys AND values in one pin: the fixture's polarities differ (available
    // true, healthy false), so a swapped or hard-coded projection goes red;
    // healthy is what the client's paused banner derives from.
    expect(body.price).toEqual({
      available: true,
      healthy: false,
      tokensPerUsd: 100,
      asOfMs: 1_799_000_400_000,
    });
    expect(JSON.stringify(body)).not.toContain('operator_paused_v9');
  });

  it('POST /bids/:id/bond-quote wraps quoteView as { bond }', async () => {
    service({ refreshBondQuote: async () => ({ ok: true as const, bond: quoteIntent() }) });
    const ctx = readCtx({
      method: 'POST',
      url: '/api/woc-market/bids/8/bond-quote',
      params: { id: '8' },
      body: {},
    });
    await handlerFor('POST', '/api/woc-market/bids/:id/bond-quote')(ctx);
    const { status, body } = sent(ctx);
    expect(status).toBe(200);
    expect(Object.keys(body)).toEqual(['bond']);
  });

  it('POST /settlements/:id/quote wraps quoteView as { quote }', async () => {
    const body = await settlementQuoteBody(quoteIntent());
    expect(Object.keys(body)).toEqual(['quote']);
  });

  it('POST /listings/:id/buy-now wraps as { settlement, quote }', async () => {
    service({
      buyNow: async () => ({
        ok: true as const,
        settlement: settlementRow(),
        quote: quoteIntent(),
      }),
    });
    const ctx = readCtx({
      method: 'POST',
      url: '/api/woc-market/listings/41/buy-now',
      params: { id: '41' },
      body: { characterId: 3, acceptTerms: true },
    });
    await handlerFor('POST', '/api/woc-market/listings/:id/buy-now')(ctx);
    const { status, body } = sent(ctx);
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['quote', 'settlement'].sort());
  });
});
