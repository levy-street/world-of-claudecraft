// Stripe (fiat card) rail for the Aldrin Club. We verify inbound webhooks with
// raw HMAC-SHA256 via node:crypto and parse the event ourselves, adding NO Stripe
// SDK dependency (the repo keeps its dependency set tiny). Signature verification
// is a pure function of (rawBody, header, secret, now) so it is unit-testable.
//
// Fiat cannot be trustlessly burned on-chain, so the 50/50 economics are a
// treasury policy on this rail, not an in-tx split: Stripe funds settle to the
// project, which periodically off-ramps the buyback share to USDC and runs it
// through the same buyback keeper. v1 records the fiat earmark; the automated
// fiat -> USDC -> burn off-ramp is out of v1 scope (see the PRD).
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface StripeVerifyResult {
  ok: boolean;
  reason?: string;
}

/**
 * Verify a Stripe `Stripe-Signature` header against the raw (unparsed) request
 * body. The header is `t=<unix>,v1=<hex>[,v1=<hex>...]`; the signed payload is
 * `"<t>.<rawBody>"` HMAC-SHA256'd with the endpoint secret. Rejects stale
 * timestamps (replay) outside `toleranceSec`. Constant-time signature compare.
 */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  nowSec: number,
  toleranceSec = 300,
): StripeVerifyResult {
  if (!secret) return { ok: false, reason: 'no_secret' };
  if (!signatureHeader) return { ok: false, reason: 'no_signature' };

  let timestamp = '';
  const candidates: string[] = [];
  for (const part of signatureHeader.split(',')) {
    const [k, v] = part.split('=');
    if (k === 't') timestamp = (v ?? '').trim();
    else if (k === 'v1') candidates.push((v ?? '').trim());
  }
  if (!timestamp || candidates.length === 0) return { ok: false, reason: 'malformed' };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'malformed' };
  if (Math.abs(nowSec - ts) > toleranceSec) return { ok: false, reason: 'timestamp_out_of_tolerance' };

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const matched = candidates.some((sig) => {
    const sigBuf = Buffer.from(sig, 'utf8');
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
  });
  return matched ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}

export interface StripeGrant {
  /** Our account id, from checkout `client_reference_id`. */
  accountId: number;
  /** Stripe event id, used as the idempotency key in the payment ledger. */
  eventId: string;
  /** True for a recurring subscription invoice/session (auto-renew). */
  autoRenew: boolean;
}

/**
 * Extract a membership grant from a parsed Stripe event, or null if the event is
 * not one we act on. We act on `checkout.session.completed` (first activation)
 * and `invoice.paid` (recurring renewal). `client_reference_id` carries our
 * account id on a Checkout Session.
 *
 * NOTE: a Stripe `invoice` object does NOT carry `client_reference_id`; for
 * recurring renewals to map back to an account, the subscription must be created
 * with `metadata.accountId` (read here as a fallback). Wiring that into the
 * deferred Checkout-session creation is required before auto-renew works; until
 * then `invoice.paid` events without that metadata are safely ignored.
 */
export function grantFromStripeEvent(event: unknown): StripeGrant | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as { id?: unknown; type?: unknown; data?: { object?: any } };
  const eventId = typeof e.id === 'string' ? e.id : '';
  const obj = e.data?.object ?? {};
  if (!eventId) return null;

  if (e.type === 'checkout.session.completed') {
    if (obj.payment_status && obj.payment_status !== 'paid') return null;
    const accountId = parseAccountRef(obj.client_reference_id);
    if (accountId === null) return null;
    return { accountId, eventId, autoRenew: obj.mode === 'subscription' };
  }

  if (e.type === 'invoice.paid') {
    const accountId = parseAccountRef(obj.client_reference_id ?? obj.metadata?.accountId);
    if (accountId === null) return null;
    return { accountId, eventId, autoRenew: true };
  }

  return null;
}

function parseAccountRef(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}
