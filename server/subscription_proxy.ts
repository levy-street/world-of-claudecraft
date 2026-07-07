// Typed game-server client for the external SUBSCRIPTION economy service (Aldric
// Club billing, game PR #938). Mirrors server/claudium_proxy.ts.
//
// The subscription is a server-authoritative recurring purchase: ALL pricing,
// on-chain payment verification, the 50/50 treasury + buy-and-burn split, and the
// Stripe webhook verification live in the economy service (a separate repo). The
// game NEVER verifies a payment, holds a Stripe secret, or recomputes a split;
// this module is the game server's proxy to that service. The browser hits the
// game server, the game server hits the service over a secret-gated internal API.
//
// GRACEFUL DEGRADATION IS THE CONTRACT. If WOC_ECONOMY_SERVICE_URL or
// WOC_ECONOMY_INTERNAL_SECRET is unset, OR the service is unreachable / errors /
// times out, EVERY function here returns a typed "unavailable" result (status
// none, create disabled) and NEVER throws up into request handling. The game must
// boot and play with the service OFF (the subscribe UI renders disabled).
//
// The Stripe webhook is the one call that is NOT internal-secret gated on the
// service side: it authenticates by the Stripe signature. This proxy forwards the
// raw signed body and the stripe-signature header verbatim so the service can
// verify it; the game never sees or holds the Stripe signing secret.

const SERVICE_TIMEOUT_MS = 5000;

export type SubRail = 'stripe' | 'sol' | 'usdc' | 'woc';
export type SubStatus = 'active' | 'past_due' | 'cancelled' | 'expired' | 'none';

function serviceUrl(): string {
  return (process.env.WOC_ECONOMY_SERVICE_URL ?? '').trim();
}

function serviceSecret(): string {
  return process.env.WOC_ECONOMY_INTERNAL_SECRET ?? '';
}

/** The service is reachable only when BOTH the URL and the secret are set. */
export function subscriptionServiceConfigured(): boolean {
  return serviceUrl() !== '' && serviceSecret() !== '';
}

let loggedOnce = false;
function logFailure(err: unknown): void {
  // Dev-channel only; the request path never sees this. Log once so a persistently
  // down service does not flood the server log every request.
  if (loggedOnce) return;
  loggedOnce = true;
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[subscription] economy service unavailable: ${message}`);
}

interface ServiceRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
}

/**
 * The one JSON fetch wrapper. Returns the parsed JSON on a 2xx, or null on any
 * failure (unconfigured, non-2xx, network error, timeout, bad JSON). It NEVER
 * throws: every caller maps a null into its own typed unavailable result.
 */
async function callService<T>(req: ServiceRequest): Promise<T | null> {
  const base = serviceUrl();
  const secret = serviceSecret();
  if (base === '' || secret === '') return null;
  try {
    const url = new URL(req.path.replace(/^\//, ''), base.endsWith('/') ? base : `${base}/`);
    const headers: Record<string, string> = { 'x-woc-economy-secret': secret };
    let body: string | undefined;
    if (req.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(req.body);
    }
    const res = await fetch(url, {
      method: req.method,
      headers,
      body,
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${req.method} ${req.path} -> ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    logFailure(err);
    return null;
  }
}

// ---- create ---------------------------------------------------------------
/** The Stripe leg of a create: the client secret + publishable key for Stripe.js. */
export interface SubStripeIntent {
  clientSecret: string;
  publishableKey: string;
}

/**
 * The native-rail leg of a create: the exact per-period amount to send, the
 * destination, the memo the payment must carry (the service verifies against it),
 * and the $WOC 50/50 split. Every value is service-authoritative; the game renders
 * it verbatim and computes none.
 */
export interface SubNativeIntent {
  amountBase: string;
  destination: string;
  mint: string | null;
  memo: string;
  expiresAtMs: number;
  split: { burnBase: string; treasuryBase: string; treasury: string } | null;
}

export interface SubCreateResult {
  ok: boolean;
  subscriptionId: string | null;
  rail: SubRail | null;
  periodMs: number | null;
  stripe: SubStripeIntent | null;
  native: SubNativeIntent | null;
  reason: string | null;
}

/** POST subscription/create. ok:false with a reason when the service is off. */
export async function subscriptionCreate(input: {
  accountId: number;
  rail: SubRail;
  idempotencyKey: string;
}): Promise<SubCreateResult> {
  const data = await callService<{
    subscriptionId: string;
    rail: SubRail;
    periodMs: number;
    stripe?: SubStripeIntent;
    native?: {
      amountBase: string;
      destination: string;
      mint: string | null;
      memo: string;
      expiresAtMs: number;
      split?: { burnBase: string; treasuryBase: string; treasury: string };
    };
    reason?: string;
  }>({ method: 'POST', path: 'create', body: input });
  if (!data) {
    return {
      ok: false,
      subscriptionId: null,
      rail: null,
      periodMs: null,
      stripe: null,
      native: null,
      reason: 'unavailable',
    };
  }
  return {
    ok: true,
    subscriptionId: data.subscriptionId || null,
    rail: data.rail ?? null,
    periodMs: typeof data.periodMs === 'number' ? data.periodMs : null,
    stripe: data.stripe ?? null,
    native: data.native
      ? {
          amountBase: data.native.amountBase,
          destination: data.native.destination,
          mint: data.native.mint,
          memo: data.native.memo,
          expiresAtMs: data.native.expiresAtMs,
          split: data.native.split ?? null,
        }
      : null,
    reason: data.reason ?? null,
  };
}

// ---- confirm (native rails) -----------------------------------------------
export interface SubStatusResult {
  subscriptionId: string | null;
  accountId: number | null;
  status: SubStatus;
  rail: SubRail | null;
  currentPeriodEndsMs: number | null;
  cancelAtPeriodEnd: boolean;
}

const OFF_STATUS: SubStatusResult = {
  subscriptionId: null,
  accountId: null,
  status: 'none',
  rail: null,
  currentPeriodEndsMs: null,
  cancelAtPeriodEnd: false,
};

function parseStatus(data: unknown): SubStatusResult {
  if (!data || typeof data !== 'object') return { ...OFF_STATUS };
  const d = data as Record<string, unknown>;
  const status =
    d.status === 'active' ||
    d.status === 'past_due' ||
    d.status === 'cancelled' ||
    d.status === 'expired'
      ? (d.status as SubStatus)
      : 'none';
  const rail =
    d.rail === 'stripe' || d.rail === 'sol' || d.rail === 'usdc' || d.rail === 'woc'
      ? (d.rail as SubRail)
      : null;
  return {
    subscriptionId: typeof d.subscriptionId === 'string' ? d.subscriptionId : null,
    accountId: typeof d.accountId === 'number' ? d.accountId : null,
    status,
    rail,
    currentPeriodEndsMs: typeof d.currentPeriodEndsMs === 'number' ? d.currentPeriodEndsMs : null,
    cancelAtPeriodEnd: d.cancelAtPeriodEnd === true,
  };
}

/**
 * POST subscription/confirm. The service verifies the settled memo-bound native
 * payment on-chain and activates. Returns the resulting status (status 'none'
 * when the service is off or the tx did not verify).
 */
export async function subscriptionConfirm(input: {
  subscriptionId: string;
  signature: string;
}): Promise<SubStatusResult> {
  const data = await callService<unknown>({ method: 'POST', path: 'confirm', body: input });
  if (!data) return { ...OFF_STATUS };
  return parseStatus(data);
}

/** GET subscription/status/:accountId. status 'none' when the service is off. */
export async function subscriptionStatus(accountId: number): Promise<SubStatusResult> {
  const data = await callService<unknown>({
    method: 'GET',
    path: `status/${encodeURIComponent(String(accountId))}`,
  });
  if (!data) return { ...OFF_STATUS };
  return parseStatus(data);
}

// ---- cancel ---------------------------------------------------------------
export interface SubCancelResult {
  cancelled: boolean;
  effectiveMs: number | null;
  reason: string | null;
}

/** POST subscription/cancel. cancelled:false (reason 'unavailable') when off. */
export async function subscriptionCancel(input: {
  accountId: number;
  subscriptionId: string;
  atPeriodEnd: boolean;
}): Promise<SubCancelResult> {
  const data = await callService<{
    cancelled: boolean;
    effectiveMs: number | null;
    reason?: string;
  }>({ method: 'POST', path: 'cancel', body: input });
  if (!data) return { cancelled: false, effectiveMs: null, reason: 'unavailable' };
  return {
    cancelled: Boolean(data.cancelled),
    effectiveMs: typeof data.effectiveMs === 'number' ? data.effectiveMs : null,
    reason: data.reason ?? null,
  };
}

// ---- perks (cosmetic only) ------------------------------------------------
export interface SubPerkResult {
  perkId: string;
  kind: 'cosmetic';
  label: string;
  active: boolean;
}

export interface SubPerksResult {
  accountId: number | null;
  status: SubStatus;
  perks: SubPerkResult[];
}

/** GET subscription/perks/:accountId. Empty perks when the service is off. */
export async function subscriptionPerks(accountId: number): Promise<SubPerksResult> {
  const data = await callService<{
    accountId: number;
    status: string;
    perks: Array<{ perkId: string; kind: string; label: string; active: boolean }>;
  }>({ method: 'GET', path: `perks/${encodeURIComponent(String(accountId))}` });
  if (!data || !Array.isArray(data.perks)) return { accountId: null, status: 'none', perks: [] };
  const status =
    data.status === 'active' ||
    data.status === 'past_due' ||
    data.status === 'cancelled' ||
    data.status === 'expired'
      ? (data.status as SubStatus)
      : 'none';
  const perks = data.perks
    .filter((p) => p && typeof p.perkId === 'string' && p.kind === 'cosmetic')
    .map((p) => ({
      perkId: p.perkId,
      kind: 'cosmetic' as const,
      label: typeof p.label === 'string' ? p.label : '',
      active: p.active === true,
    }));
  return { accountId: typeof data.accountId === 'number' ? data.accountId : null, status, perks };
}

// ---- stripe webhook (signature-forwarded, not internal-secret gated) -------
/**
 * Forward a raw Stripe-signed webhook body to the service, which verifies the
 * signature and activates/clears the subscription. The game NEVER verifies the
 * signature or holds the Stripe signing secret. Returns received:false when the
 * service is off or the signature did not verify.
 *
 * This does NOT use callService (which is internal-secret gated + JSON): the
 * webhook path on the service authenticates by the Stripe signature, so we send
 * the raw body and forward the stripe-signature header verbatim.
 */
export async function subscriptionStripeWebhook(
  rawBody: string,
  stripeSignature: string,
): Promise<{ received: boolean }> {
  const base = serviceUrl();
  if (base === '') return { received: false };
  try {
    const url = new URL('stripe/webhook', base.endsWith('/') ? base : `${base}/`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': stripeSignature },
      body: rawBody,
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    });
    if (!res.ok) return { received: false };
    const data = (await res.json()) as { received?: boolean };
    return { received: data?.received === true };
  } catch (err) {
    logFailure(err);
    return { received: false };
  }
}
