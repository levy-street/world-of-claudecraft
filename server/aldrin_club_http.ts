// HTTP shell for the Aldrin Club: the route handlers that wire req/res to the
// pure logic (aldrin_club.ts), the Solana + Stripe shells, and the DB. This is
// the "shell" half of the pure/IO split (mirrors wallet.ts over wallet_link.ts):
// no domain decisions live here, only validation, IO orchestration, and JSON.
//
// Routes (registered in server/main.ts):
//   GET  /api/aldrin                 membership status + price + methods + perks
//   POST /api/aldrin/quote           { method }            -> a payment quote
//   POST /api/aldrin/confirm         { quoteId, signature } -> verify + grant
//   POST /api/aldrin/stripe/webhook  (Stripe-signed)        -> verify + grant
import * as http from 'node:http';
import { randomBytes } from 'node:crypto';
import { json, readBody, readBinaryBody } from './http_util';
import {
  ALDRIN_BUYBACK_VAULT,
  ALDRIN_ENABLED,
  ALDRIN_BURN_BPS,
  ALDRIN_PERIOD_DAYS,
  ALDRIN_PRICE_USD_CENTS,
  ALDRIN_QUOTE_TTL_SECONDS,
  ALDRIN_STRIPE_ENABLED,
  ALDRIN_STRIPE_WEBHOOK_SECRET,
  ALDRIN_TREASURY,
  SOL_DECIMALS,
  USDC_DECIMALS,
  USDC_MINT,
  WOC_DECIMALS,
  WOC_MINT,
} from './aldrin_config';
import {
  ALDRIN_METHODS,
  ALDRIN_PERKS,
  type AldrinMembership,
  type AldrinPayMethod,
  buildQuote,
  daysRemaining,
  extendMembership,
  healMembership,
  isCryptoMethod,
  isPayMethod,
  membershipActive,
  quoteExpired,
  splitAldrinAmount,
  usdCentsToAssetBase,
  verifyAldrinPayment,
} from './aldrin_club';
import { assetUsdPrice, parseAldrinPayment } from './aldrin_solana';
import { grantFromStripeEvent, verifyStripeSignature } from './aldrin_stripe';
import { loadAldrinMembership, setAldrinMembership, walletForAccount } from './db';
import {
  aldrinPaymentByReference,
  deleteAldrinQuote,
  insertAldrinQuote,
  loadAldrinQuote,
  recordAldrinPayment,
} from './aldrin_club_db';

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

function enabledMethods(): AldrinPayMethod[] {
  return ALDRIN_METHODS.filter((m) => {
    if (m === 'stripe') return ALDRIN_STRIPE_ENABLED;
    // The treasury and buyback vault must be distinct, else one credit could
    // satisfy both the treasury and buyback legs and silently break the 50/50.
    if (m === 'sol' || m === 'usdc') {
      return !!ALDRIN_TREASURY && !!ALDRIN_BUYBACK_VAULT && ALDRIN_TREASURY !== ALDRIN_BUYBACK_VAULT;
    }
    if (m === 'woc') return !!ALDRIN_TREASURY;
    return false;
  });
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
export async function handleAldrinQuote(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (!ALDRIN_ENABLED) return json(res, 404, { error: 'aldrin club not available' });
  const body = await readBody(req);
  const method = body.method;
  if (!isPayMethod(method)) return json(res, 400, { error: 'unknown payment method' });
  if (!enabledMethods().includes(method)) return json(res, 503, { error: 'payment method not configured' });

  if (method === 'stripe') {
    // v1: the client redirects to a Stripe Checkout link created out-of-band with
    // client_reference_id=<accountId>. Wiring Checkout-session creation here is a
    // documented follow-up (needs the live secret key); see the PRD.
    return json(res, 501, { error: 'stripe checkout is created client-side; see docs' });
  }

  // Crypto rails require a linked, signature-verified wallet (the payer).
  const wallet = await walletForAccount(accountId);
  if (!wallet) return json(res, 409, { error: 'link a Solana wallet first' });

  const mint = method === 'usdc' ? USDC_MINT : method === 'woc' ? WOC_MINT : null;
  const decimals = method === 'sol' ? SOL_DECIMALS : method === 'usdc' ? USDC_DECIMALS : WOC_DECIMALS;

  const usdPerAsset = await assetUsdPrice(method);
  if (usdPerAsset === null || usdPerAsset <= 0) return json(res, 502, { error: 'price feed unavailable' });
  const priceBase = usdCentsToAssetBase(ALDRIN_PRICE_USD_CENTS, usdPerAsset, decimals);
  if (priceBase <= 0n) return json(res, 502, { error: 'could not price this asset' });

  const quote = buildQuote({
    quoteId: randomBytes(16).toString('hex'),
    accountId,
    method,
    usdCents: ALDRIN_PRICE_USD_CENTS,
    mint,
    decimals,
    priceBase,
    treasury: ALDRIN_TREASURY,
    // SOL/USDC route the buyback split to the vault; $WOC is burned in-tx by the payer.
    buyback: method === 'woc' ? null : ALDRIN_BUYBACK_VAULT,
    burnBps: ALDRIN_BURN_BPS,
    nowMs: Date.now(),
    ttlSeconds: ALDRIN_QUOTE_TTL_SECONDS,
  });
  await insertAldrinQuote(quote);
  return json(res, 200, { quote, payer: wallet.pubkey });
}

// POST /api/aldrin/confirm  { quoteId, signature }
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
  const nowMs = Date.now();
  if (quoteExpired(quote, nowMs)) {
    await deleteAldrinQuote(quoteId);
    return json(res, 410, { error: 'quote expired, request a new one' });
  }

  const wallet = await walletForAccount(accountId);
  if (!wallet) return json(res, 409, { error: 'link a Solana wallet first' });

  const parsed = await parseAldrinPayment(signature, quote, wallet.pubkey);
  const verdict = verifyAldrinPayment(quote, parsed);
  if (!verdict.ok) {
    // not_finalized is transient: keep the quote so the client can retry.
    const status = verdict.reason === 'not_finalized' ? 202 : 400;
    return json(res, status, { error: verdict.reason });
  }

  const prev = await loadAldrinMembership(accountId);
  const membership = extendMembership(prev, nowMs, quote.method, ALDRIN_PERIOD_DAYS, false);

  // Ledger first (UNIQUE on signature) is the replay guard, so the same tx never
  // extends twice. If the insert is fresh, grant; if it was already recorded,
  // self-heal idempotently to the recorded expiry (covers the case where a prior
  // grant write failed after the ledger insert committed, stranding a paid member)
  // without extending again.
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
export async function handleAldrinStripeWebhook(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (!ALDRIN_ENABLED || !ALDRIN_STRIPE_ENABLED) return json(res, 404, { error: 'not available' });
  // Stripe events (expanded invoices with many line items) can exceed 64 KiB.
  const raw = (await readBinaryBody(req, 256 * 1024)).toString('utf8');
  const sigHeader = String(req.headers['stripe-signature'] ?? '');
  const verified = verifyStripeSignature(raw, sigHeader, ALDRIN_STRIPE_WEBHOOK_SECRET, Math.floor(Date.now() / 1000));
  if (!verified.ok) return json(res, 400, { error: `signature: ${verified.reason}` });

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return json(res, 400, { error: 'bad json' });
  }

  const grant = grantFromStripeEvent(event);
  if (!grant) return json(res, 200, { ignored: true }); // ack events we do not act on

  const nowMs = Date.now();
  const prev = await loadAldrinMembership(grant.accountId);
  const membership = extendMembership(prev, nowMs, 'stripe', ALDRIN_PERIOD_DAYS, grant.autoRenew);

  // Fiat cannot be burned in-transaction, so the split is recorded as an earmark
  // in USD cents (the buyback share to off-ramp + burn later); fiat ledger rows
  // are denominated in cents, not token base units.
  const earmark = splitAldrinAmount(BigInt(ALDRIN_PRICE_USD_CENTS), ALDRIN_BURN_BPS);

  // Idempotency: the Stripe event id is the ledger reference, so a redelivered
  // webhook never extends twice. As on the crypto path, a duplicate self-heals to
  // the recorded grant so a failed grant write cannot strand a paid member.
  const fresh = await recordAldrinPayment({
    accountId: grant.accountId,
    method: 'stripe',
    reference: grant.eventId,
    usdCents: ALDRIN_PRICE_USD_CENTS,
    mint: null,
    priceBase: BigInt(ALDRIN_PRICE_USD_CENTS),
    treasuryBase: earmark.treasuryBase,
    splitBase: earmark.splitBase,
    grantedUntil: membership.until,
  });
  if (fresh) {
    await setAldrinMembership(grant.accountId, membership);
  } else {
    const recorded = await aldrinPaymentByReference(grant.eventId);
    const current = await loadAldrinMembership(grant.accountId);
    const healed = healMembership(current, recorded?.grantedUntil, 'stripe', ALDRIN_PERIOD_DAYS);
    if (healed) await setAldrinMembership(grant.accountId, healed);
  }
  return json(res, 200, { received: true });
}
