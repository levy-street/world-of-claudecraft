// $WOC Exchange route layer: the RouteDef surface over WocMarketService
// (docs/prd/woc/marketplace.md). Registry-only, no legacy twin (the deeds.ts
// precedent). The business rules stay in woc_market.ts; this module owns the
// wire: schema checks, the refusal-to-code mapping, response views that hide
// non-public fields (the exact reserve, wallets, lock holders), the per-action
// limiters, and the operator moderation arms on the /admin/api surface.
//
// Feature config follows the domain-getter pattern (server/http/config.ts
// exception 3, the STEAM_ENABLED shape): WOC_MARKET_ENABLED gates the whole
// surface fail-closed, and the dev economy additionally requires
// ALLOW_DEV_COMMANDS=1 (wired in main.ts, never here).

import type { ItemInstancePayload } from '../src/sim/types';
import { adminDb } from './admin';
import { accountAndScopeForToken, moderationStatusForAccount } from './db';
import { ctxAccountId } from './http/context';
import type { ErrorCode } from './http/error_codes';
import { HttpError } from './http/errors';
import {
  type BearerActiveGuardDb,
  createActiveGuard,
  createReadGuard,
} from './http/middleware/bearer_active_guard';
import { withBody } from './http/middleware/body';
import {
  rateLimit,
  WOC_MARKET_BID_POLICY,
  WOC_MARKET_CONFIRM_POLICY,
  WOC_MARKET_LIST_POLICY,
  WOC_MARKET_QUOTE_POLICY,
  WOC_MARKET_READ_POLICY,
  WOC_MARKET_STEPUP_POLICY,
} from './http/middleware/rate_limit';
import type { AdminAuthDb } from './http/middleware/require_admin';
import {
  adminTargetId,
  createRequireAdmin,
  requireAdminTarget,
} from './http/middleware/require_admin';
import { requireOwned } from './http/middleware/require_owned';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';
import { REALM } from './realm';
import type {
  WocBidRow,
  WocBrowseQuery,
  WocDirectedOfferRow,
  WocEstimate,
  WocListingRow,
  WocMarketConfig,
  WocMarketRefusal,
  WocMarketService,
  WocQuoteIntent,
  WocSaleRow,
  WocSettlementRow,
  WocStrikeRow,
} from './woc_market';
import type { WocMarketReadCache } from './woc_market_read_cache';
import {
  bondCents,
  minNextBidCents,
  screenWireFailReason,
  screenWirePendingReason,
  WOC_MARKET_BOND_MAX_CENTS,
  WOC_MARKET_BOND_MIN_CENTS,
  WOC_MARKET_BOND_PENDING_TTL_SECONDS,
  WOC_MARKET_BOND_RATE_BPS,
  WOC_MARKET_DIRECTED_HOLD_SECONDS,
  WOC_MARKET_DURATION_HOURS,
  WOC_MARKET_MAX_PRICE_CENTS,
  WOC_MARKET_MIN_PRICE_CENTS,
  WOC_MARKET_RESTRICTED_POLICY,
  WOC_MARKET_SETTLEMENT_WINDOW_SECONDS,
  type WocListingFormat,
} from './woc_market_rules';

// ---------------------------------------------------------------------------
// Feature config (the domain-getter pattern; read per call so tests can flip)
// ---------------------------------------------------------------------------

/** Deepest browse page a client may request (25 per page). */
const MAX_BROWSE_PAGE = 400;

/** Default for the H15 confirming-age bound: hours-scale ON PURPOSE. Minutes
 *  would page an operator for every routine finality delay or short economy
 *  outage the poll self-heals; much longer re-creates the unbounded hold the
 *  bound exists to close (the escrowed item sits stuck for its whole life). */
const WOC_MARKET_CONFIRMING_REVIEW_HOURS_DEFAULT = 6;
/** The upper clamp: 30 days. Above this the H15 bound is disabled in
 *  practice, and an absurd value even breaks it mechanically (nowMs minus
 *  the bound goes so far negative that to_timestamp raises 22008 and the
 *  error-isolated sweep arm silently stops parking). An operator who wants
 *  the review park off has WOC_MARKET_ENABLED=0; a longer legitimate bound
 *  than 720 hours has no operational story. */
const WOC_MARKET_CONFIRMING_REVIEW_HOURS_MAX = 720;
let confirmingReviewClampWarned = false;

/** Positive-hours env knob. Guarded against the empty-string trap
 *  (Number('') is 0, which would silently turn the bound off by making every
 *  confirming row instantly overdue) and against non-finite or non-positive
 *  values, all of which fall back to the default; values above the clamp are
 *  clamped with a one-time operator warning (dev channel). */
function confirmingReviewMsFromEnv(): number {
  const raw = process.env.WOC_MARKET_CONFIRMING_REVIEW_HOURS;
  const hours = raw !== undefined && raw.trim() !== '' ? Number(raw) : Number.NaN;
  const safe =
    Number.isFinite(hours) && hours > 0 ? hours : WOC_MARKET_CONFIRMING_REVIEW_HOURS_DEFAULT;
  if (safe > WOC_MARKET_CONFIRMING_REVIEW_HOURS_MAX) {
    if (!confirmingReviewClampWarned) {
      confirmingReviewClampWarned = true;
      console.warn(
        `WOC_MARKET_CONFIRMING_REVIEW_HOURS=${safe} exceeds the ${WOC_MARKET_CONFIRMING_REVIEW_HOURS_MAX}h clamp; using ${WOC_MARKET_CONFIRMING_REVIEW_HOURS_MAX}h (the review bound cannot be effectively disabled by configuration)`,
      );
    }
    return WOC_MARKET_CONFIRMING_REVIEW_HOURS_MAX * 3600 * 1000;
  }
  return safe * 3600 * 1000;
}

export function wocMarketConfig(): WocMarketConfig {
  const excluded = (process.env.WOC_MARKET_EXCLUDED_ITEM_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return {
    enabled: process.env.WOC_MARKET_ENABLED === '1',
    realm: REALM,
    policy:
      excluded.length === 0
        ? WOC_MARKET_RESTRICTED_POLICY
        : { ...WOC_MARKET_RESTRICTED_POLICY, excludedItemIds: new Set(excluded) },
    confirmingReviewMs: confirmingReviewMsFromEnv(),
  };
}

// ---------------------------------------------------------------------------
// Runtime injection (the deeds.ts seam: main.ts wires the service after the
// GameServer exists; unit tests install a fake).
// ---------------------------------------------------------------------------

export interface WocMarketRuntime {
  service: WocMarketService;
  /** The hot-read cache the service reads through (H11). The SAME instance
   *  main.ts hands the service as deps.readCache; the mutation handlers here
   *  own the busts (a stale-forever cache on a money surface is worse than
   *  no cache). Absent in rigs that install a bare fake service, in which
   *  case the service reads uncached and there is nothing to bust. */
  readCache?: WocMarketReadCache;
  /** The cached guard bundle (the auth-guard read rider): main.ts injects the
   *  WocAuthGuardCache instance here so the marketplace player guards read
   *  through it while EVERY other surface (the admin gate below resolves
   *  through adminDb(), the other domains' bundles, ws_auth) stays on the
   *  direct db reads. Absent in rigs: guards fall back to the direct reads,
   *  and the test override seam keeps absolute precedence over both. */
  authGuardDb?: BearerActiveGuardDb;
}

let runtime: WocMarketRuntime | null = null;

export function configureWocMarketRuntime(rt: WocMarketRuntime): void {
  runtime = rt;
}

export function resetWocMarketRuntimeForTests(): void {
  runtime = null;
}

function useService(): WocMarketService {
  if (runtime === null) {
    throw new Error('woc_market runtime is not configured; call configureWocMarketRuntime');
  }
  return runtime.service;
}

function readCache(): WocMarketReadCache | null {
  return runtime?.readCache ?? null;
}

// ---------------------------------------------------------------------------
// Refusal -> stable code (the server emits the CODE, never English)
// ---------------------------------------------------------------------------

/** The refusal-to-wire mapping. EXPORTED so tests can pin it exhaustively:
 *  several of these status choices are security decisions (not_yours is a 404
 *  for anti-enumeration, never a 403), and a hand-copied table in the test
 *  would drift the moment a row changed. */
export const REFUSAL_ERRORS: Record<WocMarketRefusal, { status: number; code: ErrorCode }> = {
  disabled: { status: 403, code: 'woc_market.disabled' },
  market_paused: { status: 503, code: 'woc_market.paused' },
  wallet_required: { status: 403, code: 'woc_market.wallet_required' },
  terms_required: { status: 403, code: 'woc_market.terms_required' },
  account_suspended: { status: 403, code: 'woc_market.suspended' },
  character_invalid: { status: 400, code: 'woc_market.character_invalid' },
  not_found: { status: 404, code: 'woc_market.not_found' },
  not_yours: { status: 404, code: 'woc_market.not_yours' },
  not_active: { status: 409, code: 'woc_market.not_active' },
  own_listing: { status: 403, code: 'woc_market.own_listing' },
  has_bids: { status: 409, code: 'woc_market.has_bids' },
  bid_too_low: { status: 400, code: 'woc_market.bid_too_low' },
  already_pending: { status: 409, code: 'woc_market.already_pending' },
  insufficient_balance: { status: 400, code: 'woc_market.insufficient_balance' },
  quote_unavailable: { status: 503, code: 'woc_market.quote_unavailable' },
  quote_expired: { status: 409, code: 'woc_market.quote_expired' },
  not_pending: { status: 409, code: 'woc_market.not_pending' },
  confirm_failed: { status: 409, code: 'woc_market.confirm_failed' },
  confirm_in_flight: { status: 409, code: 'woc_market.confirm_in_flight' },
  buy_now_locked: { status: 409, code: 'woc_market.buy_now_locked' },
  cancel_pending: { status: 409, code: 'woc_market.cancel_pending' },
  claim_cooldown: { status: 409, code: 'woc_market.claim_cooldown' },
  bond_window_closed: { status: 409, code: 'woc_market.bond_window_closed' },
  settlement_in_flight: { status: 409, code: 'woc_market.settlement_in_flight' },
  contended: { status: 409, code: 'woc_market.contended' },
  sale_conflict: { status: 409, code: 'woc_market.sale_conflict' },
  no_buy_now: { status: 400, code: 'woc_market.no_buy_now' },
  cap_reached: { status: 409, code: 'woc_market.cap_reached' },
  lease_lost: { status: 409, code: 'woc_market.stale_item' },
  signature_reused: { status: 409, code: 'woc_market.signature_reused' },
  stale_copy: { status: 409, code: 'woc_market.stale_item' },
  // One live directed deal per (buyer, seller) pair: the strike-farming
  // bound. Its own code (the already_pending copy describes a pending BID).
  offer_pending: { status: 409, code: 'woc_market.offer_pending' },
  // The directed bait-and-switch guard: the accepted copy's fingerprint does
  // not match the one the buyer agreed to at offer time (H10). Its own code,
  // not a stale_item collapse: the fix is a fresh DEAL, not a re-select.
  item_mismatch: { status: 409, code: 'woc_market.item_mismatch' },
  // Custody extraction refusals: a stale reference re-selects; the rest are
  // eligibility shapes the client pre-filters but the server owns.
  soulbound: { status: 400, code: 'woc_market.not_eligible' },
  quest_item: { status: 400, code: 'woc_market.not_eligible' },
  no_market_list: { status: 400, code: 'woc_market.not_eligible' },
  bound_copy: { status: 400, code: 'woc_market.not_eligible' },
  bind_armed: { status: 400, code: 'woc_market.not_eligible' },
  // The player's own item lock (R10). Its own code, not a not_eligible
  // collapse: this is the one refusal the player can lift themselves, and the
  // copy has to say so (unlock it in your bags, then list it).
  locked: { status: 400, code: 'woc_market.item_locked' },
  unknown_item: { status: 400, code: 'woc_market.not_eligible' },
  not_eligible_category: { status: 400, code: 'woc_market.not_eligible' },
  below_quality_floor: { status: 400, code: 'woc_market.not_eligible' },
  excluded_item: { status: 400, code: 'woc_market.not_eligible' },
  bad_format: { status: 400, code: 'woc_market.invalid_params' },
  bad_start: { status: 400, code: 'woc_market.invalid_params' },
  bad_reserve: { status: 400, code: 'woc_market.invalid_params' },
  bad_buy_now: { status: 400, code: 'woc_market.invalid_params' },
  bad_duration: { status: 400, code: 'woc_market.invalid_params' },
  bad_directed_buyer: { status: 400, code: 'woc_market.invalid_params' },
  // Its own code, deliberately not folded into wallet_required: the two say
  // different things to the seller ("link YOUR wallet" versus "they must link
  // theirs"), and only the second is actionable by someone else.
  recipient_wallet_required: { status: 403, code: 'woc_market.recipient_wallet_required' },
  self_offer: { status: 400, code: 'woc_market.self_offer' },
  offer_expired: { status: 410, code: 'woc_market.offer_expired' },
  // Wallet step-up on the custody movers (B6/R1). All 403 auth-class except
  // the expired challenge, which is a 410 lapse like offer_expired: the fix
  // is a fresh challenge, not different credentials. invalid deliberately
  // covers unknown, replayed, AND cross-account nonces with one word, so
  // challenge existence never leaks.
  stepup_required: { status: 403, code: 'woc_market.stepup_required' },
  stepup_challenge_invalid: { status: 403, code: 'woc_market.stepup_challenge_invalid' },
  stepup_challenge_expired: { status: 410, code: 'woc_market.stepup_challenge_expired' },
  stepup_wallet_mismatch: { status: 403, code: 'woc_market.stepup_wallet_mismatch' },
  stepup_binding_mismatch: { status: 403, code: 'woc_market.stepup_binding_mismatch' },
  stepup_signature_invalid: { status: 403, code: 'woc_market.stepup_signature_invalid' },
};

/** Takes the WHOLE refusal so its params channel can never be dropped at a
 *  call site: a handler that forwarded only the reason would ship a code
 *  whose declared placeholders never render (codes with params today:
 *  woc_market.claim_cooldown, retryAfterSeconds). */
function throwRefusal(refusal: {
  reason: WocMarketRefusal;
  params?: Record<string, string | number>;
}): never {
  const mapped = REFUSAL_ERRORS[refusal.reason] ?? {
    status: 400,
    code: 'woc_market.invalid_input',
  };
  throw new HttpError(mapped.status, mapped.code, refusal.params);
}

const invalid = (): never => {
  throw new HttpError(400, 'woc_market.invalid_input');
};

// ---------------------------------------------------------------------------
// Decode helpers (strict, no coercion surprises)
// ---------------------------------------------------------------------------

function intField(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    invalid();
  }
  return value as number;
}

function optionalCents(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return intField(value, WOC_MARKET_MIN_PRICE_CENTS, WOC_MARKET_MAX_PRICE_CENTS);
}

function idParam(ctx: Ctx): number {
  const raw = ctx.params.id;
  const id = Number(raw);
  if (!/^\d+$/.test(raw ?? '') || !Number.isSafeInteger(id) || id < 1) invalid();
  return id;
}

function bodyOf(ctx: Ctx): Record<string, unknown> {
  const body = ctx.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) invalid();
  return body as Record<string, unknown>;
}

function stringField(value: unknown, maxLen: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLen) invalid();
  return value as string;
}

/** An item id as a FILTER input: the closed machine vocabulary's charset,
 *  refused otherwise. Tighter than stringField on purpose: these values
 *  become shared cache-key components and index-filter arms, so free-text
 *  here is key-entropy an attacker mints for free (the browse cache-thrash
 *  class), and no real item id needs anything outside this set. */
const ITEM_ID_SHAPE = /^[A-Za-z0-9_.:-]{1,128}$/;
function itemIdField(value: unknown): string {
  const id = stringField(value, 128);
  if (!ITEM_ID_SHAPE.test(id)) invalid();
  return id;
}

/** A submitted transaction signature. Real Solana signatures are base58
 *  (87-88 chars); the shape bound is looser (the dev economy and its tests
 *  post plain tagged strings, and the trade controller's dev-chain arm
 *  posts devsig:<reference> where references themselves carry colons) but
 *  refuses anything outside safe printable characters: the recorded value
 *  is interpolated into an ops warn on the revived-signature path and
 *  forwarded to the economy service, so a newline or ANSI escape smuggled
 *  through here is a log-forging vector. */
const SIGNATURE_SHAPE = /^[A-Za-z0-9_:-]{1,256}$/;
function signatureField(value: unknown): string {
  const sig = stringField(value, 256);
  if (!SIGNATURE_SHAPE.test(sig)) invalid();
  return sig;
}

/** The optional step-up proof (B6/R1). ABSENT stays absent, so the service
 *  answers its honest stepup_required; a PRESENT but malformed shape is the
 *  generic invalid_input like every other decode. The signature reuses the
 *  transaction-signature screen: same printable-safe rationale, and the
 *  devsig form fits it. */
function optionalStepUp(value: unknown): { nonce: string; signature: string } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) invalid();
  const v = value as { nonce?: unknown; signature?: unknown };
  return { nonce: stringField(v.nonce, 64), signature: signatureField(v.signature) };
}

/** A real instance payload (rolled stats, enchant, signer, provenance)
 *  serializes to a few hundred bytes; 2 KiB is generous headroom. The bound
 *  is load-bearing twice over: it caps what a caller can persist through the
 *  instance-carrying intakes, and, because JSON depth costs at least two
 *  serialized bytes per level, it bounds nesting depth for the RECURSIVE
 *  consumers downstream (the sim's sortedJson fingerprint serializer and
 *  itemInstancePayloadsEqual), which a ~30000-level object inside the 64 KiB
 *  body cap can otherwise overflow into a 500. JSON.stringify itself is
 *  iterative and safe at any depth the body cap admits. */
const INSTANCE_MAX_JSON_BYTES = 2048;

function optionalInstance(value: unknown): ItemInstancePayload | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) invalid();
  // Real BYTES, not UTF-16 code units: .length undercounts non-ASCII payloads
  // by up to 3x, which would quietly triple the budget the constant names.
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > INSTANCE_MAX_JSON_BYTES) invalid();
  return value as ItemInstancePayload;
}

// ---------------------------------------------------------------------------
// Wire views. Public listing views HIDE the exact reserve (only met/not met,
// per the PRD), the wallets, and the lock holder.
// ---------------------------------------------------------------------------

function listingView(row: WocListingRow, viewerAccount: number | null): Record<string, unknown> {
  const reserveMet =
    row.reserveCents === null
      ? null
      : row.currentBidCents !== null && row.currentBidCents >= row.reserveCents;
  return {
    id: row.id,
    item: row.item,
    itemId: row.itemId,
    quality: row.quality,
    format: row.format,
    sellerName: row.sellerName,
    mine: viewerAccount !== null && row.sellerAccount === viewerAccount,
    startCents: row.startCents,
    hasReserve: row.reserveCents !== null,
    reserveMet,
    buyNowCents: row.buyNowCents,
    offerNext: row.offerNext,
    status: row.status,
    resolution: row.resolution,
    currentBidCents: row.currentBidCents,
    // The sale's closing price (sales-table join), non-null only on the
    // seller's own activity rows once a listing resolves sold; browse rows
    // are live and always carry null. Lets the "Sold" row name the price the
    // sale closed at instead of the last bid a buy-now outran.
    soldCents: row.soldCents ?? null,
    minNextBidCents: minNextBidCents(row.currentBidCents, row.startCents),
    minNextBidBondCents: bondCents(minNextBidCents(row.currentBidCents, row.startCents)),
    // The lock EXPIRY is withheld on purpose (only the boolean crosses):
    // broadcasting the exact lapse moment would let a re-claim sniper camp
    // it, the griefing the reclaim cooldown exists to price.
    buyNowLocked:
      row.buyNowLockAccount !== null &&
      row.buyNowLockExpiresMs !== null &&
      row.buyNowLockExpiresMs > Date.now(),
    // Player-meaningful state, not bookkeeping: without these two the seller
    // who reloads cannot see that their cancel was accepted (the listing
    // reads plainly active) or that a row in their Activity tab is a
    // directed sale rather than a public auction. Booleans only; the
    // buyer's account id stays server-side. The status gate mirrors every
    // server-side consumer of the stamp: cancel_requested_at is never
    // cleared, so a closed listing would otherwise report a pending cancel
    // forever.
    cancelPending: row.status === 'active' && row.cancelRequestedAtMs !== null,
    directed: row.directedBuyerAccount !== null,
    endsAtMs: row.endsAtMs,
    createdAtMs: row.createdAtMs,
  };
}

function bidView(row: WocBidRow & { itemId?: string }): Record<string, unknown> {
  return {
    id: row.id,
    listingId: row.listingId,
    // What the money is FOR. Item-named on the Activity read (the joined
    // listing's item); null on the responses whose caller already knows the
    // listing (placeBid, bond confirms), and null rather than absent so the
    // key set stays one pinned shape. Empty (a pruned listing) collapses to
    // null too: the client's "name the item" arm keys on a real id.
    itemId: row.itemId ? row.itemId : null,
    amountCents: row.amountCents,
    status: row.status,
    bondCents: row.bondCents,
    bondState: row.bondState,
    bondReference: row.bondReference,
    bondQuoteExpiresAtMs: row.bondQuoteExpiresAtMs,
    // Whether a bond payment is submitted and awaiting the chain. A BOOLEAN, not
    // the signature: the client needs only to know it must wait, and the
    // signature is the bidder's own on-chain reference, not a field the window
    // has any use for.
    //
    // Scoped to pending_bond deliberately. The signature stays on the row after
    // the bond is held, so an unscoped `bondSignature !== null` would report a
    // long-settled bond as forever confirming. Without this field the client
    // cannot distinguish "not paid yet" from "paid, verifying": neither status
    // nor bondState moves when the signature is recorded, which is exactly the
    // window in which a second Pay Bond press would pay twice.
    bondConfirming: row.status === 'pending_bond' && row.bondSignature !== null,
    placedAtMs: row.placedAtMs,
  };
}

function settlementView(row: WocSettlementRow & { itemId?: string }): Record<string, unknown> {
  return {
    id: row.id,
    listingId: row.listingId,
    // Same shape and rationale as bidView.itemId above.
    itemId: row.itemId ? row.itemId : null,
    attempt: row.attempt,
    amountCents: row.amountCents,
    state: row.state,
    quoteReference: row.quoteReference,
    quoteExpiresAtMs: row.quoteExpiresAtMs,
    // Screened, never the raw row: the row keeps the service's verbatim word
    // for operators; the wire carries the pinned vocabulary so the client can
    // say WHY a payment failed without repeating arbitrary service text.
    failReason: screenWireFailReason(row.failReason),
    deadlineAtMs: row.deadlineAtMs,
    createdAtMs: row.createdAtMs,
  };
}

function saleView(row: WocSaleRow): Record<string, unknown> {
  // No `item` payload: the row's full InvSlot (instance rolls included) was
  // the heaviest field on the history wire and NO client consumer ever read
  // it (the history read is keyed by the item the caller already knows).
  // Trimmed with the hot-read caching; the db row keeps it for operators.
  return {
    id: row.id,
    itemId: row.itemId,
    priceCents: row.priceCents,
    sellerName: row.sellerName,
    buyerName: row.buyerName,
    atMs: row.atMs,
  };
}

function strikeView(row: WocStrikeRow | null): Record<string, unknown> | null {
  if (!row) return null;
  return { strikes: row.strikes, suspendedUntilMs: row.suspendedUntilMs };
}

function quoteView(intent: WocQuoteIntent): Record<string, unknown> {
  return {
    reference: intent.reference,
    transactionBase64: intent.transactionBase64,
    // Without this the dev-economy path is dead: the client only skips the
    // wallet when the server SAYS no signature is needed (H8).
    signatureRequired: intent.signatureRequired,
    amount: intent.amount,
    seller: intent.seller,
    burn: intent.burn,
    treasury: intent.treasury,
    // The service-owned bond figure (bond quotes only; null on settlements):
    // the client renders it, it never computes money.
    bondCents: intent.bondCents,
    expiresAtMs: intent.expiresAtMs,
  };
}

function estimateView(estimate: WocEstimate): Record<string, unknown> {
  return {
    available: estimate.available,
    usdCents: estimate.usdCents,
    amount: estimate.amount,
    asOfMs: estimate.asOfMs,
    // The three USD fee legs as the SERVICE computed them; the client never
    // derives a split. Dropping this rendered every Fee / You receive line
    // blank (H8).
    split: estimate.split,
  };
}

// ---------------------------------------------------------------------------
// Player handlers
// ---------------------------------------------------------------------------

async function statusHandler(ctx: Ctx): Promise<void> {
  const status = await useService().status();
  const policy = wocMarketConfig().policy;
  json(ctx.res, 200, {
    enabled: status.enabled,
    // Projected, not passed through: price.reason is the service's verbatim
    // operational word (operator_paused, oracle health states), the one field
    // that would otherwise carry unscreened service text to players. No
    // client consumes it; the paused banner derives from `healthy`.
    price: {
      available: status.price.available,
      healthy: status.price.healthy,
      tokensPerUsd: status.price.tokensPerUsd,
      asOfMs: status.price.asOfMs,
    },
    maxActiveListings: status.maxActiveListings,
    durationsHours: WOC_MARKET_DURATION_HOURS,
    minPriceCents: WOC_MARKET_MIN_PRICE_CENTS,
    maxPriceCents: WOC_MARKET_MAX_PRICE_CENTS,
    // The eligibility floor, so the client's sell-tab pre-filter follows this
    // server's policy instead of hardcoding one (the server re-validates).
    qualityFloor: policy.equipmentQualityFloor,
    // The two collectible category switches, so the client's Sell picker offers
    // exactly what this realm's policy will accept.
    allowMounts: policy.allowMounts,
    allowMechChromas: policy.allowMechChromas,
    settlementWindowSeconds: WOC_MARKET_SETTLEMENT_WINDOW_SECONDS,
    // The directed (p2p) payment hold, so the trade arm's commitment note can
    // name the deadline whose lapse earns a strike instead of a guessed one.
    directedHoldSeconds: WOC_MARKET_DIRECTED_HOLD_SECONDS,
    // The bond schedule and the bond payment window, so the client's
    // disclosure copy resolves live figures instead of shipping figure-free
    // sentences (the copy-figures follow-up). These are this server's mirror
    // of the service rule, the same mirror that already prices
    // minNextBidBondCents on every listing view; the service-computed figure
    // still arrives on each quote and is the one the player pays.
    bond: {
      rateBps: WOC_MARKET_BOND_RATE_BPS,
      minCents: WOC_MARKET_BOND_MIN_CENTS,
      maxCents: WOC_MARKET_BOND_MAX_CENTS,
      pendingTtlSeconds: WOC_MARKET_BOND_PENDING_TTL_SECONDS,
    },
  });
}

const BROWSE_SORTS = new Set(['ending', 'newest', 'price_asc', 'price_desc']);
// One set: every format that can be browsed can also be created. These were two
// sets while 'auction_buy_now' was browse-only, and the split is what made
// re-allowing it a two-place change rather than one. Whatever a seller can make,
// a buyer can filter for.
const LISTING_FORMATS = new Set(['auction', 'buy_now', 'auction_buy_now']);
// uncommon and rare joined the vocabulary with the collectible categories:
// mounts and chromas bypass the equipment quality floor (sellableRows' own
// rule) and rank down to uncommon, so those listings genuinely exist. A
// quality no live listing carries just answers empty.
const QUALITIES = new Set(['uncommon', 'rare', 'epic', 'legendary']);
// The stamped category axes (exchangeBrowseCategory and its finer axis):
// closed vocabularies mirrored from src/sim/exchange_eligibility.ts and the
// item model (weapon types plus armor slots). Mirrored as literals, pinned
// by the routes suite, because the route validates WORDS, not defs.
const BROWSE_CATEGORIES = new Set(['weapon', 'armor', 'mount', 'chroma', 'other']);
const BROWSE_SUBCATEGORIES = new Set([
  // Weapon types (the weapon-skin vocabulary plus polearm).
  'sword',
  'axe',
  'mace',
  'dagger',
  'staff',
  'wand',
  'bow',
  'crossbow',
  'polearm',
  // Armor slots (the def's ItemSlot: the slot KIND, 'ring', never ring1/2).
  'mainhand',
  'offhand',
  'helmet',
  'neck',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
  'ring',
]);

async function browseHandler(ctx: Ctx): Promise<void> {
  const one = (v: string | string[] | undefined): string | null =>
    typeof v === 'string' && v !== '' ? v : null;
  const sortRaw = one(ctx.query.sort) ?? 'ending';
  const qualityRaw = one(ctx.query.quality);
  const formatRaw = one(ctx.query.format);
  const categoryRaw = one(ctx.query.category);
  const subcategoryRaw = one(ctx.query.subcategory);
  if (!BROWSE_SORTS.has(sortRaw)) invalid();
  if (qualityRaw !== null && !QUALITIES.has(qualityRaw)) invalid();
  if (formatRaw !== null && !LISTING_FORMATS.has(formatRaw)) invalid();
  if (categoryRaw !== null && !BROWSE_CATEGORIES.has(categoryRaw)) invalid();
  if (subcategoryRaw !== null && !BROWSE_SUBCATEGORIES.has(subcategoryRaw)) invalid();
  const itemIdsRaw = one(ctx.query.itemIds);
  // Shape-screened, sorted, de-duplicated, and normalized to null when empty:
  // item ids are a closed machine vocabulary, so anything outside the id
  // charset is a 400, not a novel filter; the canonical order keeps
  // equivalent filters equivalent everywhere downstream; and an empty list
  // and an absent param mean the same "no filter" to the SQL, so they must
  // be ONE value, not a coupling between modules.
  const screened =
    itemIdsRaw === null
      ? []
      : [
          ...new Set(
            itemIdsRaw
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s !== '')
              .slice(0, 50)
              .map((id) => itemIdField(id)),
          ),
        ].sort();
  const itemIds = screened.length === 0 ? null : screened;
  // Validated like every other numeric on this surface: an unclamped page
  // became the SQL OFFSET, so 1e400 reached Postgres as Infinity (a 500 on
  // client input) and huge finite values forced a full index walk.
  const pageRaw = one(ctx.query.page);
  const page = pageRaw === null ? 0 : intField(Number(pageRaw), 0, MAX_BROWSE_PAGE);
  const q: WocBrowseQuery = {
    page,
    pageSize: 25,
    quality: qualityRaw,
    format: formatRaw as WocListingFormat | null,
    category: categoryRaw,
    subcategory: subcategoryRaw,
    itemIds,
    sort: sortRaw as WocBrowseQuery['sort'],
  };
  const viewer = ctxAccountId(ctx);
  // hasMore, not a total: the count query forced a full read of every live
  // listing per page, and the pager only needs to know if a next page exists.
  const { rows, hasMore } = await useService().browse(q);
  json(ctx.res, 200, {
    hasMore,
    page,
    pageSize: q.pageSize,
    listings: rows.map((row) => listingView(row, viewer)),
  });
}

async function listingDetailHandler(ctx: Ctx): Promise<void> {
  const id = idParam(ctx);
  const detail = await useService().listingDetail(id, ctxAccountId(ctx));
  if (!detail) throw new HttpError(404, 'woc_market.not_found');
  json(ctx.res, 200, {
    listing: listingView(detail.listing, ctxAccountId(ctx)),
    estimate: detail.estimate ? estimateView(detail.estimate) : null,
  });
}

async function estimateHandler(ctx: Ctx): Promise<void> {
  const raw = ctx.query.cents;
  const cents = Number(typeof raw === 'string' ? raw : '');
  if (!Number.isInteger(cents) || cents < 1 || cents > WOC_MARKET_MAX_PRICE_CENTS) invalid();
  json(ctx.res, 200, estimateView(await useService().estimate(cents)));
}

async function stepUpChallengeHandler(ctx: Ctx): Promise<void> {
  // Issue a wallet step-up challenge (B6/R1) for ONE intended custody move.
  // The listing shape carries the exact figures the createListing call will
  // send (the binding digests them); the directed shape names only the offer,
  // whose authoritative row supplies the figures the wallet shows.
  const body = bodyOf(ctx);
  const operation = body.operation;
  const account = ctxAccountId(ctx);
  const expectInstance = optionalInstance(body.expectInstance);
  const format = String(body.format);
  const out =
    operation === 'create_listing'
      ? await useService().issueStepUpChallenge(account, {
          operation: 'create_listing',
          itemId: stringField(body.itemId, 128),
          expectInstance: expectInstance ?? null,
          format: LISTING_FORMATS.has(format) ? (format as WocListingFormat) : (invalid() as never),
          startCents: intField(
            body.startCents,
            WOC_MARKET_MIN_PRICE_CENTS,
            WOC_MARKET_MAX_PRICE_CENTS,
          ),
          reserveCents: optionalCents(body.reserveCents),
          buyNowCents: optionalCents(body.buyNowCents),
          durationHours: intField(body.durationHours, 1, 1_000),
          offerNext: body.offerNext === true,
        })
      : operation === 'accept_directed_offer'
        ? await useService().issueStepUpChallenge(account, {
            operation: 'accept_directed_offer',
            offerId: intField(body.offerId, 1, Number.MAX_SAFE_INTEGER),
          })
        : (invalid() as never);
  if (!out.ok) throwRefusal(out);
  json(ctx.res, 200, { challenge: out.challenge });
}

async function createListingHandler(ctx: Ctx): Promise<void> {
  const body = bodyOf(ctx);
  const expectInstance = optionalInstance(body.expectInstance);
  const stepUp = optionalStepUp(body.stepUp);
  const out = await useService().createListing({
    // The step-up proof (B6/R1). This handler NEVER passes `directed` (the
    // in-service consummation marker), so the service's directed skip is
    // unreachable from the public surface; the routes suite pins it.
    ...(stepUp === undefined ? {} : { stepUp }),
    account: ctxAccountId(ctx),
    characterId: intField(body.characterId, 1, Number.MAX_SAFE_INTEGER),
    itemRef: {
      index: intField(body.itemIndex, 0, 10_000),
      itemId: stringField(body.itemId, 128),
      // Default a MISSING expectInstance to explicit null, never omitted: the
      // extraction skips its copy check when expectInstance is undefined, so an
      // omitting client could sign a challenge with no copy detail and then
      // escrow a different (better-rolled) copy at the named index. Forcing null
      // makes the stale_copy check always run (an equipment copy at that index
      // then fails against null), and the step-up binding is over this same
      // value, so the signed copy, the claimed copy, and the extracted copy are
      // one. The honest client already sends slot.instance ?? null.
      expectInstance: expectInstance ?? null,
    },
    params: {
      // Use the coerced string as the value, not the raw body: `["auction"]`
      // must not pass the allowlist and then flow through as an array.
      format: LISTING_FORMATS.has(String(body.format))
        ? (String(body.format) as WocListingFormat)
        : (invalid() as never),
      startCents: intField(body.startCents, WOC_MARKET_MIN_PRICE_CENTS, WOC_MARKET_MAX_PRICE_CENTS),
      reserveCents: optionalCents(body.reserveCents),
      buyNowCents: optionalCents(body.buyNowCents),
      durationHours: intField(body.durationHours, 1, 1_000),
      offerNext: body.offerNext === true,
      // Public listings only. A directed sale is created by the p2p offer route,
      // which resolves the counterparty from the agreed trade rather than taking
      // an account id from the seller's request body: letting a caller nominate
      // an arbitrary buyer here would make any account a drop target.
      directedBuyerAccount: null,
    },
  });
  // The actor's readout drops on EVERY outcome, refusals included: a refused
  // call can still have committed durable state the readout serves (recorded
  // terms acceptance, a recorded signature, an inserted-then-expired
  // settlement), so busting only the ok arm left /me pre-mutation for a TTL.
  // The rule holds for every handler below that busts the actor's readout at
  // all (decline/withdraw mutate only the uncached offers surface and the
  // admin arms bust what they change); the listings surface still busts only
  // on success (a refusal changed no shared listing).
  readCache()?.bustMe(ctxAccountId(ctx));
  if (!out.ok) throwRefusal(out);
  // A new listing changes the browse surface for everyone and the seller's
  // own activity readout; the cached copies must not outlive the mutation.
  readCache()?.bustListings();
  json(ctx.res, 200, { listing: listingView(out.listing, ctxAccountId(ctx)) });
}

async function cancelListingHandler(ctx: Ctx): Promise<void> {
  const out = await useService().cancelListing(ctxAccountId(ctx), idParam(ctx));
  readCache()?.bustMe(ctxAccountId(ctx));
  if (!out.ok) throwRefusal(out);
  readCache()?.bustListings();
  // cancelPending: the cancel was ACCEPTED as intent on a locked listing (no
  // new claims or bids; it closes when the current window ends unpaid).
  json(ctx.res, 200, out.cancelPending === true ? { ok: true, cancelPending: true } : { ok: true });
}

async function placeBidHandler(ctx: Ctx): Promise<void> {
  const body = bodyOf(ctx);
  const out = await useService().placeBid({
    account: ctxAccountId(ctx),
    characterId: intField(body.characterId, 1, Number.MAX_SAFE_INTEGER),
    listingId: idParam(ctx),
    amountCents: intField(body.amountCents, 1, WOC_MARKET_MAX_PRICE_CENTS),
    acceptTerms: body.acceptTerms === true,
  });
  // Before the refusal throw: placeBid can record first-time terms
  // acceptance and then refuse a later guard.
  readCache()?.bustMe(ctxAccountId(ctx));
  if (!out.ok) throwRefusal(out);
  readCache()?.bustListings();
  json(ctx.res, 200, { bid: bidView(out.bid), bond: quoteView(out.bond) });
}

async function bondQuoteHandler(ctx: Ctx): Promise<void> {
  const out = await useService().refreshBondQuote(ctxAccountId(ctx), idParam(ctx));
  // Before the refusal throw: a bond_amount_drift refusal ADOPTS the
  // service's figure onto the bid row.
  readCache()?.bustMe(ctxAccountId(ctx));
  if (!out.ok) throwRefusal(out);
  json(ctx.res, 200, { bond: quoteView(out.bond) });
}

async function abandonBidHandler(ctx: Ctx): Promise<void> {
  const out = await useService().abandonBid(ctxAccountId(ctx), idParam(ctx));
  readCache()?.bustMe(ctxAccountId(ctx));
  if (!out.ok) throwRefusal(out);
  readCache()?.bustListings();
  json(ctx.res, 200, { abandoned: true });
}

async function confirmBondHandler(ctx: Ctx): Promise<void> {
  const body = bodyOf(ctx);
  const out = await useService().confirmBond(
    ctxAccountId(ctx),
    idParam(ctx),
    signatureField(body.signature),
  );
  // Before the refusal throw: confirmBond records the submitted signature
  // in the ledger even when the chain's verdict then refuses.
  readCache()?.bustMe(ctxAccountId(ctx));
  if (!out.ok) throwRefusal(out);
  // Activation (or a recorded payment) moves the listing's current bid and
  // the bidder's own rows.
  readCache()?.bustListings();
  // `pending` is the honest third answer: paid, but the chain has not decided.
  // Collapsing it into standing:false would read as "outbid" to the client.
  // The screened reason says WHICH pending: the ledger saw the payment
  // (awaiting_finality), nothing is visible yet, or the service is down.
  json(ctx.res, 200, {
    standing: out.standing,
    pending: out.pending === true,
    reason: screenWirePendingReason(out.reason ?? null),
  });
}

async function buyNowHandler(ctx: Ctx): Promise<void> {
  const body = bodyOf(ctx);
  const out = await useService().buyNow({
    account: ctxAccountId(ctx),
    characterId: intField(body.characterId, 1, Number.MAX_SAFE_INTEGER),
    listingId: idParam(ctx),
    acceptTerms: body.acceptTerms === true,
  });
  // Before the refusal throw: buyNow can insert a settlement and then
  // expire it on quote_unavailable, and can record first-time terms.
  readCache()?.bustMe(ctxAccountId(ctx));
  if (!out.ok) throwRefusal(out);
  readCache()?.bustListings();
  json(ctx.res, 200, {
    settlement: settlementView(out.settlement),
    quote: quoteView(out.quote),
  });
}

async function settlementQuoteHandler(ctx: Ctx): Promise<void> {
  const out = await useService().settlementQuote(ctxAccountId(ctx), idParam(ctx));
  readCache()?.bustMe(ctxAccountId(ctx));
  if (!out.ok) throwRefusal(out);
  json(ctx.res, 200, { quote: quoteView(out.quote) });
}

async function confirmSettlementHandler(ctx: Ctx): Promise<void> {
  const body = bodyOf(ctx);
  const out = await useService().confirmSettlement(
    ctxAccountId(ctx),
    idParam(ctx),
    signatureField(body.signature),
  );
  // Before the refusal throw: confirmSettlement records the signature and
  // can transition the row to 'failed' before refusing confirm_failed.
  readCache()?.bustMe(ctxAccountId(ctx));
  if (!out.ok) throwRefusal(out);
  readCache()?.bustListings();
  // A 'confirmed' answer means the EAGER delivery ran to the sale insert on
  // this request, so the item's recorded history changed under a route
  // mutation (the header's bust bucket, not the sweep's TTL bucket); the arm
  // only knows the settlement id, so the whole map drops, like moderation.
  if (out.state === 'confirmed') readCache()?.bustHistoryAll();
  // Same contract as the bond leg: a confirming state names its screened
  // pending verdict; every decided state answers null.
  json(ctx.res, 200, { state: out.state, reason: screenWirePendingReason(out.reason ?? null) });
}

async function myActivityHandler(ctx: Ctx): Promise<void> {
  const account = ctxAccountId(ctx);
  const activity = await useService().myActivity(account);
  json(ctx.res, 200, {
    listings: activity.listings.map((row) => listingView(row, account)),
    bids: activity.bids.map(bidView),
    settlements: activity.settlements.map(settlementView),
    strikes: strikeView(activity.strikes),
    termsAcceptedAtMs: activity.termsAcceptedAtMs,
    walletLinked: activity.wallet !== null,
  });
}

async function historyHandler(ctx: Ctx): Promise<void> {
  // The same closed-vocabulary screen the browse filter uses: this value is
  // a shared cache-key component, so free text is minted key entropy.
  const itemId = itemIdField(ctx.params.itemId ?? '');
  const sales = await useService().salesHistory(itemId);
  json(ctx.res, 200, { sales: sales.map(saleView) });
}

/** Character names have no closed vocabulary to screen against (unlike item
 *  ids), so the shape bound does the whole job: the read is parameterized
 *  and capped underneath, and the cache arm behind it is a bounded LRU, so a
 *  junk name costs one indexed empty read, never a poisoned key set. */
const SELLER_NAME_SHAPE = /^[^\s%_][^%_]{0,31}$/;

async function sellerHistoryHandler(ctx: Ctx): Promise<void> {
  const name = stringField(ctx.params.name, 32);
  if (!SELLER_NAME_SHAPE.test(name)) invalid();
  const out = await useService().sellerSalesHistory(name);
  // The profile line carries only facts the world already shows (the
  // nameplate guild tag) plus the character's creation date; null when the
  // name no longer resolves (renamed or deleted), and the sales stand alone.
  json(ctx.res, 200, {
    sales: out.sales.map(saleView),
    seller: out.profile === null ? null : { guildName: out.profile.guildName },
  });
}

// ---------------------------------------------------------------------------
// Operator handlers (/admin/api surface; legacy admin envelope)
// ---------------------------------------------------------------------------

async function adminListingsHandler(ctx: Ctx): Promise<void> {
  const raw = ctx.query.account;
  const account = Number(typeof raw === 'string' ? raw : '');
  // Registered code, never inline English (the sibling admin arms below):
  // withErrors serializes it into the admin envelope's error field.
  if (!Number.isInteger(account) || account < 1)
    throw new HttpError(400, 'woc_market.invalid_input');
  const listings = await useService().adminListingsBySeller(account);
  json(ctx.res, 200, {
    success: true,
    data: {
      listings: listings.map((row) => ({
        ...listingView(row, null),
        sellerAccount: row.sellerAccount,
        itemDisposed: row.itemDisposed,
      })),
    },
  });
}

async function adminSuspendListingHandler(ctx: Ctx): Promise<void> {
  const out = await useService().adminSuspendListing(adminTargetId(ctx));
  if (!out.ok) {
    // Registered codes, never inline English: the admin envelope serializer
    // puts the CODE in `error`, and operators are users (the i18n rule), so
    // these arms ride the same registry the player routes use. 409 for both
    // retryable classes; `contended` is plain row contention (a guard
    // transaction briefly holds the listing), where a 404 would read as
    // "gone" and stop the operator retrying.
    if (out.reason === 'disabled') throwRefusal(out);
    if (out.reason === 'settlement_in_flight') {
      throw new HttpError(409, 'woc_market.settlement_in_flight');
    }
    if (out.reason === 'contended') throw new HttpError(409, 'woc_market.contended');
    throw new HttpError(404, 'woc_market.not_found');
  }
  // Moderation MUST bust, never wait out a TTL (the cached-read rule).
  readCache()?.bustListings();
  json(ctx.res, 200, { success: true, data: { suspended: true } });
}

async function adminSaleExcludedHandler(ctx: Ctx): Promise<void> {
  const body = bodyOf(ctx);
  if (typeof body.excluded !== 'boolean') {
    throw new HttpError(400, 'woc_market.invalid_input');
  }
  const out = await useService().adminSetSaleExcluded(adminTargetId(ctx), body.excluded);
  if (!out.ok) {
    // Distinct operator answers, as registered codes (the admin envelope
    // serializer carries the code; operators are users): a missing row
    // versus a correction blocked by a standing non-excluded sale row for
    // the same listing.
    if (out.reason === 'disabled') throwRefusal(out);
    if (out.reason === 'sale_conflict') throw new HttpError(409, 'woc_market.sale_conflict');
    throw new HttpError(404, 'woc_market.not_found');
  }
  // Moderation bust; the arm knows only the sale id, so the whole history
  // map drops (rare, and enforcement must not wait out the TTL).
  readCache()?.bustHistoryAll();
  json(ctx.res, 200, { success: true, data: { excluded: body.excluded } });
}

async function adminClearStrikesHandler(ctx: Ctx): Promise<void> {
  const out = await useService().adminClearStrikes(adminTargetId(ctx));
  if (!out.ok) throwRefusal(out);
  // Moderation bust: the target's activity readout carries the strike row.
  readCache()?.bustMe(adminTargetId(ctx));
  json(ctx.res, 200, { success: true, data: { cleared: true } });
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

// Bearer guards from the shared factories (LAZY db reads via the bundle, the
// maps_routes pattern), so endpoint tests can install fakes without a pg pool.
// Precedence per request: the test override, else the runtime-injected cached
// bundle (production), else the direct db reads. The override outranks the
// cache ON PURPOSE: a rig that fakes the guard rows must never be answered
// from a cache it cannot see or bust.
const REAL_GUARD_DB = { accountAndScopeForToken, moderationStatusForAccount };
let guardDbOverride: BearerActiveGuardDb | null = null;

/** Override the bearer-guard db reads with fakes (test-only). */
export function setWocMarketGuardDbForTests(overrides: Partial<typeof REAL_GUARD_DB>): void {
  guardDbOverride = { ...REAL_GUARD_DB, ...overrides };
}

/** Restore the real bearer-guard db reads (test-only). */
export function resetWocMarketGuardDbForTests(): void {
  guardDbOverride = null;
}

const guardDb = (): BearerActiveGuardDb => guardDbOverride ?? runtime?.authGuardDb ?? REAL_GUARD_DB;
const readAccount = createReadGuard(guardDb);
const activeAccount = createActiveGuard(guardDb);

// BOLA loaders for the owner-scoped :id mutations (the require_owned seam):
// absent and non-owned both answer the same 404 body, existence never leaks.
// The service methods re-check ownership transactionally; these gate early and
// feed the coverage clause (checkRequireOwnedCoverage).
const OWNED_404 = { error: 'not found', code: 'woc_market.not_yours' } as const;
const ownedListing = requireOwned<WocListingRow>({
  resource: 'woc-market-listing',
  param: 'id',
  load: (account, id) => useService().ownedListing(account, id),
  notFoundBody: OWNED_404,
});
const ownedBid = requireOwned<WocBidRow>({
  resource: 'woc-market-bid',
  param: 'id',
  load: (account, id) => useService().ownedBid(account, id),
  notFoundBody: OWNED_404,
});
const ownedSettlement = requireOwned<WocSettlementRow>({
  resource: 'woc-market-settlement',
  param: 'id',
  load: (account, id) => useService().ownedSettlement(account, id),
  notFoundBody: OWNED_404,
});
const OWNED_ACCOUNT = { requireOwned: { kind: 'woc-market', ownerScope: 'account' } } as const;
// Any authenticated player may read a listing or its sales history, and may
// bid on / buy ANY listing: there is no per-object ownership by design, so
// these carry the intentional publicRead marker instead of a loader (the
// service owns every other guard: seller/wallet exclusion, terms). The
// directed-offer mutations (accept/decline/withdraw) ride it too even though
// an offer HAS two parties: the acting-side check is in-service by design,
// answering a stranger `not_found` (anti-enumeration), which a generic owner
// loader could not express for a two-party object.
const NO_OWNER = { publicRead: true } as const;
const ADMIN_META = { envelope: 'admin' } as const;
const ADMIN_TARGET_META = {
  envelope: 'admin',
  requireOwned: { kind: 'woc-market', ownerScope: 'operator' },
} as const;
// The one live admin-db bundle (admin.ts), read per request so the standard
// setAdminDbForTests seam reaches these routes too.
const requireAdmin = createRequireAdmin((): AdminAuthDb => adminDb());

// ---------------------------------------------------------------------------
// Directed p2p offers (docs/prd/woc/p2p-woc-trade.md)
// ---------------------------------------------------------------------------

function offerView(offer: WocDirectedOfferRow, viewer: number | null) {
  return {
    id: offer.id,
    sellerName: offer.sellerName,
    buyerName: offer.buyerName,
    itemId: offer.itemId,
    usdCents: offer.usdCents,
    status: offer.status,
    listingId: offer.listingId,
    expiresAtMs: offer.expiresAtMs,
    listingStatus: offer.listingStatus,
    listingResolution: offer.listingResolution,
    // A coarse lifecycle word, never the signature or any amount: it says only
    // that money is moving, which is what the other side needs to see.
    settlementState: offer.settlementState,
    buyerAccepted: offer.buyerAccepted,
    sellerAccepted: offer.sellerAccepted,
    // Which side the caller is on, so the client picks accept/decline versus
    // withdraw without having to compare account ids it should not be sent.
    role: viewer === offer.buyerAccount ? 'buyer' : 'seller',
  };
}

async function createOfferHandler(ctx: Ctx): Promise<void> {
  // The BUYER opens the deal: a price named to one seller, for the EXACT copy
  // their trade window shows (H10). The item snapshot is required: an offer
  // with no pinned item is the bait-and-switch surface this intake closed.
  // The seller's acceptance escrows only a copy matching the pin.
  const body = bodyOf(ctx);
  const instance = optionalInstance(body.itemInstance);
  const craftedRecipeId =
    body.itemCraftedRecipeId === undefined ? undefined : stringField(body.itemCraftedRecipeId, 128);
  const out = await useService().createDirectedOffer({
    account: ctxAccountId(ctx),
    characterId: intField(body.characterId, 1, Number.MAX_SAFE_INTEGER),
    sellerCharacterName: stringField(body.sellerCharacterName, 64),
    usdCents: intField(body.usdCents, WOC_MARKET_MIN_PRICE_CENTS, WOC_MARKET_MAX_PRICE_CENTS),
    item: {
      itemId: stringField(body.itemId, 128),
      ...(instance == null ? {} : { instance }),
      ...(craftedRecipeId === undefined ? {} : { craftedRecipeId }),
    },
    acceptTerms: body.acceptTerms === true,
  });
  // Offers themselves are uncached, but createDirectedOffer runs guardTerms,
  // which can record FIRST-TIME terms acceptance the cached /me readout
  // serves (and it records on refused calls too, so this precedes the
  // throw): without the bust the client re-shows the consent checkbox for a
  // TTL after the player already consented.
  readCache()?.bustMe(ctxAccountId(ctx));
  if (!out.ok) throwRefusal(out);
  json(ctx.res, 200, { offer: offerView(out.offer, ctxAccountId(ctx)) });
}

async function acceptOfferHandler(ctx: Ctx): Promise<void> {
  // Either side may accept. The SELLER names the copy they are parting with;
  // the buyer sends no item, because they bring only money.
  const body = bodyOf(ctx);
  const expectInstance = optionalInstance(body.expectInstance);
  const hasItem = typeof body.itemId === 'string' && body.itemId !== '';
  const viewer = ctxAccountId(ctx);
  const out = await useService().acceptDirectedOffer(
    viewer,
    idParam(ctx),
    hasItem
      ? {
          index: intField(body.itemIndex, 0, 10_000),
          itemId: stringField(body.itemId, 128),
          ...(expectInstance === undefined ? {} : { expectInstance }),
        }
      : null,
    intField(body.characterId, 1, Number.MAX_SAFE_INTEGER),
    // The seller side owes the offer-bound step-up proof (B6/R1); the buyer
    // side sends none and the service demands none of them.
    optionalStepUp(body.stepUp),
  );
  readCache()?.bustMe(viewer);
  if (!out.ok) throwRefusal(out);
  // Acceptance can escrow a listing (the directed rail's consummation), and
  // once one exists BOTH parties' activity readouts change (the seller's
  // listings row, the buyer's coming settlement), so both bust; before the
  // deal consummates only the acting side's view moved.
  readCache()?.bustListings();
  if (out.listing !== null) {
    readCache()?.bustMe(out.listing.sellerAccount);
    if (out.listing.directedBuyerAccount !== null) {
      readCache()?.bustMe(out.listing.directedBuyerAccount);
    }
  }
  // A null listing means "agreed, still waiting on the other side": the deal is
  // live but nothing has escrowed, and the client must not treat it as done.
  json(ctx.res, 200, {
    listing: out.listing === null ? null : listingView(out.listing, viewer),
  });
}

async function declineOfferHandler(ctx: Ctx): Promise<void> {
  const out = await useService().resolveDirectedOffer(ctxAccountId(ctx), idParam(ctx), 'decline');
  if (!out.ok) throwRefusal(out);
  json(ctx.res, 200, { ok: true });
}

async function withdrawOfferHandler(ctx: Ctx): Promise<void> {
  const out = await useService().resolveDirectedOffer(ctxAccountId(ctx), idParam(ctx), 'withdraw');
  if (!out.ok) throwRefusal(out);
  json(ctx.res, 200, { ok: true });
}

async function tradePartnerHandler(ctx: Ctx): Promise<void> {
  // ctx.query, not a re-parse of ctx.req.url: the router already parsed and
  // validated the query, and a second parser on an auth-relevant enumeration
  // can desync from it (server/internal.ts's param helper documents the same).
  const raw = ctx.query.name;
  const name = typeof raw === 'string' ? raw : '';
  const partner = await useService().tradePartner(ctxAccountId(ctx), stringField(name, 64));
  if (!partner) throw new HttpError(404, 'woc_market.not_found');
  json(ctx.res, 200, { partner });
}

async function listOffersHandler(ctx: Ctx): Promise<void> {
  const viewer = ctxAccountId(ctx);
  const offers = await useService().directedOffers(viewer);
  json(ctx.res, 200, { offers: offers.map((o) => offerView(o, viewer)) });
}

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/woc-market/offers',
    surface: 'api',
    middleware: [activeAccount, rateLimit(WOC_MARKET_READ_POLICY)],
    handler: listOffersHandler,
  },
  {
    // Can this character be paid in $WOC? Asked by the trade window before it
    // offers the arm. The subject is another player BY DESIGN, so there is no
    // owner to load; the name rides a query param rather than a path segment
    // because a character name is not an id and may contain spaces.
    // The QUOTE bucket, not the read one, ON PURPOSE: this is an
    // existence-plus-wallet-linkage oracle over free-text names, and the
    // widened polling budget must not widen how fast an account can harvest
    // who has linked a wallet. A trade needs one lookup; 30/min is ample.
    method: 'GET',
    path: '/api/woc-market/trade-partner',
    surface: 'api',
    middleware: [activeAccount, rateLimit(WOC_MARKET_QUOTE_POLICY)],
    handler: tradePartnerHandler,
  },
  {
    method: 'POST',
    path: '/api/woc-market/offers',
    surface: 'api',
    middleware: [activeAccount, rateLimit(WOC_MARKET_LIST_POLICY), withBody()],
    handler: createOfferHandler,
  },
  {
    // Acceptance escrows the item, so it rides the LIST policy (the escrow
    // limiter), not the cheaper read one.
    method: 'POST',
    path: '/api/woc-market/offers/:id/accept',
    surface: 'api',
    middleware: [activeAccount, rateLimit(WOC_MARKET_LIST_POLICY), withBody()],
    meta: NO_OWNER,
    handler: acceptOfferHandler,
  },
  {
    method: 'POST',
    path: '/api/woc-market/offers/:id/decline',
    surface: 'api',
    middleware: [activeAccount, rateLimit(WOC_MARKET_BID_POLICY), withBody()],
    meta: NO_OWNER,
    handler: declineOfferHandler,
  },
  {
    method: 'POST',
    path: '/api/woc-market/offers/:id/withdraw',
    surface: 'api',
    middleware: [activeAccount, rateLimit(WOC_MARKET_BID_POLICY), withBody()],
    meta: NO_OWNER,
    handler: withdrawOfferHandler,
  },
  {
    // The five hot GETs below all carry the shared read limiter (H11): every
    // one is a client-triggerable read, and an unmetered read is sustainable
    // at whatever rate a client cares to send. Their costs are bounded by the
    // caches behind them (the proxy price cache for status, the read cache
    // for browse/detail/me/history), so the limiter is the flood ceiling,
    // not the cost model.
    method: 'GET',
    path: '/api/woc-market/status',
    surface: 'api',
    middleware: [readAccount, rateLimit(WOC_MARKET_READ_POLICY)],
    handler: statusHandler,
  },
  {
    method: 'GET',
    path: '/api/woc-market/listings',
    surface: 'api',
    middleware: [readAccount, rateLimit(WOC_MARKET_READ_POLICY)],
    handler: browseHandler,
  },
  {
    method: 'GET',
    path: '/api/woc-market/listings/:id',
    surface: 'api',
    middleware: [readAccount, rateLimit(WOC_MARKET_READ_POLICY)],
    meta: NO_OWNER,
    handler: listingDetailHandler,
  },
  {
    method: 'GET',
    path: '/api/woc-market/estimate',
    surface: 'api',
    middleware: [readAccount, rateLimit(WOC_MARKET_QUOTE_POLICY)],
    handler: estimateHandler,
  },
  {
    method: 'GET',
    path: '/api/woc-market/me',
    surface: 'api',
    // Full-scope guard on purpose: this read returns the caller's own
    // financial history, and OAuth companion tokens carry scope 'read', so
    // the read guard would hand it to any third-party app the player
    // authorized for character reads. Pinned by the guard-tier scan in
    // tests/server/woc_market_routes.test.ts.
    middleware: [activeAccount, rateLimit(WOC_MARKET_READ_POLICY)],
    handler: myActivityHandler,
  },
  {
    method: 'GET',
    path: '/api/woc-market/seller-history/:name',
    surface: 'api',
    middleware: [readAccount, rateLimit(WOC_MARKET_READ_POLICY)],
    meta: NO_OWNER,
    handler: sellerHistoryHandler,
  },
  {
    method: 'GET',
    path: '/api/woc-market/history/:itemId',
    surface: 'api',
    middleware: [readAccount, rateLimit(WOC_MARKET_READ_POLICY)],
    meta: NO_OWNER,
    handler: historyHandler,
  },
  {
    // Step-up challenge issuance (B6/R1): its own bucket, see the policy.
    method: 'POST',
    path: '/api/woc-market/step-up/challenge',
    surface: 'api',
    middleware: [activeAccount, rateLimit(WOC_MARKET_STEPUP_POLICY), withBody()],
    handler: stepUpChallengeHandler,
  },
  {
    method: 'POST',
    path: '/api/woc-market/listings',
    surface: 'api',
    middleware: [activeAccount, rateLimit(WOC_MARKET_LIST_POLICY), withBody()],
    handler: createListingHandler,
  },
  {
    method: 'POST',
    path: '/api/woc-market/listings/:id/cancel',
    surface: 'api',
    middleware: [activeAccount, rateLimit(WOC_MARKET_LIST_POLICY), ownedListing],
    meta: OWNED_ACCOUNT,
    handler: cancelListingHandler,
  },
  {
    method: 'POST',
    path: '/api/woc-market/listings/:id/bids',
    surface: 'api',
    middleware: [activeAccount, rateLimit(WOC_MARKET_BID_POLICY), withBody()],
    meta: NO_OWNER,
    handler: placeBidHandler,
  },
  {
    method: 'POST',
    path: '/api/woc-market/bids/:id/bond-quote',
    surface: 'api',
    middleware: [activeAccount, rateLimit(WOC_MARKET_QUOTE_POLICY), ownedBid],
    meta: OWNED_ACCOUNT,
    handler: bondQuoteHandler,
  },
  {
    method: 'POST',
    path: '/api/woc-market/bids/:id/bond',
    surface: 'api',
    middleware: [activeAccount, rateLimit(WOC_MARKET_CONFIRM_POLICY), withBody(), ownedBid],
    meta: OWNED_ACCOUNT,
    handler: confirmBondHandler,
  },
  {
    method: 'POST',
    path: '/api/woc-market/bids/:id/abandon',
    surface: 'api',
    // The QUOTE policy, not CONFIRM: giving up costs the economy service
    // nothing, and a player retrying an abandon must not be rate-limited into
    // keeping a lock they are trying to release.
    middleware: [activeAccount, rateLimit(WOC_MARKET_QUOTE_POLICY), ownedBid],
    meta: OWNED_ACCOUNT,
    handler: abandonBidHandler,
  },
  {
    method: 'POST',
    path: '/api/woc-market/listings/:id/buy-now',
    surface: 'api',
    middleware: [activeAccount, rateLimit(WOC_MARKET_BID_POLICY), withBody()],
    meta: NO_OWNER,
    handler: buyNowHandler,
  },
  {
    method: 'POST',
    path: '/api/woc-market/settlements/:id/quote',
    surface: 'api',
    middleware: [activeAccount, rateLimit(WOC_MARKET_QUOTE_POLICY), ownedSettlement],
    meta: OWNED_ACCOUNT,
    handler: settlementQuoteHandler,
  },
  {
    method: 'POST',
    path: '/api/woc-market/settlements/:id/confirm',
    surface: 'api',
    middleware: [activeAccount, rateLimit(WOC_MARKET_CONFIRM_POLICY), withBody(), ownedSettlement],
    meta: OWNED_ACCOUNT,
    handler: confirmSettlementHandler,
  },
  // Operator arms: the central ADMIN_ROUTE_PERMISSIONS gate authorizes each
  // concrete path (moderation.read / moderation.act rows in admin_routes.ts).
  {
    method: 'GET',
    path: '/admin/api/woc-market/listings',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: adminListingsHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/woc-market/listings/:id/suspend',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('woc-market-listing')],
    meta: ADMIN_TARGET_META,
    handler: adminSuspendListingHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/woc-market/sales/:id/excluded',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('woc-market-sale'), withBody()],
    meta: ADMIN_TARGET_META,
    handler: adminSaleExcludedHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/woc-market/accounts/:id/clear-strikes',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('woc-market-account')],
    meta: ADMIN_TARGET_META,
    handler: adminClearStrikesHandler,
  },
];
