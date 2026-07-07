// Typed game-server client for the external CLAUDIUM economy service.
//
// CLAUDIUM is a server-authoritative soft currency: ALL peg/price/balance logic
// and verification live in the economy service (a separate repo). The game NEVER
// computes any of it; this module is the game server's proxy to that service. The
// browser hits the game server, the game server hits the service over a
// secret-gated internal API.
//
// GRACEFUL DEGRADATION IS THE CONTRACT. If WOC_ECONOMY_SERVICE_URL or
// WOC_ECONOMY_INTERNAL_SECRET is unset, OR the service is unreachable / errors /
// times out, EVERY function here returns a typed "unavailable" result (balance
// null, empty skus, buy disabled) and NEVER throws up into request handling. The
// game must boot and play with the service OFF.
//
// The functions mirror the service SDK v1 surface; they do NOT recompute any
// value, they only pass through what the service returns.

const SERVICE_TIMEOUT_MS = 5000;

/** Integer Claudium balance for an account, or null when the service is off. */
export interface ClaudiumBalanceResult {
  balance: number | null;
}

/**
 * Per-rail price. usdPerClaudium fixes the display peg (1 Claudium = 0.01 USD);
 * wocBaseUnitsPerClaudium is null when the WOC oracle is down (buy disabled on
 * the woc rail). Both fields null when the service is off.
 */
export interface ClaudiumPriceResult {
  rail: string;
  usdPerClaudium: number | null;
  wocBaseUnitsPerClaudium: number | null;
}

/** One rung of the $1..$10000 SKU ladder. usd/claudium both come from the service. */
export interface ClaudiumSku {
  sku: string;
  usd: number;
  claudium: number;
}

/** The SKU ladder, empty when the service is off. */
export interface ClaudiumSkusResult {
  skus: ClaudiumSku[];
}

export type ClaudiumRail = 'stripe' | 'woc';

/** The stripe-rail purchase-intent leg (client uses clientSecret with Stripe.js). */
export interface ClaudiumStripeIntent {
  clientSecret: string;
  publishableKey: string;
}

/**
 * The woc-rail purchase-intent leg: the split-transfer the client must build and
 * sign via the Wallet Standard path, then confirm by posting the signature.
 */
export interface ClaudiumWocIntent {
  amountBase: string;
  burnBase: string;
  treasuryBase: string;
  treasury: string;
  memo: string;
  expiresAtMs: number;
}

/**
 * The service-computed discount block on a purchase result. The game NEVER derives
 * any of it; this proxy only passes through what the service returned (or null when
 * the service omitted it). See the service SDK for the shape.
 */
export interface ClaudiumDiscount {
  rail: 'stripe' | 'woc' | 'sol' | 'usdc';
  baseClaudium: number;
  discountBps: number;
  claudiumCredited: number;
  bonusClaudium: number;
  breakdown: { floorBps: number; promoBps: number };
  effectiveCentsPer100: number;
}

export interface ClaudiumPurchaseResult {
  ok: boolean;
  purchaseId: string | null;
  rail: ClaudiumRail | null;
  claudium: number | null;
  stripe: ClaudiumStripeIntent | null;
  woc: ClaudiumWocIntent | null;
  reason: string | null;
  discount: ClaudiumDiscount | null;
}

export interface ClaudiumConfirmResult {
  credited: boolean;
  balance: number | null;
  reason: string | null;
}

export interface ClaudiumSpendResult {
  granted: boolean;
  balance: number | null;
  costClaudium: number | null;
  reason: string | null;
}

export interface ClaudiumHistoryEntry {
  id: string;
  kind: string;
  claudium: number;
  atMs: number;
}

export interface ClaudiumHistoryResult {
  entries: ClaudiumHistoryEntry[];
}

/** One cosmetic-store row: the item and its Claudium cost, both from the service. */
export interface ClaudiumStoreItem {
  itemId: string;
  name: string;
  kind: 'cosmetic' | 'skin' | 'item';
  costClaudium: number;
}

/** The cosmetic store catalog, empty when the service is off. */
export interface ClaudiumStoreResult {
  items: ClaudiumStoreItem[];
}

function serviceUrl(): string {
  return (process.env.WOC_ECONOMY_SERVICE_URL ?? '').trim();
}

function serviceSecret(): string {
  return process.env.WOC_ECONOMY_INTERNAL_SECRET ?? '';
}

/** The service is reachable only when BOTH the URL and the secret are set. */
export function claudiumServiceConfigured(): boolean {
  return serviceUrl() !== '' && serviceSecret() !== '';
}

let loggedOnce = false;
function logFailure(err: unknown): void {
  // Dev-channel only; the request path never sees this. Log once so a persistently
  // down service does not flood the server log every request.
  if (loggedOnce) return;
  loggedOnce = true;
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[claudium] economy service unavailable: ${message}`);
}

interface ServiceRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
}

/**
 * The one fetch wrapper. Returns the parsed JSON on a 2xx, or null on any
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

/** GET balance/:accountId. Balance null when the service is off. */
export async function claudiumBalance(accountId: string): Promise<ClaudiumBalanceResult> {
  const data = await callService<{ balance: number }>({
    method: 'GET',
    path: `balance/${encodeURIComponent(accountId)}`,
  });
  return { balance: typeof data?.balance === 'number' ? data.balance : null };
}

/** GET price/:rail. Prices null when the service is off (buy disabled). */
export async function claudiumPrice(rail: ClaudiumRail): Promise<ClaudiumPriceResult> {
  const data = await callService<{
    rail: string;
    usdPerClaudium: number;
    wocBaseUnitsPerClaudium: number | null;
  }>({ method: 'GET', path: `price/${encodeURIComponent(rail)}` });
  if (!data) return { rail, usdPerClaudium: null, wocBaseUnitsPerClaudium: null };
  return {
    rail: data.rail,
    usdPerClaudium: typeof data.usdPerClaudium === 'number' ? data.usdPerClaudium : null,
    wocBaseUnitsPerClaudium:
      typeof data.wocBaseUnitsPerClaudium === 'number' ? data.wocBaseUnitsPerClaudium : null,
  };
}

/** GET skus. Empty ladder when the service is off (stripe rail disabled). */
export async function claudiumSkus(): Promise<ClaudiumSkusResult> {
  const data = await callService<ClaudiumSku[]>({ method: 'GET', path: 'skus' });
  if (!Array.isArray(data)) return { skus: [] };
  const skus = data.filter(
    (s): s is ClaudiumSku =>
      typeof s?.sku === 'string' && typeof s.usd === 'number' && typeof s.claudium === 'number',
  );
  return { skus };
}

/**
 * Validate a discount block from the service, dropping it to null unless every
 * field is a finite number of the expected type (defensive: the service owns these,
 * the game only passes them through and never computes with them).
 */
function coerceDiscount(raw: unknown): ClaudiumDiscount | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Record<string, unknown>;
  const b = d.breakdown as Record<string, unknown> | undefined;
  const rail = d.rail;
  if (rail !== 'stripe' && rail !== 'woc' && rail !== 'sol' && rail !== 'usdc') return null;
  const nums = [
    d.baseClaudium,
    d.discountBps,
    d.claudiumCredited,
    d.bonusClaudium,
    d.effectiveCentsPer100,
    b?.floorBps,
    b?.promoBps,
  ];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return {
    rail,
    baseClaudium: d.baseClaudium as number,
    discountBps: d.discountBps as number,
    claudiumCredited: d.claudiumCredited as number,
    bonusClaudium: d.bonusClaudium as number,
    breakdown: { floorBps: b?.floorBps as number, promoBps: b?.promoBps as number },
    effectiveCentsPer100: d.effectiveCentsPer100 as number,
  };
}

/** POST purchase. Returns ok:false with a reason when the service is off. */
export async function claudiumPurchase(input: {
  accountId: string;
  rail: ClaudiumRail;
  sku: string;
  idempotencyKey: string;
}): Promise<ClaudiumPurchaseResult> {
  const data = await callService<{
    purchaseId: string;
    rail: ClaudiumRail;
    claudium: number;
    stripe?: ClaudiumStripeIntent;
    woc?: ClaudiumWocIntent;
    reason?: string;
    discount?: unknown;
  }>({ method: 'POST', path: 'purchase', body: input });
  if (!data) {
    return {
      ok: false,
      purchaseId: null,
      rail: null,
      claudium: null,
      stripe: null,
      woc: null,
      reason: 'unavailable',
      discount: null,
    };
  }
  return {
    ok: true,
    purchaseId: data.purchaseId,
    rail: data.rail,
    claudium: data.claudium,
    stripe: data.stripe ?? null,
    woc: data.woc ?? null,
    reason: data.reason ?? null,
    discount: coerceDiscount(data.discount),
  };
}

/** POST purchase/woc/confirm. credited:false when the service is off. */
export async function claudiumConfirmWoc(input: {
  purchaseId: string;
  inboundSignature: string;
}): Promise<ClaudiumConfirmResult> {
  const data = await callService<{ credited: boolean; balance: number; reason?: string }>({
    method: 'POST',
    path: 'purchase/woc/confirm',
    body: input,
  });
  if (!data) return { credited: false, balance: null, reason: 'unavailable' };
  return {
    credited: Boolean(data.credited),
    balance: typeof data.balance === 'number' ? data.balance : null,
    reason: data.reason ?? null,
  };
}

/** POST spend. granted:false when the service is off. */
export async function claudiumSpend(input: {
  accountId: string;
  itemId: string;
  kind: 'cosmetic' | 'skin' | 'item';
  idempotencyKey: string;
}): Promise<ClaudiumSpendResult> {
  const data = await callService<{
    granted: boolean;
    balance: number;
    costClaudium?: number;
    reason?: string;
  }>({ method: 'POST', path: 'spend', body: input });
  if (!data) return { granted: false, balance: null, costClaudium: null, reason: 'unavailable' };
  return {
    granted: Boolean(data.granted),
    balance: typeof data.balance === 'number' ? data.balance : null,
    costClaudium: typeof data.costClaudium === 'number' ? data.costClaudium : null,
    reason: data.reason ?? null,
  };
}

/** GET history/:accountId. Empty when the service is off. */
export async function claudiumHistory(accountId: string): Promise<ClaudiumHistoryResult> {
  const data = await callService<ClaudiumHistoryEntry[]>({
    method: 'GET',
    path: `history/${encodeURIComponent(accountId)}`,
  });
  if (!Array.isArray(data)) return { entries: [] };
  return { entries: data };
}

/** GET store. The cosmetic catalog, priced in Claudium by the service. Empty when off. */
export async function claudiumStore(): Promise<ClaudiumStoreResult> {
  const data = await callService<ClaudiumStoreItem[]>({ method: 'GET', path: 'store' });
  if (!Array.isArray(data)) return { items: [] };
  const items = data.filter(
    (i): i is ClaudiumStoreItem =>
      typeof i?.itemId === 'string' &&
      typeof i.name === 'string' &&
      typeof i.costClaudium === 'number' &&
      (i.kind === 'cosmetic' || i.kind === 'skin' || i.kind === 'item'),
  );
  return { items };
}
