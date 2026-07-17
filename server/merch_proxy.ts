// Typed game-server client for the external merch surface of the economy service.
//
// The merch store sells PHYSICAL goods (Printful dropship) from the homepage. ALL
// money logic lives in the economy service (a separate repo): catalog + prices
// (USD and Claudium per variant), order records, Stripe intents, Solana quotes and
// on-chain verification, Claudium debits, and the Printful integration including
// every shipping address. The game NEVER computes any of it and stores NO merch
// rows and NO PII; this module is the game server's proxy to that service, a
// structural twin of server/claudium_proxy.ts.
//
// GRACEFUL DEGRADATION IS THE CONTRACT. If MERCH_STORE_ENABLED is not '1', or
// WOC_ECONOMY_SERVICE_URL / WOC_ECONOMY_INTERNAL_SECRET is unset, OR the service
// is unreachable / errors / times out, EVERY player-facing function here returns
// a typed "unavailable" result (enabled false, empty catalog, checkout refused)
// and NEVER throws up into request handling. The site must render with the store
// OFF. The one deliberate exception: the webhook relays key on the env pair
// alone, so flipping the kill switch off never drops a payment or fulfillment
// callback for an order placed while the store was on.

const SERVICE_TIMEOUT_MS = 5000;
const NATIVE_CONFIRM_TIMEOUT_MS = 60_000;

export type MerchRail = 'stripe' | 'sol' | 'claudium';

/** One sellable variant of a product (size/color). Both prices come from the service. */
export interface MerchVariant {
  variantId: string;
  label: string;
  usd: number;
  claudium: number;
  inStock: boolean;
}

export interface MerchProduct {
  productId: string;
  name: string;
  description: string;
  imageUrl: string | null;
  variants: MerchVariant[];
}

/** The catalog; enabled:false + empty when the store or the service is off. */
export interface MerchProductsResult {
  enabled: boolean;
  products: MerchProduct[];
}

export interface MerchCartItem {
  variantId: string;
  qty: number;
}

/**
 * The shipping address, forwarded to the service ONCE at checkout and never
 * stored or logged game-side (the service owns fulfillment PII).
 */
export interface MerchShipping {
  name: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

/** The stripe-rail intent leg (client uses clientSecret with Stripe.js). */
export interface MerchStripeIntent {
  clientSecret: string;
  publishableKey: string;
}

/** The sol-rail intent leg: the pre-built transfer the client wallet signs. */
export interface MerchNativeIntent {
  reference: string;
  amountBase: string;
  destination: string;
  mint: string | null;
  memo: string | null;
  quoteExpiryMs: number | null;
  transactionBase64: string;
}

export interface MerchCheckoutResult {
  ok: boolean;
  orderId: string | null;
  rail: MerchRail | null;
  totalUsd: number | null;
  totalClaudium: number | null;
  stripe: MerchStripeIntent | null;
  native: MerchNativeIntent | null;
  /** True only on the claudium rail, which settles synchronously in this call. */
  paid: boolean;
  /** The remaining Claudium balance after a synchronous claudium-rail settle. */
  balance: number | null;
  reason: string | null;
}

export interface MerchNativeConfirmResult {
  settled: boolean;
  orderId: string | null;
  reason: string | null;
}

/** A PII-light order reference: status + item names + tracking, nothing more. */
export interface MerchOrder {
  orderId: string;
  status: string;
  createdAtMs: number;
  totalLabel: string;
  items: { name: string; qty: number }[];
  trackingUrl: string | null;
}

export interface MerchOrdersResult {
  orders: MerchOrder[];
}

export interface MerchWebhookResult {
  received: boolean;
}

function serviceUrl(): string {
  return (process.env.WOC_ECONOMY_SERVICE_URL ?? '').trim();
}

function serviceSecret(): string {
  return process.env.WOC_ECONOMY_INTERNAL_SECRET ?? '';
}

/** The economy-service env pair alone (the same URL + secret the Claudium
 * surface uses; merch is another surface of the same internal service). The
 * webhook relays key on THIS, not the kill switch: flipping the store off must
 * never drop a payment/fulfillment callback for an order placed while it was on.
 */
function merchEnvConfigured(): boolean {
  return serviceUrl() !== '' && serviceSecret() !== '';
}

/**
 * The player-facing store surface (catalog, checkout, orders) is reachable only
 * when the explicit kill switch is on AND the env pair is set. Webhooks are
 * deliberately NOT behind the switch (see merchEnvConfigured).
 */
export function merchServiceConfigured(): boolean {
  return process.env.MERCH_STORE_ENABLED === '1' && merchEnvConfigured();
}

let loggedOnce = false;
function logFailure(err: unknown): void {
  // Dev-channel only; the request path never sees this. Log once so a persistently
  // down service does not flood the server log every request.
  if (loggedOnce) return;
  loggedOnce = true;
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[merch] economy service unavailable: ${message}`);
}

interface ServiceRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  timeoutMs?: number;
}

/**
 * The one fetch wrapper. Returns the parsed JSON on a 2xx, or null on any
 * failure (unconfigured, non-2xx, network error, timeout, bad JSON). It NEVER
 * throws: every caller maps a null into its own typed unavailable result.
 */
async function callService<T>(req: ServiceRequest): Promise<T | null> {
  if (!merchServiceConfigured()) return null;
  try {
    const base = serviceUrl();
    const url = new URL(req.path.replace(/^\//, ''), base.endsWith('/') ? base : `${base}/`);
    const headers: Record<string, string> = { 'x-woc-economy-secret': serviceSecret() };
    let body: string | undefined;
    if (req.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(req.body);
    }
    const res = await fetch(url, {
      method: req.method,
      headers,
      body,
      signal: AbortSignal.timeout(req.timeoutMs ?? SERVICE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${req.method} ${req.path} -> ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    logFailure(err);
    return null;
  }
}

/**
 * Relay a provider webhook raw to the service, which owns signature verification
 * (the service is not publicly reachable, so providers point at the game host).
 * Mirrors claudiumStripeWebhook: a service 400 (bad signature) passes through as
 * received:false rather than counting as an outage.
 */
async function relayWebhook(
  path: string,
  rawBody: Buffer,
  signatureHeader: string,
  headerName: string,
): Promise<MerchWebhookResult> {
  // Env-only gate: a flag-off rollback keeps in-flight payment callbacks alive.
  if (!merchEnvConfigured()) return { received: false };
  try {
    const base = serviceUrl();
    const url = new URL(path, base.endsWith('/') ? base : `${base}/`);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-woc-economy-secret': serviceSecret(),
        [headerName]: signatureHeader,
      },
      body: new Uint8Array(rawBody),
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    });
    if (!res.ok && res.status !== 400) throw new Error(`POST ${path} -> ${res.status}`);
    const data = (await res.json()) as { received?: unknown };
    return { received: data.received === true };
  } catch (err) {
    logFailure(err);
    return { received: false };
  }
}

export function merchStripeWebhook(
  rawBody: Buffer,
  signatureHeader: string,
): Promise<MerchWebhookResult> {
  return relayWebhook('merch/stripe/webhook', rawBody, signatureHeader, 'stripe-signature');
}

export function merchPrintfulWebhook(
  rawBody: Buffer,
  signatureHeader: string,
): Promise<MerchWebhookResult> {
  return relayWebhook('merch/printful/webhook', rawBody, signatureHeader, 'x-pf-webhook-signature');
}

// The catalog is account-independent, so one process-wide memo caps the public
// probe's upstream reads at TTL cadence no matter how many homepage loads hit
// it (the per-IP limiter in server/ratelimit.ts caps a single abuser; this caps
// the aggregate). 30s keeps service-side merchandising edits visible quickly.
export const MERCH_PRODUCTS_CACHE_TTL_MS = 30_000;
let productsCache: { result: MerchProductsResult; at: number } | null = null;

/** Reset the products memo. Test-only. */
export function resetMerchProductsCacheForTests(): void {
  productsCache = null;
}

/** GET merch/products (TTL-memoized). enabled:false + empty when the store is off. */
export async function merchProducts(): Promise<MerchProductsResult> {
  const now = Date.now();
  if (productsCache && now - productsCache.at < MERCH_PRODUCTS_CACHE_TTL_MS) {
    return productsCache.result;
  }
  const result = await fetchMerchProducts();
  productsCache = { result, at: now };
  return result;
}

async function fetchMerchProducts(): Promise<MerchProductsResult> {
  const data = await callService<{ enabled?: unknown; products?: unknown }>({
    method: 'GET',
    path: 'merch/products',
  });
  if (!data || data.enabled !== true || !Array.isArray(data.products)) {
    return { enabled: false, products: [] };
  }
  const products = (data.products as MerchProduct[]).filter(
    (p): p is MerchProduct =>
      typeof p?.productId === 'string' &&
      typeof p.name === 'string' &&
      Array.isArray(p.variants) &&
      p.variants.every(
        (v) =>
          typeof v?.variantId === 'string' &&
          typeof v.label === 'string' &&
          typeof v.usd === 'number' &&
          typeof v.claudium === 'number' &&
          typeof v.inStock === 'boolean',
      ),
  );
  return {
    enabled: true,
    products: products.map((p) => ({
      productId: p.productId,
      name: p.name,
      description: typeof p.description === 'string' ? p.description : '',
      imageUrl: typeof p.imageUrl === 'string' ? p.imageUrl : null,
      variants: p.variants,
    })),
  };
}

const OFF_CHECKOUT: MerchCheckoutResult = {
  ok: false,
  orderId: null,
  rail: null,
  totalUsd: null,
  totalClaudium: null,
  stripe: null,
  native: null,
  paid: false,
  balance: null,
  reason: 'unavailable',
};

/**
 * POST merch/checkout. ok:false with a reason when the store is off. ok:true
 * only when the service answered a coherent intent for the REQUESTED rail: no
 * refusal reason, positive totals, and a well-formed rail leg (stripe secretpair,
 * sol transaction, or a synchronous claudium settle). Anything else collapses to
 * the typed refusal so the client can never paint a half-real order (the same
 * strictness claudiumPurchase applies before its ok:true).
 */
export async function merchCheckout(input: {
  accountId: string;
  rail: MerchRail;
  items: MerchCartItem[];
  shipping: MerchShipping;
  email: string;
  idempotencyKey: string;
  payer?: string;
}): Promise<MerchCheckoutResult> {
  const data = await callService<{
    orderId?: string;
    rail?: MerchRail;
    totalUsd?: number;
    totalClaudium?: number;
    stripe?: MerchStripeIntent;
    native?: MerchNativeIntent;
    paid?: boolean;
    balance?: number;
    reason?: string;
  }>({ method: 'POST', path: 'merch/checkout', body: input });
  if (!data) return { ...OFF_CHECKOUT };
  const reason = typeof data.reason === 'string' && data.reason !== '' ? data.reason : null;
  const orderId = typeof data.orderId === 'string' && data.orderId !== '' ? data.orderId : null;
  const rail =
    data.rail === 'stripe' || data.rail === 'sol' || data.rail === 'claudium' ? data.rail : null;
  const totalUsd =
    typeof data.totalUsd === 'number' && Number.isFinite(data.totalUsd) && data.totalUsd > 0
      ? data.totalUsd
      : null;
  const totalClaudium =
    typeof data.totalClaudium === 'number' &&
    Number.isInteger(data.totalClaudium) &&
    data.totalClaudium > 0
      ? data.totalClaudium
      : null;
  const stripe =
    typeof data.stripe?.clientSecret === 'string' &&
    data.stripe.clientSecret.trim() !== '' &&
    typeof data.stripe.publishableKey === 'string' &&
    data.stripe.publishableKey.trim() !== ''
      ? { clientSecret: data.stripe.clientSecret, publishableKey: data.stripe.publishableKey }
      : null;
  const native =
    typeof data.native?.reference === 'string' &&
    data.native.reference !== '' &&
    typeof data.native.transactionBase64 === 'string' &&
    data.native.transactionBase64 !== '' &&
    typeof data.native.amountBase === 'string' &&
    data.native.amountBase !== '' &&
    typeof data.native.destination === 'string' &&
    data.native.destination !== ''
      ? {
          reference: data.native.reference,
          amountBase: data.native.amountBase,
          destination: data.native.destination,
          mint: typeof data.native.mint === 'string' ? data.native.mint : null,
          memo: typeof data.native.memo === 'string' ? data.native.memo : null,
          quoteExpiryMs:
            typeof data.native.quoteExpiryMs === 'number' ? data.native.quoteExpiryMs : null,
          transactionBase64: data.native.transactionBase64,
        }
      : null;
  const balance =
    typeof data.balance === 'number' && Number.isFinite(data.balance) ? data.balance : null;
  const paid = data.paid === true;
  const legValid =
    input.rail === 'stripe'
      ? stripe !== null && !paid
      : input.rail === 'sol'
        ? native !== null && !paid
        : paid && balance !== null;
  const ok =
    reason === null &&
    orderId !== null &&
    rail === input.rail &&
    totalUsd !== null &&
    totalClaudium !== null &&
    legValid;
  if (!ok) {
    return { ...OFF_CHECKOUT, reason: reason ?? 'unavailable' };
  }
  return {
    ok: true,
    orderId,
    rail,
    totalUsd,
    totalClaudium,
    stripe: input.rail === 'stripe' ? stripe : null,
    native: input.rail === 'sol' ? native : null,
    paid,
    balance: input.rail === 'claudium' ? balance : null,
    reason: null,
  };
}

/** POST merch/checkout/native/confirm. settled:false when the store is off. */
export async function merchNativeConfirm(input: {
  reference: string;
  signature: string;
}): Promise<MerchNativeConfirmResult> {
  const data = await callService<{ settled?: boolean; orderId?: string; reason?: string }>({
    method: 'POST',
    path: 'merch/checkout/native/confirm',
    body: input,
    timeoutMs: NATIVE_CONFIRM_TIMEOUT_MS,
  });
  if (!data) return { settled: false, orderId: null, reason: 'unavailable' };
  return {
    settled: data.settled === true,
    orderId: typeof data.orderId === 'string' ? data.orderId : null,
    reason: data.reason ?? null,
  };
}

/** GET merch/orders/:accountId. Empty when the store is off. */
export async function merchOrders(accountId: string): Promise<MerchOrdersResult> {
  const data = await callService<{ orders?: unknown }>({
    method: 'GET',
    path: `merch/orders/${encodeURIComponent(accountId)}`,
  });
  if (!data || !Array.isArray(data.orders)) return { orders: [] };
  const orders = (data.orders as MerchOrder[]).filter(
    (o): o is MerchOrder =>
      typeof o?.orderId === 'string' &&
      typeof o.status === 'string' &&
      typeof o.createdAtMs === 'number' &&
      Array.isArray(o.items),
  );
  return {
    orders: orders.map((o) => ({
      orderId: o.orderId,
      status: o.status,
      createdAtMs: o.createdAtMs,
      totalLabel: typeof o.totalLabel === 'string' ? o.totalLabel : '',
      items: o.items.filter((i) => typeof i?.name === 'string' && typeof i.qty === 'number'),
      trackingUrl: typeof o.trackingUrl === 'string' ? o.trackingUrl : null,
    })),
  };
}
