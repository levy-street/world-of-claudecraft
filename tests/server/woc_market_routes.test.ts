// The $WOC Exchange route layer (server/woc_market_routes.ts): the wire contract
// over WocMarketService. Two things here are load-bearing beyond "does it
// compile", and the structural http gates cover neither (they assert only that a
// code EXISTS in the catalog, never that a given refusal maps to it):
//
//  1. REFUSAL_ERRORS. Several status choices are security decisions, above all
//     not_yours -> 404 rather than 403: a 403 would confirm that someone else's
//     listing id exists, which is the enumeration the requireOwned loaders exist
//     to prevent. Two more collapse many reasons onto ONE code on purpose
//     (stale_item, not_eligible) so a prober cannot learn which rule refused.
//  2. listingView's field hiding. The PRD requires the exact reserve, both
//     wallets, and the buy-now lock holder to stay server-side. A leak here is
//     silent: the window simply would not render the extra fields, so nothing
//     fails and the data ships anyway.
//
// server/db.ts builds a pg Pool at module load and throws without a URL; the
// routes module imports it transitively. The pool never connects: the handlers
// under test reach only the injected runtime service.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_woc_market_routes';

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { compose } from '../../server/http/compose';
import { WOC_MARKET_STEPUP_POLICY } from '../../server/http/middleware/rate_limit';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Middleware } from '../../server/http/types';
import {
  WOC_MARKET_LIST_MAX_PER_MINUTE,
  WOC_MARKET_STEPUP_MAX_PER_MINUTE,
  wocMarketMutationLimit,
} from '../../server/ratelimit';
import type {
  WocBidRow,
  WocBrowseQuery,
  WocListingRow,
  WocMarketRefusal,
  WocMarketService,
} from '../../server/woc_market';
import { WocMarketService as WocMarketServiceReal } from '../../server/woc_market';
import { createDevWocMarketEconomy } from '../../server/woc_market_proxy';
import {
  configureWocMarketRuntime,
  REFUSAL_ERRORS,
  resetWocMarketGuardDbForTests,
  resetWocMarketRuntimeForTests,
  routes,
  wocMarketConfig,
} from '../../server/woc_market_routes';
import { WOC_MARKET_RESTRICTED_POLICY } from '../../server/woc_market_rules';
import { stripComments } from '../helpers/strip_comments';
import { type FakeCtxOverrides, type FakeRes, fakeCtx } from './helpers';
import { FakeWocMarketDb } from './helpers/fake_woc_market_db';

const VIEWER = 7;
const SELLER = 99;
/** Fixed, never Date.now(): buyNowLocked compares the lock expiry to now, so a
 *  far-future constant keeps the "locked" arm deterministic. */
const FAR_FUTURE_MS = 4_000_000_000_000;

function handlerFor(method: string, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route registered for ${method} ${path}`);
  return route.handler;
}

/** A read ctx carrying an authenticated account (ctxAccountId reads accountId). */
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

/** Install a partial service: only the members the handler under test reaches. */
function service(overrides: Partial<WocMarketService>): void {
  configureWocMarketRuntime({ service: overrides as unknown as WocMarketService });
}

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

/** Drive the browse handler over one row and return that row's public view. */
async function viewOf(over: Partial<WocListingRow>): Promise<Record<string, unknown>> {
  service({ browse: async () => ({ rows: [listingRow(over)], hasMore: false }) });
  const ctx = readCtx();
  await handlerFor('GET', '/api/woc-market/listings')(ctx);
  const { status, body } = sent(ctx);
  expect(status).toBe(200);
  return (body.listings as Record<string, unknown>[])[0];
}

afterEach(() => {
  resetWocMarketRuntimeForTests();
  resetWocMarketGuardDbForTests();
});

describe('the refusal-to-wire mapping', () => {
  it('answers every refusal with a woc_market.* code and a 4xx/5xx, never English', () => {
    const rows = Object.entries(REFUSAL_ERRORS);
    // The EXACT count, not a floor. A floor of 35 let four union members vanish
    // silently; tsc catches a deleted Record key but not a shrunken union.
    expect(rows).toHaveLength(58);
    for (const [reason, mapped] of rows) {
      expect(mapped.code, reason).toMatch(/^woc_market\./);
      expect(mapped.status, reason).toBeGreaterThanOrEqual(400);
      expect(mapped.status, reason).toBeLessThan(600);
    }
  });

  // EVERY row, pinned to literals. A partial table left 14 of the 39 statuses
  // covered only by the generic 4xx/5xx sweep above, so a flip like
  // already_pending 409 -> 403 or insufficient_balance 400 -> 503 shipped
  // silently and changed the client's retry-vs-refuse branch with it. The
  // exhaustiveness assertion below is what keeps this table honest: a NEW
  // refusal fails until it is listed here with a deliberate status.
  const WIRE: [WocMarketRefusal, number, string][] = [
    // Feature and pricing availability. 503 says "retry", 403 says "not for you":
    // the client branches on exactly this difference.
    ['disabled', 403, 'woc_market.disabled'],
    ['market_paused', 503, 'woc_market.paused'],
    ['quote_unavailable', 503, 'woc_market.quote_unavailable'],
    // Authorization. The caller is known and the action is not theirs.
    ['wallet_required', 403, 'woc_market.wallet_required'],
    ['terms_required', 403, 'woc_market.terms_required'],
    ['account_suspended', 403, 'woc_market.suspended'],
    ['own_listing', 403, 'woc_market.own_listing'],
    // The anti-enumeration pair: a foreign id and an absent id are
    // indistinguishable, and BOTH are 404. A 403 on not_yours confirms the row.
    ['not_found', 404, 'woc_market.not_found'],
    ['not_yours', 404, 'woc_market.not_yours'],
    // Lost races: the request was well formed and the world moved.
    ['not_active', 409, 'woc_market.not_active'],
    ['has_bids', 409, 'woc_market.has_bids'],
    ['already_pending', 409, 'woc_market.already_pending'],
    ['quote_expired', 409, 'woc_market.quote_expired'],
    ['not_pending', 409, 'woc_market.not_pending'],
    ['confirm_failed', 409, 'woc_market.confirm_failed'],
    // A recorded signature is awaiting the chain: refresh/abandon wait (409
    // says retry once the verdict lands, never a terminal refusal).
    ['confirm_in_flight', 409, 'woc_market.confirm_in_flight'],
    ['buy_now_locked', 409, 'woc_market.buy_now_locked'],
    // Seller cancel-intent stands on the listing: no new claims or bids.
    ['cancel_pending', 409, 'woc_market.cancel_pending'],
    // The claimer's own abandon history refuses the claim; it ages out on its
    // own (per-listing cooldown or the hourly cap window), so 409 not 403.
    ['claim_cooldown', 409, 'woc_market.claim_cooldown'],
    // The bond seat itself is closing: a fresh quote would outlive the
    // lapse deadline, so re-bidding (not re-quoting) is the recovery.
    ['bond_window_closed', 409, 'woc_market.bond_window_closed'],
    // A payment is in flight (buy-now lock claimed or a settlement past
    // 'offered'): the state resolves on its own, so 409 says retry, and the
    // seller learns nothing about the buyer beyond "a payment exists".
    ['settlement_in_flight', 409, 'woc_market.settlement_in_flight'],
    // Plain row contention (bounded lock wait expired or deadlock victim):
    // retry immediately, nothing about the listing is disclosed.
    ['contended', 409, 'woc_market.contended'],
    // An admin sale correction blocked by a standing non-excluded row.
    ['sale_conflict', 409, 'woc_market.sale_conflict'],
    ['cap_reached', 409, 'woc_market.cap_reached'],
    ['signature_reused', 409, 'woc_market.signature_reused'],
    // Bad input the client should have caught.
    ['character_invalid', 400, 'woc_market.character_invalid'],
    ['bid_too_low', 400, 'woc_market.bid_too_low'],
    ['insufficient_balance', 400, 'woc_market.insufficient_balance'],
    ['no_buy_now', 400, 'woc_market.no_buy_now'],
    // Both stale-copy shapes collapse to ONE player-facing code: the remedy is
    // identical (re-select the item), and splitting them would leak which half
    // of the escrow edge refused.
    ['lease_lost', 409, 'woc_market.stale_item'],
    ['stale_copy', 409, 'woc_market.stale_item'],
    // The directed bait-and-switch guard (H10): its OWN code, not a
    // stale_item collapse, because the fix is a fresh deal, not a re-select.
    ['item_mismatch', 409, 'woc_market.item_mismatch'],
    // One live directed deal per pair (its own code: already_pending's copy
    // describes a pending BID on a listing, a different rail).
    ['offer_pending', 409, 'woc_market.offer_pending'],
    // Every eligibility shape collapses to one code too: naming which policy
    // rule refused exposes the policy to probing.
    ['soulbound', 400, 'woc_market.not_eligible'],
    ['quest_item', 400, 'woc_market.not_eligible'],
    ['no_market_list', 400, 'woc_market.not_eligible'],
    ['bound_copy', 400, 'woc_market.not_eligible'],
    ['bind_armed', 400, 'woc_market.not_eligible'],
    ['unknown_item', 400, 'woc_market.not_eligible'],
    ['not_eligible_category', 400, 'woc_market.not_eligible'],
    ['below_quality_floor', 400, 'woc_market.not_eligible'],
    ['excluded_item', 400, 'woc_market.not_eligible'],
    // The one eligibility refusal that does NOT collapse (R10): the player's
    // own item lock is liftable by them, so the copy must say so.
    ['locked', 400, 'woc_market.item_locked'],
    // Malformed listing params share one code; the client validates the fields.
    ['bad_format', 400, 'woc_market.invalid_params'],
    ['bad_start', 400, 'woc_market.invalid_params'],
    ['bad_reserve', 400, 'woc_market.invalid_params'],
    ['bad_buy_now', 400, 'woc_market.invalid_params'],
    ['bad_duration', 400, 'woc_market.invalid_params'],
    ['bad_directed_buyer', 400, 'woc_market.invalid_params'],
    ['recipient_wallet_required', 403, 'woc_market.recipient_wallet_required'],
    ['self_offer', 400, 'woc_market.self_offer'],
    ['offer_expired', 410, 'woc_market.offer_expired'],
    // Wallet step-up on the custody movers (B6/R1): 403 auth-class, except
    // the lapsed challenge, a 410 like offer_expired (the fix is a fresh
    // challenge, not different credentials).
    ['stepup_required', 403, 'woc_market.stepup_required'],
    ['stepup_challenge_invalid', 403, 'woc_market.stepup_challenge_invalid'],
    ['stepup_challenge_expired', 410, 'woc_market.stepup_challenge_expired'],
    ['stepup_wallet_mismatch', 403, 'woc_market.stepup_wallet_mismatch'],
    ['stepup_binding_mismatch', 403, 'woc_market.stepup_binding_mismatch'],
    ['stepup_signature_invalid', 403, 'woc_market.stepup_signature_invalid'],
  ];

  it('pins EVERY refusal in the map, with no row left to the generic sweep', () => {
    // Both directions: no row in the map is missing from the table, and no row
    // in the table has gone stale. This is what makes the per-row pins below
    // exhaustive rather than a sample.
    expect(WIRE.map(([reason]) => reason).sort()).toEqual(Object.keys(REFUSAL_ERRORS).sort());
  });

  it.each(WIRE)('%s maps to %i %s', (reason, status, code) => {
    expect(REFUSAL_ERRORS[reason]).toEqual({ status, code });
  });

  it('groups reasons onto a shared code ONLY where the collapse is deliberate', () => {
    // The inverse direction of the table above: assert the two intended
    // many-to-one groups are exactly as wide as intended, so a NEW reason
    // silently joining stale_item or not_eligible fails here.
    const withCode = (code: string) =>
      Object.entries(REFUSAL_ERRORS)
        .filter(([, m]) => m.code === code)
        .map(([reason]) => reason)
        .sort();
    expect(withCode('woc_market.stale_item')).toEqual(['lease_lost', 'stale_copy']);
    // The third group. A new reason quietly mapped to invalid_params, which the
    // client renders as one generic message, passed every other test here.
    expect(withCode('woc_market.invalid_params')).toEqual([
      'bad_buy_now',
      'bad_directed_buyer',
      'bad_duration',
      'bad_format',
      'bad_reserve',
      'bad_start',
    ]);
    expect(withCode('woc_market.not_eligible')).toEqual([
      'below_quality_floor',
      'bind_armed',
      'bound_copy',
      'excluded_item',
      'no_market_list',
      'not_eligible_category',
      'quest_item',
      'soulbound',
      'unknown_item',
    ]);
  });

  it('gates offer creation at the schema, then forwards the whole agreed copy and the terms flag', async () => {
    // The agreed-item identity became REQUIRED wire contract (H10): an old
    // cached client posting the pre-pin body must get a 400, never an offer
    // with nothing pinned (which was the bait-and-switch surface itself).
    let reached = 0;
    // The double CAPTURES its argument: a double that only counts calls
    // proves the request was not rejected, never that the decoded identity
    // reached the service, so dropping a field from the forwarded item would
    // pass every assertion a bare counter can make.
    type OfferArgs = Parameters<WocMarketService['createDirectedOffer']>[0];
    const forwarded: OfferArgs[] = [];
    service({
      createDirectedOffer: (async (args: OfferArgs) => {
        reached += 1;
        forwarded.push(args);
        throw new Error('unreachable');
      }) as unknown as WocMarketService['createDirectedOffer'],
    });
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/woc-market/offers',
      account: { accountId: VIEWER, scope: 'full' },
      body: { characterId: 1, sellerCharacterName: 'Selara', usdCents: 5000 },
    });
    await expect(handlerFor('POST', '/api/woc-market/offers')(ctx)).rejects.toMatchObject({
      status: 400,
    });
    expect(reached).toBe(0);
    // An oversized instance payload refuses the same way (the recursive
    // fingerprint serializer downstream must never see unbounded nesting).
    const deep = fakeCtx({
      method: 'POST',
      url: '/api/woc-market/offers',
      account: { accountId: VIEWER, scope: 'full' },
      body: {
        characterId: 1,
        sellerCharacterName: 'Selara',
        usdCents: 5000,
        itemId: 'crown_of_embers',
        itemInstance: { rolled: { stats: { str: 'x'.repeat(3000) } } },
      },
    });
    await expect(handlerFor('POST', '/api/woc-market/offers')(deep)).rejects.toMatchObject({
      status: 400,
    });
    expect(reached).toBe(0);
    // The bound counts BYTES, not UTF-16 code units: this payload sits under
    // 2048 in .length but over it in utf8 bytes, so a code-unit measure
    // would quietly triple the budget for non-ASCII payloads.
    const wide = { rolled: { stats: { str: 'あ'.repeat(900) } } };
    expect(JSON.stringify(wide).length).toBeLessThan(2048);
    expect(Buffer.byteLength(JSON.stringify(wide), 'utf8')).toBeGreaterThan(2048);
    const wideCtx = fakeCtx({
      method: 'POST',
      url: '/api/woc-market/offers',
      account: { accountId: VIEWER, scope: 'full' },
      body: {
        characterId: 1,
        sellerCharacterName: 'Selara',
        usdCents: 5000,
        itemId: 'crown_of_embers',
        itemInstance: wide,
      },
    });
    await expect(handlerFor('POST', '/api/woc-market/offers')(wideCtx)).rejects.toMatchObject({
      status: 400,
    });
    expect(reached).toBe(0);
    // The positive direction: a realistic worst-case payload (a rift piece
    // with rolled stats, an enchant, a signer, charges, and provenance) sits
    // WELL under the bound and must reach the service, or a legitimate
    // listing refuses as invalid input.
    const heavy = {
      signer: 'Aurelia the Unbroken',
      craftedBy: 'Aurelia the Unbroken',
      charges: { rift_surge: 3, ember_ward: 2 },
      enchant: { id: 'ench_greater_flame_ward', power: 42 },
      rolled: { quality: 'epic', masterwork: true, stats: { str: 18, sta: 22, crit: 7 } },
      rift: { tier: 4, floor: 12, seed: 991_223, forge: { level: 3, sockets: ['ruby', 'ruby'] } },
      bindOnTrade: false,
    };
    expect(JSON.stringify(heavy).length).toBeLessThan(2048);
    const ok = fakeCtx({
      method: 'POST',
      url: '/api/woc-market/offers',
      account: { accountId: VIEWER, scope: 'full' },
      body: {
        characterId: 1,
        sellerCharacterName: 'Selara',
        usdCents: 5000,
        itemId: 'crown_of_embers',
        itemInstance: heavy,
        itemCraftedRecipeId: 'recipe_ember_crown',
        acceptTerms: true,
      },
    });
    await expect(handlerFor('POST', '/api/woc-market/offers')(ok)).rejects.toThrow('unreachable');
    expect(reached).toBe(1);
    // The WHOLE agreed-copy identity has to survive the decode: itemId, the
    // instance payload, and the crafted provenance are the three legs of the
    // pin the seller's acceptance is checked against, so a dropped leg here
    // is a bait-and-switch hole that no refusal test can see.
    expect(forwarded[0]).toMatchObject({
      account: VIEWER,
      characterId: 1,
      sellerCharacterName: 'Selara',
      usdCents: 5000,
      item: {
        itemId: 'crown_of_embers',
        instance: heavy,
        craftedRecipeId: 'recipe_ember_crown',
      },
      acceptTerms: true,
    });
    // acceptTerms follows the posted flag STRICTLY: the offer is a strikeable
    // commitment, so an absent (or non-true) field must forward false rather
    // than accept the terms on the buyer's behalf.
    const untermed = fakeCtx({
      method: 'POST',
      url: '/api/woc-market/offers',
      account: { accountId: VIEWER, scope: 'full' },
      body: {
        characterId: 1,
        sellerCharacterName: 'Selara',
        usdCents: 5000,
        itemId: 'crown_of_embers',
        acceptTerms: 'yes',
      },
    });
    await expect(handlerFor('POST', '/api/woc-market/offers')(untermed)).rejects.toThrow(
      'unreachable',
    );
    expect(reached).toBe(2);
    expect(forwarded[1].acceptTerms).toBe(false);
    // And the copy with nothing but an id forwards no instance and no
    // provenance, rather than inventing empty ones the pin would digest.
    expect(forwarded[1].item).toEqual({ itemId: 'crown_of_embers' });
  });

  it('surfaces a service refusal through a real handler as that status and code', async () => {
    // Proof the table is actually WIRED, not just well shaped: the pins above
    // would all pass over a map no handler consulted.
    service({ cancelListing: async () => ({ ok: false, reason: 'has_bids' }) });
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/woc-market/listings/41/cancel',
      params: { id: '41' },
      account: { accountId: VIEWER, scope: 'full' },
    });
    await expect(
      handlerFor('POST', '/api/woc-market/listings/:id/cancel')(ctx),
    ).rejects.toMatchObject({ status: 409, code: 'woc_market.has_bids' });
  });

  it('maps a stale-copy refusal to the shared code through the same handler', async () => {
    service({ cancelListing: async () => ({ ok: false, reason: 'lease_lost' }) });
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/woc-market/listings/41/cancel',
      params: { id: '41' },
      account: { accountId: VIEWER, scope: 'full' },
    });
    await expect(
      handlerFor('POST', '/api/woc-market/listings/:id/cancel')(ctx),
    ).rejects.toMatchObject({ status: 409, code: 'woc_market.stale_item' });
  });

  it('forwards cancelPending to the wire when the cancel was accepted as intent', async () => {
    // The wire hop itself: the service arm and the SDK arm each pin their own
    // side, so only this handler decides whether the seller hears "cancelled"
    // or "cancel pending". A regression to a bare { ok: true } body stays
    // green everywhere else.
    service({ cancelListing: async () => ({ ok: true, cancelPending: true }) });
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/woc-market/listings/41/cancel',
      params: { id: '41' },
      account: { accountId: VIEWER, scope: 'full' },
    });
    await handlerFor('POST', '/api/woc-market/listings/:id/cancel')(ctx);
    expect(sent(ctx)).toEqual({ status: 200, body: { ok: true, cancelPending: true } });
  });

  it('omits cancelPending entirely on a plain completed cancel', async () => {
    service({ cancelListing: async () => ({ ok: true }) });
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/woc-market/listings/41/cancel',
      params: { id: '41' },
      account: { accountId: VIEWER, scope: 'full' },
    });
    await handlerFor('POST', '/api/woc-market/listings/:id/cancel')(ctx);
    // toEqual on the WHOLE body: the plain arm must not leak a cancelPending
    // key (false would read as intent-refused to a client checking presence).
    expect(sent(ctx)).toEqual({ status: 200, body: { ok: true } });
  });

  it.each([
    ['a newline', 'sig\nforged-log-line'],
    ['a carriage return', 'sig\rback'],
    ['an ANSI escape', 'sig\u001b[31mred'],
    ['whitespace', 'sig with spaces'],
  ])('refuses a signature carrying %s on BOTH confirm intakes', async (_label, signature) => {
    // The recorded signature is interpolated into an ops warn on the
    // revived-signature path and forwarded to the economy service, so the
    // intake shape-checks it: anything outside safe printable characters is
    // a log-forging vector, refused BEFORE any recording (nothing so shaped
    // can be a broadcast payment; real Solana signatures are base58).
    service({});
    const bond = fakeCtx({
      method: 'POST',
      url: '/api/woc-market/bids/7/bond',
      params: { id: '7' },
      account: { accountId: VIEWER, scope: 'full' },
      body: { signature },
    });
    await expect(handlerFor('POST', '/api/woc-market/bids/:id/bond')(bond)).rejects.toMatchObject({
      status: 400,
      code: 'woc_market.invalid_input',
    });
    const settle = fakeCtx({
      method: 'POST',
      url: '/api/woc-market/settlements/9/confirm',
      params: { id: '9' },
      account: { accountId: VIEWER, scope: 'full' },
      body: { signature },
    });
    await expect(
      handlerFor('POST', '/api/woc-market/settlements/:id/confirm')(settle),
    ).rejects.toMatchObject({ status: 400, code: 'woc_market.invalid_input' });
  });

  it('passes a dev-style tagged signature through the shape check', async () => {
    // The dev economy and the whole test corpus post plain tagged strings
    // ('sig-my-bond-1'); the shape bound deliberately admits [A-Za-z0-9_:-].
    let seen: string | null = null;
    service({
      confirmBond: async (_a: number, _b: number, sig: string) => {
        seen = sig;
        return { ok: true, standing: true };
      },
    });
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/woc-market/bids/7/bond',
      params: { id: '7' },
      account: { accountId: VIEWER, scope: 'full' },
      body: { signature: 'sig-my_bond-1' },
    });
    await handlerFor('POST', '/api/woc-market/bids/:id/bond')(ctx);
    expect(seen).toBe('sig-my_bond-1');
  });

  it('passes the trade controller devsig form, colons included', async () => {
    // The dev-chain arm posts devsig:<reference>, and references themselves
    // carry colons (woc_bond:<id>); refusing the colon broke the p2p trade
    // settle whenever the service answered signatureRequired false.
    let seen: string | null = null;
    service({
      confirmSettlement: async (_a: number, _b: number, sig: string) => {
        seen = sig;
        return { ok: true, state: 'delivered' };
      },
    });
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/woc-market/settlements/9/confirm',
      params: { id: '9' },
      account: { accountId: VIEWER, scope: 'full' },
      body: { signature: 'devsig:woc_settle:9:1' },
    });
    await handlerFor('POST', '/api/woc-market/settlements/:id/confirm')(ctx);
    expect(seen).toBe('devsig:woc_settle:9:1');
  });

  it('the buy-now handler passes refusal params through (the cooldown remaining time)', async () => {
    // The Refused.params channel: throwRefusal must hand them to HttpError,
    // or the code's declared retryAfterSeconds placeholder never renders.
    service({
      buyNow: async () => ({
        ok: false,
        reason: 'claim_cooldown',
        params: { retryAfterSeconds: 55 },
      }),
    });
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/woc-market/listings/41/buy-now',
      params: { id: '41' },
      account: { accountId: VIEWER, scope: 'full' },
      body: { characterId: 3, acceptTerms: true },
    });
    await expect(
      handlerFor('POST', '/api/woc-market/listings/:id/buy-now')(ctx),
    ).rejects.toMatchObject({
      status: 409,
      code: 'woc_market.claim_cooldown',
      params: { retryAfterSeconds: 55 },
    });
  });

  it('the admin suspend handler throws REGISTERED codes, never inline English', async () => {
    // 'adminTargetId' is the require_admin middleware's private state key; the
    // literal doubles as a pin on that contract. The handler now throws
    // HttpError (the admin envelope serializer puts the CODE in `error`, so
    // operators get the same registry players do): 409 for both retryable
    // classes, 404 for a miss. Contention is 409, never the 404 that would
    // read as "gone" and stop the operator retrying.
    const drive = async (reason: 'settlement_in_flight' | 'contended' | 'not_found') => {
      service({ adminSuspendListing: async () => ({ ok: false, reason }) });
      const ctx = fakeCtx({
        method: 'POST',
        url: '/admin/api/woc-market/listings/41/suspend',
        params: { id: '41' },
      });
      ctx.state.set('adminTargetId', 41);
      return handlerFor('POST', '/admin/api/woc-market/listings/:id/suspend')(ctx);
    };
    await expect(drive('settlement_in_flight')).rejects.toMatchObject({
      status: 409,
      code: 'woc_market.settlement_in_flight',
    });
    await expect(drive('contended')).rejects.toMatchObject({
      status: 409,
      code: 'woc_market.contended',
    });
    await expect(drive('not_found')).rejects.toMatchObject({
      status: 404,
      code: 'woc_market.not_found',
    });
  });

  it('the admin listings-by-seller handler refuses a bad account with the registered code', async () => {
    // The sibling of the two arms above: an unparsable ?account= used to write
    // inline English ('invalid account') straight into the admin envelope,
    // the one arm the code conversion missed. Same registry, same surface.
    const drive = async (account: string) => {
      service({ adminListingsBySeller: async () => [] });
      const ctx = fakeCtx({
        method: 'GET',
        url: `/admin/api/woc-market/listings?account=${account}`,
        query: { account },
      });
      return handlerFor('GET', '/admin/api/woc-market/listings')(ctx);
    };
    await expect(drive('abc')).rejects.toMatchObject({
      status: 400,
      code: 'woc_market.invalid_input',
    });
    await expect(drive('0')).rejects.toMatchObject({ status: 400 });
    // A valid id reaches the service and answers the envelope.
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/woc-market/listings?account=41',
      query: { account: '41' },
    });
    service({ adminListingsBySeller: async () => [] });
    await handlerFor('GET', '/admin/api/woc-market/listings')(ctx);
    expect(sent(ctx).status).toBe(200);
  });

  it('the admin sale-excluded handler throws the registered sale_conflict code', async () => {
    const drive = async (reason: 'sale_conflict' | 'not_found') => {
      service({ adminSetSaleExcluded: async () => ({ ok: false, reason }) });
      const ctx = fakeCtx({
        method: 'POST',
        url: '/admin/api/woc-market/sales/7/excluded',
        params: { id: '7' },
        body: { excluded: true },
      });
      ctx.state.set('adminTargetId', 7);
      return handlerFor('POST', '/admin/api/woc-market/sales/:id/excluded')(ctx);
    };
    await expect(drive('sale_conflict')).rejects.toMatchObject({
      status: 409,
      code: 'woc_market.sale_conflict',
    });
    await expect(drive('not_found')).rejects.toMatchObject({
      status: 404,
      code: 'woc_market.not_found',
    });
  });
});

describe('trade-partner reads the router-parsed query', () => {
  it('passes ctx.query.name to the service, not a re-parse of req.url', async () => {
    // The handler reads ctx.query, the value the router already parsed and
    // validated; a second parser over ctx.req.url can desync from it. The
    // fake ctx sets query without a matching url, so the old re-parse would
    // have read an empty name here.
    let seen: string | null = null;
    service({
      tradePartner: async (_account: number, name: string) => {
        seen = name;
        return { name, walletVerified: true } as Awaited<
          ReturnType<WocMarketService['tradePartner']>
        >;
      },
    });
    const ctx = readCtx({ query: { name: 'Aldan' } });
    await handlerFor('GET', '/api/woc-market/trade-partner')(ctx);
    expect(seen).toBe('Aldan');
    expect(sent(ctx).status).toBe(200);
  });

  it('404s when the partner does not resolve', async () => {
    service({ tradePartner: async () => null });
    const ctx = readCtx({ query: { name: 'Nobody' } });
    await expect(handlerFor('GET', '/api/woc-market/trade-partner')(ctx)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('the create-listing format gate', () => {
  /** Drive the create handler and report the params the service was handed, or
   *  the HttpError the schema gate raised before the service was reached. */
  async function createWith(
    format: string,
  ): Promise<{ params: Record<string, unknown> } | { status: number; code: string }> {
    let seen: Record<string, unknown> | null = null;
    service({
      createListing: async (req: { params: Record<string, unknown> }) => {
        seen = req.params;
        return { ok: true, listing: listingRow({ format: format as WocListingRow['format'] }) };
      },
    } as unknown as Partial<WocMarketService>);
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/woc-market/listings',
      account: { accountId: VIEWER, scope: 'full' },
      body: {
        characterId: 12,
        itemIndex: 0,
        itemId: 'deathlord_warplate',
        format,
        startCents: 2500,
        reserveCents: null,
        buyNowCents: 25_000,
        durationHours: 24,
      },
    });
    try {
      await handlerFor('POST', '/api/woc-market/listings')(ctx);
    } catch (err) {
      const e = err as { status: number; code: string };
      return { status: e.status, code: e.code };
    }
    if (seen === null) throw new Error('the service was never called');
    return { params: seen };
  }

  it('lets a combined listing through to the rules, rather than refusing at the wire', async () => {
    // The route keeps its OWN format allowlist, so the rules core allowing
    // 'auction_buy_now' is not enough on its own: this gate runs first and would
    // have refused it as invalid_params before validListingParams ever saw it.
    // Pinned because the two lists are in different files and only this proves
    // they agree.
    const out = await createWith('auction_buy_now');
    expect(out).toHaveProperty('params');
    expect((out as { params: Record<string, unknown> }).params.format).toBe('auction_buy_now');
  });

  it.each(['auction', 'buy_now'])('still lets %s through', async (format) => {
    const out = await createWith(format);
    expect((out as { params: Record<string, unknown> }).params.format).toBe(format);
  });

  it.each(['dutch', 'AUCTION', '', 'buy-now'])(
    'still refuses %s at the wire, before the service',
    async (format) => {
      expect(await createWith(format)).toEqual({ status: 400, code: 'woc_market.invalid_input' });
    },
  );
});

describe('the public listing view', () => {
  it('hides the exact reserve, both wallets, the seller ids and the lock holder', async () => {
    const listing = await viewOf({});
    // The PRD's hidden-reserve rule: met or not, never the number.
    expect(listing.hasReserve).toBe(true);
    expect(listing).not.toHaveProperty('reserveCents');
    // Wallets and account ids never cross the wire on a public read.
    expect(listing).not.toHaveProperty('sellerWallet');
    expect(listing).not.toHaveProperty('sellerAccount');
    expect(listing).not.toHaveProperty('sellerCharacter');
    // The lock is a boolean; the holder's account id stays server-side.
    expect(listing).not.toHaveProperty('buyNowLockAccount');
    expect(listing).not.toHaveProperty('buyNowLockExpiresMs');
    expect(listing.buyNowLocked).toBe(true);
    // Nothing named like a wallet or a reserve slipped in under another key.
    expect(Object.keys(listing).join(',')).not.toMatch(/wallet|reserveCents|lockAccount/i);
  });

  it('reports reserveMet false while the standing bid is under the reserve', async () => {
    expect((await viewOf({ currentBidCents: 9_999 })).reserveMet).toBe(false);
  });

  it('reports reserveMet true once the standing bid reaches the reserve', async () => {
    // Boundary, not a comfortable margin: the rule is >=, and a > would pass a
    // 10_001 case while failing real sellers at exactly the reserve.
    expect((await viewOf({ currentBidCents: 10_000 })).reserveMet).toBe(true);
  });

  it('reports reserveMet false when no bid stands at all', async () => {
    expect((await viewOf({ currentBidCents: null })).reserveMet).toBe(false);
  });

  it('reports no reserve at all when the seller set none', async () => {
    const listing = await viewOf({ reserveCents: null });
    expect(listing.hasReserve).toBe(false);
    // null, not false: "no reserve" and "reserve unmet" are different states
    // and the window renders different text for each.
    expect(listing.reserveMet).toBeNull();
  });

  it('reports the lock free once its expiry has passed', async () => {
    const listing = await viewOf({ buyNowLockAccount: 1234, buyNowLockExpiresMs: 1_000 });
    expect(listing.buyNowLocked).toBe(false);
  });

  it('reports the lock free when nobody holds it', async () => {
    const listing = await viewOf({ buyNowLockAccount: null, buyNowLockExpiresMs: null });
    expect(listing.buyNowLocked).toBe(false);
  });

  it('reports the lock free on a holder with no expiry (the fourth combination)', async () => {
    // The predicate ANDs two fields; without this case the expiry clause could
    // be dropped and every other arm still passed.
    const listing = await viewOf({ buyNowLockAccount: 1234, buyNowLockExpiresMs: null });
    expect(listing.buyNowLocked).toBe(false);
  });

  it("marks the viewer's own listing so the client can refuse self-bidding early", async () => {
    expect((await viewOf({ sellerAccount: VIEWER })).mine).toBe(true);
    expect((await viewOf({ sellerAccount: SELLER })).mine).toBe(false);
  });

  it('sends the bond for the next legal bid, so the client computes no money', async () => {
    // The client must never derive a token amount (the PRD rule, and src/ui may
    // not import server/): the minimum next bid AND its bond ride the view.
    const listing = await viewOf({ currentBidCents: 5000, startCents: 2500 });
    expect(typeof listing.minNextBidCents).toBe('number');
    expect(listing.minNextBidCents as number).toBeGreaterThan(5000);
    expect(typeof listing.minNextBidBondCents).toBe('number');
    expect(listing.minNextBidBondCents as number).toBeGreaterThan(0);
    // The bond is a fraction of the bid, never the whole bid.
    expect(listing.minNextBidBondCents as number).toBeLessThan(listing.minNextBidCents as number);
  });
});

describe('browse query decoding', () => {
  it.each(['1e400', '1e20', '-1', 'abc', '1.5', '401'])(
    'refuses page=%s rather than passing it to the SQL OFFSET',
    async (page) => {
      service({ browse: async () => ({ rows: [], hasMore: false }) });
      const ctx = readCtx({ url: `/api/woc-market/listings?page=${page}`, query: { page } });
      await expect(handlerFor('GET', '/api/woc-market/listings')(ctx)).rejects.toMatchObject({
        status: 400,
        code: 'woc_market.invalid_input',
      });
    },
  );

  it.each([
    ['sort', 'ends_at;DROP TABLE'],
    ['quality', 'common'],
    ['format', 'dutch'],
  ])('refuses %s outside its allowlist', async (key, value) => {
    service({ browse: async () => ({ rows: [], hasMore: false }) });
    const ctx = readCtx({ query: { [key]: value } });
    await expect(handlerFor('GET', '/api/woc-market/listings')(ctx)).rejects.toMatchObject({
      status: 400,
      code: 'woc_market.invalid_input',
    });
  });

  it('passes a valid page and sort through, and answers hasMore, never a total', async () => {
    let seen: WocBrowseQuery | null = null;
    service({
      browse: async (q) => {
        seen = q;
        return { rows: [], hasMore: true };
      },
    });
    const ctx = readCtx({ query: { page: '2', sort: 'price_desc' } });
    await handlerFor('GET', '/api/woc-market/listings')(ctx);
    expect(seen).toMatchObject({ page: 2, sort: 'price_desc', pageSize: 25 });
    const { body } = sent(ctx);
    expect(body.hasMore).toBe(true);
    expect(body.page).toBe(2);
    // A total would mean the COUNT(*) OVER() came back: the has-more probe
    // replaced it precisely because that read every live listing per page.
    expect(body).not.toHaveProperty('total');
  });

  it('passes hasMore FALSE through as false, never a truthy default', async () => {
    // The true arm alone would pass over `hasMore: x || true`.
    service({ browse: async () => ({ rows: [], hasMore: false }) });
    const ctx = readCtx();
    await handlerFor('GET', '/api/woc-market/listings')(ctx);
    expect(sent(ctx).body.hasMore).toBe(false);
  });

  it('defaults to the ending-soonest sort and page 0 with no query at all', async () => {
    let seen: WocBrowseQuery | null = null;
    service({
      browse: async (q) => {
        seen = q;
        return { rows: [], hasMore: false };
      },
    });
    await handlerFor('GET', '/api/woc-market/listings')(readCtx());
    expect(seen).toMatchObject({ page: 0, sort: 'ending', quality: null, format: null });
  });

  it.each([
    ['a space', 'sun blade'],
    ['a separator byte', 'sun\x1fblade'],
    ['a quote', "sun'blade"],
    ['over-length', 'x'.repeat(129)],
  ])(
    'refuses an itemIds entry with %s (the closed id charset is the cache-key fence)',
    async (_label, hostile) => {
      service({ browse: async () => ({ rows: [], hasMore: false }) });
      const ctx = readCtx({ query: { itemIds: `sunblade,${hostile}` } });
      await expect(handlerFor('GET', '/api/woc-market/listings')(ctx)).rejects.toMatchObject({
        status: 400,
        code: 'woc_market.invalid_input',
      });
    },
  );

  it('canonicalizes the itemIds filter: sorted, de-duplicated, empty means null', async () => {
    const seen: (readonly string[] | null)[] = [];
    service({
      browse: async (q) => {
        seen.push(q.itemIds);
        return { rows: [], hasMore: false };
      },
    });
    // Order and duplicates collapse to ONE canonical list, so equivalent
    // filters stay equivalent everywhere downstream (the cache-key rule).
    await handlerFor('GET', '/api/woc-market/listings')(readCtx({ query: { itemIds: 'b,a,b' } }));
    expect(seen[0]).toEqual(['a', 'b']);
    // An empty list and an absent param mean the same "no filter".
    await handlerFor('GET', '/api/woc-market/listings')(readCtx({ query: { itemIds: '' } }));
    expect(seen[1]).toBeNull();
  });

  it.each([
    ['a space', 'sun blade'],
    ['over-length', 'x'.repeat(129)],
  ])(
    'refuses a history item id with %s (the same closed-charset screen)',
    async (_label, hostile) => {
      service({ salesHistory: async () => [] });
      const ctx = readCtx({
        url: `/api/woc-market/history/${encodeURIComponent(hostile)}`,
        params: { itemId: hostile },
      });
      await expect(handlerFor('GET', '/api/woc-market/history/:itemId')(ctx)).rejects.toMatchObject(
        {
          status: 400,
          code: 'woc_market.invalid_input',
        },
      );
    },
  );

  it.each([
    ['a leading space', ' Lorak'],
    ['a percent wildcard', 'Lor%ak'],
    ['an underscore wildcard', 'Lor_ak'],
    ['over-length', 'x'.repeat(33)],
  ])('refuses a seller-history name with %s (the shape screen)', async (_label, hostile) => {
    // Names have no closed vocabulary (unlike item ids), so the shape bound
    // is the whole screen: the read is parameterized and capped underneath,
    // and the cache arm behind it is a bounded LRU.
    service({ sellerSalesHistory: async () => ({ sales: [], profile: null }) });
    const ctx = readCtx({
      url: `/api/woc-market/seller-history/${encodeURIComponent(hostile)}`,
      params: { name: hostile },
    });
    await expect(
      handlerFor('GET', '/api/woc-market/seller-history/:name')(ctx),
    ).rejects.toMatchObject({ status: 400, code: 'woc_market.invalid_input' });
  });

  it('serves a seller history and passes the exact name through', async () => {
    const seen: string[] = [];
    service({
      sellerSalesHistory: async (name: string) => {
        seen.push(name);
        return { sales: [], profile: null };
      },
    });
    const ctx = readCtx({
      url: '/api/woc-market/seller-history/Lorak',
      params: { name: 'Lorak' },
    });
    await handlerFor('GET', '/api/woc-market/seller-history/:name')(ctx);
    expect(seen).toEqual(['Lorak']);
  });

  it('caps the itemIds filter instead of building an unbounded IN list', async () => {
    // Collected into an array rather than a nullable local: assigning inside the
    // callback leaves the narrowed type at `null` for the property read below.
    const seen: WocBrowseQuery[] = [];
    service({
      browse: async (q) => {
        seen.push(q);
        return { rows: [], hasMore: false };
      },
    });
    const many = Array.from({ length: 120 }, (_, i) => `item_${i}`).join(',');
    await handlerFor('GET', '/api/woc-market/listings')(readCtx({ query: { itemIds: many } }));
    expect(seen).toHaveLength(1);
    expect(seen[0].itemIds).toHaveLength(50);
  });
});

describe('the :id parameter', () => {
  it.each(['0', '-1', 'abc', '1.5', '1e3', '', '01x'])(
    'refuses id=%s before any service call',
    async (id) => {
      let called = false;
      service({
        listingDetail: async () => {
          called = true;
          return null;
        },
      });
      const ctx = readCtx({ url: `/api/woc-market/listings/${id}`, params: { id } });
      await expect(handlerFor('GET', '/api/woc-market/listings/:id')(ctx)).rejects.toMatchObject({
        status: 400,
      });
      expect(called).toBe(false);
    },
  );

  it('answers 404 for a listing that does not exist', async () => {
    service({ listingDetail: async () => null });
    const ctx = readCtx({ url: '/api/woc-market/listings/41', params: { id: '41' } });
    await expect(handlerFor('GET', '/api/woc-market/listings/:id')(ctx)).rejects.toMatchObject({
      status: 404,
      code: 'woc_market.not_found',
    });
  });

  it('hides the same fields on the single-listing read as on browse', async () => {
    // The detail view is a second call site of listingView; a hand-rolled object
    // here instead would leak exactly the fields browse hides.
    service({ listingDetail: async () => ({ listing: listingRow(), estimate: null }) });
    const ctx = readCtx({ url: '/api/woc-market/listings/41', params: { id: '41' } });
    await handlerFor('GET', '/api/woc-market/listings/:id')(ctx);
    const listing = sent(ctx).body.listing as Record<string, unknown>;
    expect(listing).not.toHaveProperty('sellerWallet');
    expect(listing).not.toHaveProperty('reserveCents');
    expect(listing).not.toHaveProperty('buyNowLockAccount');
    expect(listing.hasReserve).toBe(true);
  });
});

describe('the route table shape', () => {
  it('gates every route behind a guard, and every mutation behind a limiter too', () => {
    const api = routes.filter((r) => r.surface === 'api');
    // 22 -> 23 with the seller-history read (the Browse click-through).
    expect(api).toHaveLength(23);
    for (const route of api) {
      expect(route.middleware?.length ?? 0, `${route.method} ${route.path}`).toBeGreaterThan(0);
    }
    // A mutating route carries the auth guard PLUS a rate limiter: these spend
    // real money and mint quotes, so an unmetered one is a defect.
    const posts = api.filter((r) => r.method === 'POST');
    expect(posts.length).toBeGreaterThanOrEqual(8);
    for (const route of posts) {
      expect(route.middleware?.length ?? 0, route.path).toBeGreaterThanOrEqual(2);
    }
  });

  it('marks the four operator routes admin-surfaced with the admin envelope', () => {
    const admin = routes.filter((r) => r.path.startsWith('/admin/'));
    expect(admin).toHaveLength(4);
    for (const route of admin) {
      expect(route.surface, route.path).toBe('admin');
      expect((route.meta as { envelope?: string } | undefined)?.envelope, route.path).toBe('admin');
    }
  });

  it('gives every player :id route either an owner loader or an explicit public marker', () => {
    // The BOLA rule: an owner-scoped :id route needs the requireOwned loader, and
    // a deliberately public one (anyone may bid on anyone's listing) needs the
    // publicRead marker. Neither means the route is silently unguarded.
    const idRoutes = routes.filter((r) => r.surface === 'api' && r.path.includes('/:'));
    // 13 -> 14 with seller-history/:name (publicRead, the history precedent).
    expect(idRoutes).toHaveLength(14);
    for (const route of idRoutes) {
      const meta = route.meta as { requireOwned?: unknown; publicRead?: boolean } | undefined;
      expect(
        meta?.requireOwned !== undefined || meta?.publicRead === true,
        `${route.method} ${route.path} has neither a requireOwned loader nor publicRead`,
      ).toBe(true);
    }
  });

  it('spells the read guard on reads and the active-account guard on mutations', () => {
    // Middleware are opaque closures once built, so the guard TIER is pinned on
    // the source text: a mutation silently downgraded to the read guard would
    // let a read-scope companion token spend money.
    const src = readFileSync(new URL('../../server/woc_market_routes.ts', import.meta.url), 'utf8');
    expect(src).toContain('const readAccount = createReadGuard(');
    expect(src).toContain('const activeAccount = createActiveGuard(');
    // Every player POST route in the table names activeAccount, never readAccount.
    const blocks = src.split(/\n {2}\{\n/).filter((b) => b.includes("method: 'POST'"));
    const playerBlocks = blocks.filter((b) => !b.includes("path: '/admin/"));
    // Derived from the live table, not a floor: an >= 8 floor was satisfiable by
    // the 3 admin blocks plus 5 player ones, so three player POST routes could
    // leave the table and the guard below would silently cover fewer routes.
    const posts = routes.filter((r) => r.surface === 'api' && r.method === 'POST');
    expect(playerBlocks).toHaveLength(posts.length);
    for (const block of blocks) {
      const path = /path: '([^']+)'/.exec(block)?.[1] ?? '?';
      if (path.startsWith('/admin/')) continue;
      expect(block, path).toContain('activeAccount');
      expect(block, path).not.toMatch(/middleware: \[readAccount/);
    }
    // /me is the one GET that returns the caller's own financial history
    // (open bids and amounts, settlement states, strikes, terms acceptance),
    // so it takes the FULL-scope guard: an OAuth companion token is minted
    // scope 'read' (server/oauth.ts issueReadToken), and a third-party app
    // authorized to read a character must not see marketplace finances. The
    // public reads (status, browse, detail, estimate, histories) stay on the
    // read guard deliberately: they expose nothing account-private.
    const meBlock = src.split(/\n {2}\{\n/).find((b) => b.includes("path: '/api/woc-market/me'"));
    expect(meBlock).toBeDefined();
    expect(meBlock).toContain('activeAccount');
    expect(meBlock).not.toMatch(/middleware: \[readAccount/);
  });
});

describe('the bid view: bond confirmation is visible to the bidder', () => {
  function bidRow(over: Partial<WocBidRow> = {}): WocBidRow {
    return {
      id: 31,
      listingId: 41,
      account: VIEWER,
      characterId: 12,
      characterName: 'Aurelia',
      wallet: 'BIDDERWALLETPUBKEY1111111111111111111111111',
      amountCents: 5000,
      status: 'pending_bond',
      bondCents: 500,
      bondState: 'pending',
      bondReference: 'bond-ref-1',
      bondQuoteExpiresAtMs: FAR_FUTURE_MS,
      bondSignature: null,
      bondSignatureAtMs: null,
      placedAtMs: 1_799_000_000_000,
      ...over,
    };
  }

  /** Drive the activity handler over one bid and return that bid's public view. */
  async function bidViewOf(over: Partial<WocBidRow>): Promise<Record<string, unknown>> {
    service({
      myActivity: async () => ({
        listings: [],
        bids: [bidRow(over)],
        settlements: [],
        strikes: null,
        termsAcceptedAtMs: null,
        wallet: null,
      }),
    } as unknown as Partial<WocMarketService>);
    const ctx = readCtx({ url: '/api/woc-market/me' });
    await handlerFor('GET', '/api/woc-market/me')(ctx);
    const { status, body } = sent(ctx);
    expect(status).toBe(200);
    return (body.bids as Record<string, unknown>[])[0];
  }

  it('reports a submitted-but-unconfirmed bond as confirming', async () => {
    // The window withholds its Pay Bond control on exactly this. Without the
    // field the client cannot tell "not paid" from "paid, verifying": neither
    // status nor bondState moves when the signature is recorded, and that gap is
    // when a second press would pay the same bond twice.
    expect(await bidViewOf({ bondSignature: 'sig-1' })).toMatchObject({
      status: 'pending_bond',
      bondState: 'pending',
      bondConfirming: true,
    });
  });

  it('reports an unpaid bond as NOT confirming, so the control is offered', async () => {
    expect(await bidViewOf({ bondSignature: null })).toMatchObject({ bondConfirming: false });
  });

  it('stops reporting confirming once the bid leaves pending_bond', async () => {
    // The signature STAYS on the row after the bond is held, so an unscoped
    // `bondSignature !== null` would report a long-settled bond as forever
    // confirming, which on the client means a permanent spinner and a fast poll
    // that never stands down.
    for (const status of ['active', 'won', 'lapsed', 'cancelled', 'defaulted'] as const) {
      const view = await bidViewOf({ status, bondSignature: 'sig-1', bondState: 'held' });
      expect(view.bondConfirming, status).toBe(false);
    }
  });

  it('never puts the signature itself on the wire', async () => {
    // A boolean is all the window needs; the signature is the bidder's on-chain
    // reference and no part of this view's job.
    const view = await bidViewOf({ bondSignature: 'sig-1' });
    expect(Object.keys(view)).not.toContain('bondSignature');
    expect(JSON.stringify(view)).not.toContain('sig-1');
  });
});

describe('the confirming-review bound env knob', () => {
  const KEY = 'WOC_MARKET_CONFIRMING_REVIEW_HOURS';
  const HOUR_MS = 3_600_000;
  afterEach(() => {
    delete process.env[KEY];
  });

  it('defaults to six hours when unset', () => {
    delete process.env[KEY];
    expect(wocMarketConfig().confirmingReviewMs).toBe(6 * HOUR_MS);
  });

  it.each([
    // The empty string is the FAIL-DANGEROUS arm: Number('') is 0, and a
    // zero bound makes every confirming row instantly overdue, parking every
    // in-flight payment in the operator review state.
    [''],
    ['   '],
    ['0'],
    ['-1'],
    ['abc'],
    ['Infinity'],
  ])('falls back to the default on %j', (raw) => {
    process.env[KEY] = raw;
    expect(wocMarketConfig().confirmingReviewMs).toBe(6 * HOUR_MS);
  });

  it('honors a real positive hour value', () => {
    process.env[KEY] = '2';
    expect(wocMarketConfig().confirmingReviewMs).toBe(2 * HOUR_MS);
    process.env[KEY] = '0.5';
    expect(wocMarketConfig().confirmingReviewMs).toBe(30 * 60_000);
  });

  it('clamps an over-ceiling value to 720 hours instead of disabling the bound', () => {
    // A huge value silently disables the H15 park (and past to_timestamp's
    // range it even breaks the sweep arm with 22008), so the knob clamps at
    // 30 days: the review bound cannot be configured out of existence.
    process.env[KEY] = '87600';
    expect(wocMarketConfig().confirmingReviewMs).toBe(720 * HOUR_MS);
    process.env[KEY] = '720';
    expect(wocMarketConfig().confirmingReviewMs).toBe(720 * HOUR_MS);
    process.env[KEY] = '719';
    expect(wocMarketConfig().confirmingReviewMs).toBe(719 * HOUR_MS);
  });
});

describe('the phantom TOTP scaffolding stays deleted (B6/R1)', () => {
  it('no market logic file mentions totp, and no .wm-totp CSS survives', () => {
    // The two woc_market.totp_* codes stay in error_codes.ts by the append-only
    // contract, but nothing may PRODUCE or read them again: the market service,
    // its routes, the step-up module, and the styles carry zero totp remnant, so
    // the retired control cannot silently regrow a producer.
    const url = (p: string) => new URL(`../../${p}`, import.meta.url);
    for (const p of [
      'server/woc_market.ts',
      'server/woc_market_routes.ts',
      'server/woc_market_stepup.ts',
    ]) {
      expect(readFileSync(url(p), 'utf8').toLowerCase(), p).not.toContain('totp');
    }
    const css = readFileSync(url('src/styles/components.css'), 'utf8');
    expect(css).not.toContain('wm-totp');
  });
});

describe('the devsig arm is production-unreachable by wiring (B6/R1)', () => {
  it('derives stepUpDevSig from the double-gated dev switch, never a literal', () => {
    // The service HONORS the flag in both directions (the service suite proves
    // a real ed25519 signature end to end with it false), but mutating
    // server/main.ts's wiring to stepUpDevSig: true would accept devsig:<nonce>
    // in production for every challenge, a total bypass, with every other test
    // still green. WOC_MARKET_DEV_SERVICE otherwise appears in no test. Pin the
    // wiring: the switch is the ALLOW_DEV_COMMANDS AND WOC_MARKET_DEV_SERVICE
    // conjunction, and stepUpDevSig reads that const, never a bare boolean.
    // Comment-stripped, or a doc comment quoting the wiring above a `true`
    // assignment would satisfy this while shipping the bypass; and pinned to
    // exactly ONE stepUpDevSig so a second WocMarketService construction cannot
    // hide the real one behind the first match.
    const main = stripComments(
      readFileSync(new URL('../../server/main.ts', import.meta.url), 'utf8'),
    );
    const i = main.indexOf('const wocMarketDevService');
    expect(i).toBeGreaterThanOrEqual(0);
    const decl = main.slice(i, main.indexOf(';', i) + 1);
    expect(decl).toContain("process.env.ALLOW_DEV_COMMANDS === '1'");
    expect(decl).toContain("process.env.WOC_MARKET_DEV_SERVICE === '1'");
    expect(decl).toContain('&&');
    // The assignment reads the double-gated const, never a bare boolean.
    const sites = [...main.matchAll(/stepUpDevSig:/g)];
    expect(sites, 'exactly one stepUpDevSig wiring site').toHaveLength(1);
    const j = sites[0].index ?? -1;
    const assign = main.slice(j, main.indexOf('\n', j));
    expect(assign).toContain('stepUpDevSig: wocMarketDevService');
    expect(assign).not.toMatch(/stepUpDevSig:\s*(?:true|false)\b/);
  });
});

describe('the step-up rate bucket (B6/R1)', () => {
  it('has its OWN bucket at double the list limit, so the mint-then-create pair never halves listing throughput', () => {
    // A literal pin: swapping the route to WOC_MARKET_READ_POLICY or deleting
    // the 'stepup' case from wocMarketMutationLimit both leave the counting
    // tests green otherwise.
    expect(WOC_MARKET_STEPUP_MAX_PER_MINUTE).toBe(20);
    expect(WOC_MARKET_STEPUP_MAX_PER_MINUTE).toBe(2 * WOC_MARKET_LIST_MAX_PER_MINUTE);
    expect(wocMarketMutationLimit('stepup')).toBe(WOC_MARKET_STEPUP_MAX_PER_MINUTE);
    // Its own named policy, ip+account keyed with a global tier-2, distinct
    // from every other market bucket by name.
    expect(WOC_MARKET_STEPUP_POLICY.name).toBe('woc_market_stepup');
    expect(WOC_MARKET_STEPUP_POLICY.limit).toBe(20);
    expect(WOC_MARKET_STEPUP_POLICY.keyClass).toBe('ip+account');
    expect(WOC_MARKET_STEPUP_POLICY.tier2).toBe('global');
  });
});

describe('the step-up surface at the route layer (B6/R1)', () => {
  const LISTING_BODY = {
    characterId: 12,
    itemIndex: 0,
    itemId: 'deathlord_warplate',
    format: 'auction',
    startCents: 2500,
    reserveCents: null,
    buyNowCents: null,
    durationHours: 12,
    offerNext: false,
  };
  const PROOF = { nonce: 'a'.repeat(32), signature: 'b'.repeat(87) };

  function postCtx(url: string, body: Record<string, unknown>, over: FakeCtxOverrides = {}) {
    return fakeCtx({
      method: 'POST',
      url,
      account: { accountId: VIEWER, scope: 'full' },
      body,
      ...over,
    });
  }

  it('passes the proof through to createListing verbatim, and NEVER a directed marker', async () => {
    // The service skips re-verification when args.directed is set (the
    // internal consummation call), so this handler must be structurally
    // unable to set it: a hostile body smuggling a directed key changes
    // nothing about what the service receives.
    let seen: Record<string, unknown> | null = null;
    service({
      createListing: async (args: unknown) => {
        seen = args as Record<string, unknown>;
        return { ok: true, listing: listingRow() } as never;
      },
    });
    const ctx = postCtx('/api/woc-market/listings', {
      ...LISTING_BODY,
      stepUp: PROOF,
      directed: { offerId: 1, itemPin: 'forged' },
    });
    await handlerFor('POST', '/api/woc-market/listings')(ctx);
    expect(seen).not.toBeNull();
    expect((seen as unknown as { stepUp: unknown }).stepUp).toEqual(PROOF);
    expect(
      Object.hasOwn(seen as unknown as object, 'directed'),
      'directed is handler-owned, never decoded',
    ).toBe(false);
  });

  it('forwards the bound copy and offerNext into createListing, defaulting a MISSING expectInstance to null', async () => {
    // Critical: an omitted expectInstance must reach the service as explicit
    // null, never absent, or the extraction skips its copy check and an
    // omitting client escrows a different copy at the named index. offerNext
    // and the real instance must forward too (a dropped line breaks every
    // rolled/offerNext listing with a binding mismatch).
    const cap: { v: { itemRef?: { expectInstance?: unknown }; params?: { offerNext?: unknown } } } =
      { v: {} };
    service({
      createListing: async (args: unknown) => {
        cap.v = args as typeof cap.v;
        return { ok: true, listing: listingRow() } as never;
      },
    });
    // Body OMITS expectInstance entirely.
    await handlerFor(
      'POST',
      '/api/woc-market/listings',
    )(postCtx('/api/woc-market/listings', { ...LISTING_BODY, stepUp: PROOF, offerNext: true }));
    expect(cap.v.itemRef && 'expectInstance' in cap.v.itemRef, 'expectInstance is present').toBe(
      true,
    );
    expect(cap.v.itemRef?.expectInstance, 'omitted -> explicit null').toBeNull();
    expect(cap.v.params?.offerNext).toBe(true);
    // And a real instance forwards verbatim.
    await handlerFor(
      'POST',
      '/api/woc-market/listings',
    )(
      postCtx('/api/woc-market/listings', {
        ...LISTING_BODY,
        stepUp: PROOF,
        expectInstance: { rolled: { quality: 'epic' } },
      }),
    );
    expect(cap.v.itemRef?.expectInstance).toEqual({ rolled: { quality: 'epic' } });
  });

  it('forwards expectInstance and offerNext into the challenge issue', async () => {
    const cap: { v: Record<string, unknown> } = { v: {} };
    service({
      issueStepUpChallenge: async (_account: number, req: unknown) => {
        cap.v = req as Record<string, unknown>;
        return {
          ok: true,
          challenge: {
            nonce: 'a'.repeat(32),
            message: 'm',
            expiresAtMs: 1,
            signatureRequired: true,
          },
        } as never;
      },
    });
    await handlerFor(
      'POST',
      '/api/woc-market/step-up/challenge',
    )(
      postCtx('/api/woc-market/step-up/challenge', {
        operation: 'create_listing',
        itemId: 'deathlord_warplate',
        expectInstance: { rolled: { quality: 'epic' } },
        format: 'auction',
        startCents: 2500,
        reserveCents: null,
        buyNowCents: null,
        durationHours: 12,
        offerNext: true,
      }),
    );
    expect(cap.v.expectInstance).toEqual({ rolled: { quality: 'epic' } });
    expect(cap.v.offerNext).toBe(true);
    // A missing expectInstance forwards as explicit null here too.
    await handlerFor(
      'POST',
      '/api/woc-market/step-up/challenge',
    )(
      postCtx('/api/woc-market/step-up/challenge', {
        operation: 'create_listing',
        itemId: 'deathlord_warplate',
        format: 'auction',
        startCents: 2500,
        reserveCents: null,
        buyNowCents: null,
        durationHours: 12,
      }),
    );
    expect(cap.v.expectInstance).toBeNull();
  });

  it('the step-up ROUTE binds the step-up rate policy, not another bucket', () => {
    // The middleware factory closes over the policy without exposing it, so the
    // decisive pin is over the source: the challenge RouteDef must wire
    // rateLimit(WOC_MARKET_STEPUP_POLICY). Swapping to WOC_MARKET_READ_POLICY
    // (120/min) changes this exact text.
    const route = routes.find(
      (r) => r.method === 'POST' && r.path === '/api/woc-market/step-up/challenge',
    );
    expect(route, 'the challenge route exists').toBeTruthy();
    // Comment-stripped (via the shared helper, which does not trip on a `://`
    // in a string literal) so a swapped policy left behind in a comment inside
    // the RouteDef block cannot keep this pin green.
    const src = stripComments(
      readFileSync(new URL('../../server/woc_market_routes.ts', import.meta.url), 'utf8'),
    );
    const block = src.slice(
      src.indexOf("path: '/api/woc-market/step-up/challenge'"),
      src.indexOf('handler: stepUpChallengeHandler'),
    );
    expect(block).toContain('rateLimit(WOC_MARKET_STEPUP_POLICY)');
    expect(block).not.toContain('WOC_MARKET_READ_POLICY');
    expect(block).not.toContain('WOC_MARKET_LIST_POLICY');
  });

  it('rejects a malformed expectInstance shape (array or non-object) as invalid_input', async () => {
    service({
      issueStepUpChallenge: async () => {
        throw new Error('must not be reached');
      },
    });
    for (const bad of [[], 'x', 42]) {
      await expect(
        handlerFor(
          'POST',
          '/api/woc-market/step-up/challenge',
        )(
          postCtx('/api/woc-market/step-up/challenge', {
            operation: 'create_listing',
            itemId: 'deathlord_warplate',
            expectInstance: bad,
            format: 'auction',
            startCents: 2500,
            reserveCents: null,
            buyNowCents: null,
            durationHours: 12,
          }),
        ),
        JSON.stringify(bad),
      ).rejects.toMatchObject({ code: 'woc_market.invalid_input' });
    }
  });

  it('passes the proof to acceptDirectedOffer as the fifth argument', async () => {
    let seenStepUp: unknown = 'unset';
    service({
      acceptDirectedOffer: async (
        _account: number,
        _id: number,
        _ref: unknown,
        _char: number,
        stepUp?: unknown,
      ) => {
        seenStepUp = stepUp;
        return { ok: true, listing: null } as never;
      },
    });
    const ctx = postCtx(
      '/api/woc-market/offers/41/accept',
      { characterId: 12, stepUp: PROOF },
      { params: { id: '41' } },
    );
    await handlerFor('POST', '/api/woc-market/offers/:id/accept')(ctx);
    expect(seenStepUp).toEqual(PROOF);
  });

  it('an ABSENT proof decodes to absent (the service answers stepup_required, not the router)', async () => {
    let seen: Record<string, unknown> | null = null;
    service({
      createListing: async (args: unknown) => {
        seen = args as Record<string, unknown>;
        return { ok: false, reason: 'stepup_required' } as never;
      },
    });
    const ctx = postCtx('/api/woc-market/listings', LISTING_BODY);
    await expect(handlerFor('POST', '/api/woc-market/listings')(ctx)).rejects.toMatchObject({
      status: 403,
      code: 'woc_market.stepup_required',
    });
    expect(Object.hasOwn(seen as unknown as object, 'stepUp')).toBe(false);
  });

  it('a malformed proof shape refuses invalid_input BEFORE the service runs', async () => {
    let called = 0;
    service({
      createListing: async () => {
        called += 1;
        return { ok: true, listing: listingRow() } as never;
      },
    });
    for (const stepUp of [
      'garbage',
      42,
      [],
      { nonce: 'x' },
      { signature: 'y' },
      { nonce: '', signature: 'z' },
    ]) {
      const ctx = postCtx('/api/woc-market/listings', { ...LISTING_BODY, stepUp });
      await expect(
        handlerFor('POST', '/api/woc-market/listings')(ctx),
        JSON.stringify(stepUp),
      ).rejects.toMatchObject({ code: 'woc_market.invalid_input' });
    }
    expect(called).toBe(0);
  });

  it('challenge decode: an unknown operation refuses invalid_input without a service call', async () => {
    let called = 0;
    service({
      issueStepUpChallenge: async () => {
        called += 1;
        return { ok: false, reason: 'not_found' } as never;
      },
    });
    for (const operation of ['refund_everything', '', 7, undefined]) {
      const ctx = postCtx('/api/woc-market/step-up/challenge', {
        operation,
        itemId: 'deathlord_warplate',
      });
      await expect(
        handlerFor('POST', '/api/woc-market/step-up/challenge')(ctx),
        String(operation),
      ).rejects.toMatchObject({ code: 'woc_market.invalid_input' });
    }
    expect(called).toBe(0);
  });

  it('challenge decode: the listing shape holds the same bounds as the listing intake', async () => {
    service({
      issueStepUpChallenge: async () => {
        throw new Error('must not be reached');
      },
    });
    const base = {
      operation: 'create_listing',
      itemId: 'deathlord_warplate',
      format: 'auction',
      startCents: 2500,
      reserveCents: null,
      buyNowCents: null,
      durationHours: 12,
    };
    for (const bad of [
      { ...base, startCents: 1 },
      { ...base, startCents: 100_001 },
      { ...base, format: 'raffle' },
      { ...base, durationHours: 0 },
      { ...base, durationHours: 1_001 },
      { ...base, itemId: '' },
      // The two optional money figures the wallet displays go through
      // optionalCents and must honor the same range.
      { ...base, reserveCents: 1 },
      { ...base, reserveCents: 100_001 },
      { ...base, buyNowCents: 1 },
      { ...base, buyNowCents: 100_001 },
    ]) {
      const ctx = postCtx('/api/woc-market/step-up/challenge', bad);
      await expect(
        handlerFor('POST', '/api/woc-market/step-up/challenge')(ctx),
        JSON.stringify(bad),
      ).rejects.toMatchObject({ code: 'woc_market.invalid_input' });
    }
  });

  it('a bearer-only custody move refuses stepup_required through the REAL service, whatever the client claims to be', async () => {
    // Deliverable 4's posture pin: enforcement lives in the service on the
    // PROOF alone, so no header a client controls (a native app, a desktop
    // shell, a scripted bearer) changes the answer. Real WocMarketService,
    // real refusal table; custody is a cast stub because the refusal lands
    // before any custody call.
    const db = new FakeWocMarketDb({ characters: [] });
    configureWocMarketRuntime({
      service: new WocMarketServiceReal({
        db,
        economy: createDevWocMarketEconomy(),
        custody: {} as never,
        verifiedWallet: async () => 'SELLERWALLETPUBKEY111111111111111111111111',
        balanceTokens: async () => 1_000_000,
        stepUpDevSig: false,
        config: {
          enabled: true,
          realm: 'Claudemoon',
          policy: WOC_MARKET_RESTRICTED_POLICY,
          confirmingReviewMs: 6 * 3_600_000,
        },
      }),
    });
    for (const userAgent of [
      'Mozilla/5.0 (Macintosh) Chrome/126 browser-web',
      'WoCC-Native-Android/1.0 (Capacitor)',
      'curl/8.6.0',
    ]) {
      const ctx = postCtx('/api/woc-market/listings', LISTING_BODY, {
        headers: { 'user-agent': userAgent },
      });
      await expect(
        handlerFor('POST', '/api/woc-market/listings')(ctx),
        userAgent,
      ).rejects.toMatchObject({ status: 403, code: 'woc_market.stepup_required' });
    }
  });

  it('challenge refusals ride the refusal table: a wallet-less account reads wallet_required', async () => {
    service({ issueStepUpChallenge: async () => ({ ok: false, reason: 'wallet_required' }) });
    const ctx = postCtx('/api/woc-market/step-up/challenge', {
      operation: 'accept_directed_offer',
      offerId: 41,
    });
    await expect(
      handlerFor('POST', '/api/woc-market/step-up/challenge')(ctx),
    ).rejects.toMatchObject({ status: 403, code: 'woc_market.wallet_required' });
  });

  it('bounds the directed offerId: a zero or negative id is invalid_input, never minted', async () => {
    service({
      issueStepUpChallenge: async () => {
        throw new Error('must not be reached');
      },
    });
    // Numeric-bound dimension (0, -1, 1.5) AND the type dimension (a string or
    // an omitted id): intField refuses both, and nothing is minted.
    for (const offerId of [0, -1, 1.5, '41', undefined]) {
      await expect(
        handlerFor(
          'POST',
          '/api/woc-market/step-up/challenge',
        )(
          postCtx('/api/woc-market/step-up/challenge', {
            operation: 'accept_directed_offer',
            offerId,
          }),
        ),
        String(offerId),
      ).rejects.toMatchObject({ code: 'woc_market.invalid_input' });
    }
  });

  it('a malformed expectInstance refuses invalid_input even on the directed shape that ignores it', async () => {
    // expectInstance and format decode BEFORE the operation branch, so a bad
    // instance on an accept request refuses at decode rather than being
    // ignored. Surprising but safe (the directed arm never reads it); pinned
    // so a decode reorder that swallowed it would red here.
    service({
      issueStepUpChallenge: async () => {
        throw new Error('must not be reached');
      },
    });
    await expect(
      handlerFor(
        'POST',
        '/api/woc-market/step-up/challenge',
      )(
        postCtx('/api/woc-market/step-up/challenge', {
          operation: 'accept_directed_offer',
          offerId: 41,
          expectInstance: [],
        }),
      ),
    ).rejects.toMatchObject({ code: 'woc_market.invalid_input' });
  });
});

describe('the admin envelope renders the CODE end to end (the operator wire)', () => {
  it('a suspend refusal serializes as { success:false, data:null, error: <code> }', async () => {
    // The full onion, not just the throw: the handler's HttpError must cross
    // withErrors on the admin surface and come out as the coded envelope the
    // production comment promises operators.
    service({
      adminSuspendListing: async () => ({ ok: false, reason: 'settlement_in_flight' }),
    });
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/woc-market/listings/41/suspend',
      params: { id: '41' },
    });
    ctx.state.set('adminTargetId', 41);
    const route = routes.find(
      (r) => r.method === 'POST' && r.path === '/admin/api/woc-market/listings/:id/suspend',
    );
    if (!route) throw new Error('suspend route missing');
    const stack: Middleware[] = [
      withErrors({ surface: route.meta?.envelope }),
      (async (c) => {
        await route.handler(c);
      }) as Middleware,
    ];
    await compose(stack)(ctx);
    const { status, body } = sent(ctx);
    expect(status).toBe(409);
    expect(body).toEqual({
      success: false,
      data: null,
      error: 'woc_market.settlement_in_flight',
    });
  });
});
