// HTTP shell for the Aldrin Club: the route handlers that wire req/res to the
// economy service (via server/subscription_proxy.ts) and the local membership
// ledger. This is the "shell" half of the pure/IO split (mirrors wallet.ts over
// wallet_link.ts): no domain decisions live here, only validation, IO
// orchestration, and JSON.
//
// SPLIT ARCHITECTURE (#938): ALL money logic moved to the economy service. The
// game NEVER prices an asset, verifies an on-chain payment, holds a Stripe
// secret, verifies a Stripe signature, or computes the 50/50 treasury +
// buy-and-burn split. The service owns settlement (memo-bound native rails +
// Stripe webhook), the split, and the flow_ledger projection; this shell only
// proxies to it and, on the service's verified verdict, grants/extends the local
// membership (which rides the existing cosmetics sync to the client). With the
// service OFF every route degrades to a clean disabled state.
//
// Routes (registered in server/main.ts):
//   GET  /api/aldrin                 membership status + price + methods + perks
//   POST /api/aldrin/quote           { method }             -> a service payment quote
//   POST /api/aldrin/confirm         { quoteId, signature } -> service verify + grant
//   POST /api/aldrin/stripe/webhook  (Stripe-signed)        -> service verify + grant

import type * as http from 'node:http';
import {
  ALDRIN_METHODS,
  ALDRIN_PERKS,
  type AldrinMembership,
  type AldrinPayMethod,
  daysRemaining,
  extendMembership,
  healMembership,
  isCryptoMethod,
  isPayMethod,
  membershipActive,
} from './aldrin_club';
import {
  aldrinPaymentByReference,
  deleteAldrinQuote,
  insertAldrinQuote,
  loadAldrinQuote,
  recordAldrinPayment,
} from './aldrin_club_db';
import {
  ALDRIN_BURN_BPS,
  ALDRIN_ENABLED,
  ALDRIN_PERIOD_DAYS,
  ALDRIN_PRICE_USD_CENTS,
  ALDRIN_STRIPE_ENABLED,
} from './aldrin_config';
import { loadAldrinMembership, setAldrinMembership } from './db';
import { json, readBinaryBody, readBody } from './http_util';
import {
  type SubRail,
  subscriptionCancel,
  subscriptionConfirm,
  subscriptionCreate,
  subscriptionServiceConfigured,
  subscriptionStatus,
  subscriptionStripeWebhook,
} from './subscription_proxy';

// Public membership view for the client (booleans + display fields only).
function membershipView(m: AldrinMembership | null, nowMs: number) {
  if (!m) return null;
  return {
    active: membershipActive(m, nowMs),
    since: m.since,
    until: m.until,
    daysRemaining: daysRemaining(m, nowMs),
    autoRenew: m.autoRenew,
    lastMethod: m.lastMethod,
  };
}

// The pay method -> service rail mapping is 1:1 (both use 'sol'|'usdc'|'woc'|'stripe').
function toSubRail(method: AldrinPayMethod): SubRail {
  return method;
}

// The rails advertised to the client. The service owns whether a rail can quote
// (price/config); the game advertises the whole set only when the service is
// configured, plus the Stripe flag. When the service is off, NO rail is offered
// (the subscribe UI renders disabled), which is the fail-closed contract.
function enabledMethods(): AldrinPayMethod[] {
  if (!subscriptionServiceConfigured()) return [];
  return ALDRIN_METHODS.filter((m) => (m === 'stripe' ? ALDRIN_STRIPE_ENABLED : true));
}

// GET /api/aldrin
export async function handleAldrinStatus(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (!ALDRIN_ENABLED) return json(res, 404, { error: 'aldrin club not available' });
  const membership = await loadAldrinMembership(accountId);
  return json(res, 200, {
    enabled: true,
    priceUsdCents: ALDRIN_PRICE_USD_CENTS,
    periodDays: ALDRIN_PERIOD_DAYS,
    burnBps: ALDRIN_BURN_BPS,
    methods: enabledMethods(),
    perks: ALDRIN_PERKS,
    membership: membershipView(membership, Date.now()),
  });
}

// POST /api/aldrin/quote  { method }
// Asks the economy service for a subscription quote and maps it into the wire
// shape the client already consumes. The game computes no price and no split: the
// amount, memo (the service subscriptionId), destination, and $WOC 50/50 split all
// come from the service. The quote is stored keyed by the service subscriptionId
// so confirm can find it (and enforce ownership + a local TTL).
export async function handleAldrinQuote(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (!ALDRIN_ENABLED) return json(res, 404, { error: 'aldrin club not available' });
  const body = await readBody(req);
  const method = body.method;
  if (!isPayMethod(method)) return json(res, 400, { error: 'unknown payment method' });
  if (!enabledMethods().includes(method))
    return json(res, 503, { error: 'payment method not configured' });

  const created = await subscriptionCreate({
    accountId,
    rail: toSubRail(method),
    idempotencyKey: `${accountId}:${method}:${Date.now()}`,
  });
  if (!created.ok || created.reason || !created.subscriptionId) {
    // Service off / rail disabled / already subscribed / unpriced: fail closed.
    const status = created.reason === 'unavailable' ? 503 : 502;
    return json(res, status, { error: created.reason ?? 'quote unavailable' });
  }

  if (method === 'stripe') {
    // Stripe returns a client secret; the client completes payment with Stripe.js
    // and the service webhook grants membership. There is no on-chain quote here.
    if (!created.stripe) return json(res, 502, { error: 'stripe intent unavailable' });
    return json(res, 200, {
      subscriptionId: created.subscriptionId,
      rail: 'stripe',
      stripe: created.stripe,
    });
  }

  // Native rail: map the service native intent into the AldrinQuote wire.
  const native = created.native;
  if (!native) return json(res, 502, { error: 'native quote unavailable' });
  const decimals = decimalsForRail(method);
  const priceBase = native.amountBase;
  const splitBase = native.split?.burnBase ?? '0';
  const treasuryBase = native.split?.treasuryBase ?? subtractBase(priceBase, splitBase);
  const quote = {
    quoteId: created.subscriptionId, // the service memo == subscriptionId
    accountId,
    method,
    usdCents: ALDRIN_PRICE_USD_CENTS,
    mint: native.mint,
    decimals,
    priceBase,
    treasury: native.split?.treasury ?? native.destination,
    // The service settles the split itself (memo-bound to the pay-in address); the
    // client sends a single transfer to `destination` with `memo`. There is no
    // separate client-built buyback leg, so buyback is null on the wire.
    buyback: null,
    treasuryBase,
    splitBase,
    memo: native.memo,
    expiresAt: new Date(native.expiresAtMs).toISOString(),
  };
  await insertAldrinQuote(quote);
  // The client sends the quoted amount to `destination` carrying `memo`.
  return json(res, 200, { quote, payer: null, destination: native.destination });
}

// POST /api/aldrin/confirm  { quoteId, signature }
// The service verifies the settled memo-bound native payment on-chain (finalized,
// exact amount, right destination, matching memo) and activates. The game does NO
// verification: it forwards the signature, and on the service's 'active' verdict
// grants/extends membership through the local ledger (idempotent on the signature).
export async function handleAldrinConfirm(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (!ALDRIN_ENABLED) return json(res, 404, { error: 'aldrin club not available' });
  const body = await readBody(req);
  const quoteId = typeof body.quoteId === 'string' ? body.quoteId : '';
  const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
  if (!quoteId || !signature) return json(res, 400, { error: 'quoteId and signature required' });

  const quote = await loadAldrinQuote(quoteId, accountId);
  if (!quote) return json(res, 404, { error: 'quote not found' });
  if (!isCryptoMethod(quote.method)) return json(res, 400, { error: 'not an on-chain quote' });

  // The service owns verification. subscriptionId == the quote's memo == quoteId.
  const verified = await subscriptionConfirm({ subscriptionId: quoteId, signature });
  if (verified.status !== 'active') {
    // not_finalized/underpaid/etc. surface as a non-active status. Keep the quote
    // so the client can retry a transient failure; the service is authoritative.
    return json(res, 202, { status: verified.status });
  }

  const nowMs = Date.now();
  const prev = await loadAldrinMembership(accountId);
  const membership = extendMembership(prev, nowMs, quote.method, ALDRIN_PERIOD_DAYS, false);

  // Ledger first (UNIQUE on signature) is the replay guard, so the same tx never
  // extends twice. If the insert is fresh, grant; if it was already recorded,
  // self-heal idempotently to the recorded expiry (covers a prior grant write that
  // failed after the ledger insert committed) without extending again.
  const fresh = await recordAldrinPayment({
    accountId,
    method: quote.method,
    reference: signature,
    usdCents: quote.usdCents,
    mint: quote.mint,
    priceBase: BigInt(quote.priceBase),
    treasuryBase: BigInt(quote.treasuryBase),
    splitBase: BigInt(quote.splitBase),
    grantedUntil: membership.until,
  });
  await deleteAldrinQuote(quoteId);

  if (fresh) {
    await setAldrinMembership(accountId, membership);
    return json(res, 200, { membership: membershipView(membership, nowMs) });
  }

  const recorded = await aldrinPaymentByReference(signature);
  const current = await loadAldrinMembership(accountId);
  const healed = healMembership(current, recorded?.grantedUntil, quote.method, ALDRIN_PERIOD_DAYS);
  if (healed) await setAldrinMembership(accountId, healed);
  return json(res, 200, { membership: membershipView(healed ?? current, nowMs), idempotent: true });
}

// POST /api/aldrin/stripe/webhook  (verified by Stripe-Signature, not a bearer token)
// The game NEVER verifies the Stripe signature or holds the Stripe signing secret:
// it forwards the raw signed body to the service, which verifies it and activates
// the subscription. On the service's ack, the game reconciles the local membership
// from the service status (the subscriptionId metadata carries the account).
export async function handleAldrinStripeWebhook(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (!ALDRIN_ENABLED || !ALDRIN_STRIPE_ENABLED) return json(res, 404, { error: 'not available' });
  // Stripe events (expanded invoices with many line items) can exceed 64 KiB.
  const raw = (await readBinaryBody(req, 256 * 1024)).toString('utf8');
  const sigHeader = String(req.headers['stripe-signature'] ?? '');

  const forwarded = await subscriptionStripeWebhook(raw, sigHeader);
  if (!forwarded.received) {
    // The service rejected the signature or is unreachable. Do not grant.
    return json(res, 400, { error: 'webhook not accepted' });
  }
  // The service verified + activated. Reconcile the local membership from the
  // account carried in the event metadata (parsed from the raw body). We only read
  // the account id here; the service is the source of truth for activation.
  const accountId = accountIdFromStripeBody(raw);
  if (accountId !== null) {
    await reconcileStripeMembership(accountId);
  }
  return json(res, 200, { received: true });
}

// Reconcile the local membership from the service status after a Stripe webhook.
// The service holds the active/expiry; the game mirrors it into the local
// membership so the cosmetics sync reflects the paid state. Idempotent: a
// redelivered webhook converges to the same grant, never double-extends.
async function reconcileStripeMembership(accountId: number): Promise<void> {
  const status = await subscriptionStatus(accountId);
  if (status.status !== 'active') return;
  const nowMs = Date.now();
  const prev = await loadAldrinMembership(accountId);
  // Mirror the service's period end when present; otherwise extend by one period.
  const untilMs = status.currentPeriodEndsMs ?? nowMs + ALDRIN_PERIOD_DAYS * 86_400_000;
  const untilISO = new Date(untilMs).toISOString();
  const current = healMembership(prev, untilISO, 'stripe', ALDRIN_PERIOD_DAYS);
  const membership: AldrinMembership =
    current ??
    extendMembership(prev, nowMs, 'stripe', ALDRIN_PERIOD_DAYS, status.status === 'active');
  membership.autoRenew = true; // Stripe is the recurring rail
  await setAldrinMembership(accountId, membership);
}

// Cancel a subscription (at period end or immediately). Proxies to the service,
// which owns the cancel state; the local membership expiry is left to lapse (a
// period-end cancel keeps perks until the current period ends).
export async function handleAldrinCancel(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (!ALDRIN_ENABLED) return json(res, 404, { error: 'aldrin club not available' });
  const body = await readBody(req);
  const subscriptionId = typeof body.subscriptionId === 'string' ? body.subscriptionId : '';
  const atPeriodEnd = body.atPeriodEnd !== false; // default: keep perks until period end
  if (!subscriptionId) return json(res, 400, { error: 'subscriptionId required' });
  const result = await subscriptionCancel({ accountId, subscriptionId, atPeriodEnd });
  if (!result.cancelled) {
    const status = result.reason === 'unavailable' ? 503 : 400;
    return json(res, status, { error: result.reason ?? 'cancel failed' });
  }
  return json(res, 200, { cancelled: true, effectiveMs: result.effectiveMs });
}

// ---- small local helpers (no money math; shape + parsing only) -------------

function decimalsForRail(method: AldrinPayMethod): number {
  if (method === 'sol') return 9;
  if (method === 'usdc') return 6;
  if (method === 'woc') return 6;
  return 0;
}

// Base-unit subtraction as a decimal string (the treasury remainder when the
// service does not send an explicit split). Never negative.
function subtractBase(total: string, part: string): string {
  try {
    const t = BigInt(total);
    const p = BigInt(part);
    const r = t - p;
    return (r > 0n ? r : 0n).toString();
  } catch {
    return '0';
  }
}

// Read our account id from the Stripe event metadata in the raw body. The service
// keys activation on its subscriptionId; the account id is carried in the event
// metadata (subscription_id + account_id) we set at create time. We only parse it
// to reconcile the LOCAL membership mirror; the service already verified + granted.
function accountIdFromStripeBody(raw: string): number | null {
  try {
    const evt = JSON.parse(raw) as { data?: { object?: { metadata?: Record<string, unknown> } } };
    const meta = evt?.data?.object?.metadata ?? {};
    const v = meta.account_id;
    const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
