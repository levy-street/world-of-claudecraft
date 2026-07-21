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

export interface ClaudiumPurchaseResult {
  ok: boolean;
  purchaseId: string | null;
  rail: ClaudiumRail | null;
  claudium: number | null;
  stripe: ClaudiumStripeIntent | null;
  woc: ClaudiumWocIntent | null;
  reason: string | null;
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

/**
 * Economy-wide supply. Every figure is a live aggregate of the service ledger,
 * never a sampled snapshot. All null when the service is off, so the window
 * renders its empty state rather than a fabricated zero (a real zero total and
 * an unreachable service must not look alike).
 */
export interface ClaudiumSupplyResult {
  circulating: number | null;
  issued: number | null;
  sunk: number | null;
  holders: number | null;
  usdPerClaudium: number | null;
  atMs: number | null;
}

/** One point on the supply curve. */
export interface ClaudiumSupplyPoint {
  atMs: number;
  circulating: number;
}

/** The supply curve over a window. Empty points when the service is off. */
export interface ClaudiumSupplyHistoryResult {
  points: ClaudiumSupplyPoint[];
  bucketMs: number | null;
  sinceMs: number | null;
  untilMs: number | null;
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

/** Read a finite number off an untrusted service payload, else null. */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * GET supply. Economy-wide, so it takes no accountId: the caller is still
 * authenticated (the route sits behind activeGuard), but the figure is the same
 * for everyone. All-null when the service is off.
 */
export async function claudiumSupply(): Promise<ClaudiumSupplyResult> {
  const data = await callService<{
    circulating: number;
    issued: number;
    sunk: number;
    holders: number;
    usdPerClaudium: number;
    atMs: number;
  }>({ method: 'GET', path: 'supply' });
  return {
    circulating: num(data?.circulating),
    issued: num(data?.issued),
    sunk: num(data?.sunk),
    holders: num(data?.holders),
    usdPerClaudium: num(data?.usdPerClaudium),
    atMs: num(data?.atMs),
  };
}

/**
 * GET supply/history over a window. Points are dropped unless both fields are
 * finite numbers, so a malformed payload yields an empty chart rather than NaN
 * coordinates that would blank the canvas.
 */
export async function claudiumSupplyHistory(args: {
  sinceMs: number;
  untilMs: number;
  bucketMs: number;
}): Promise<ClaudiumSupplyHistoryResult> {
  const query = new URLSearchParams({
    sinceMs: String(Math.trunc(args.sinceMs)),
    untilMs: String(Math.trunc(args.untilMs)),
    bucketMs: String(Math.trunc(args.bucketMs)),
  });
  const data = await callService<{
    points: Array<{ atMs: unknown; circulating: unknown }>;
    bucketMs: number;
    sinceMs: number;
    untilMs: number;
  }>({ method: 'GET', path: `supply/history?${query.toString()}` });
  const raw = Array.isArray(data?.points) ? data.points : [];
  const points: ClaudiumSupplyPoint[] = [];
  for (const p of raw) {
    const atMs = num(p?.atMs);
    const circulating = num(p?.circulating);
    if (atMs !== null && circulating !== null) points.push({ atMs, circulating });
  }
  return {
    points,
    bucketMs: num(data?.bucketMs),
    sinceMs: num(data?.sinceMs),
    untilMs: num(data?.untilMs),
  };
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

/**
 * The three native settlement rails the economy service now owns (Solana). Distinct
 * from the legacy 'stripe' card rail: the service quotes the crypto amount, the
 * player pays from their own wallet, and the service verifies + credits.
 */
export type ClaudiumNativeRail = 'sol' | 'usdc' | 'woc';

export function parseNativeRail(value: unknown): ClaudiumNativeRail | null {
  return value === 'sol' || value === 'usdc' || value === 'woc' ? value : null;
}

/** The fulfillment leg of a native quote: credit the balance, or mint a gift card. */
export type ClaudiumFulfillment =
  | { kind: 'credit'; accountId: string }
  | { kind: 'giftcard'; recipientEmail?: string; message?: string; deliverAtMs?: number };

/**
 * The WOC split line the service returns (both base-unit strings + the treasury
 * address). Present only on the woc rail; the game renders it verbatim, never
 * recomputes it.
 */
export interface ClaudiumNativeSplit {
  burnBase: string;
  treasuryBase: string;
  treasury: string;
}

/**
 * The discount block the service returns on every native quote. "X% off the effective
 * peg price": the buyer pays the full amount and receives MORE Claudium
 * (claudiumCredited >= baseClaudium). Every value is service-computed; the game renders
 * it verbatim and derives nothing. floorBps is the always-on $WOC floor (1500 for the
 * woc rail, else 0); promoBps is the admin/limited-time part.
 */
export interface ClaudiumNativeDiscount {
  rail: ClaudiumNativeRail;
  baseClaudium: number;
  discountBps: number;
  claudiumCredited: number;
  bonusClaudium: number;
  breakdown: { floorBps: number; promoBps: number };
  effectiveCentsPer100: number;
}

/**
 * A native-rail quote: the exact crypto amount to send (amountBase, a base-unit
 * string at the rail's decimals), the destination address, the memo/reference the
 * service verifies against, and the quote expiry. reason is set (and the quote is
 * unusable) when the oracle is down or the rail is disabled; the game renders a
 * clean disabled state. Every field is service-authoritative; the game computes none.
 */
export interface ClaudiumNativeQuoteResult {
  reference: string | null;
  rail: ClaudiumNativeRail | null;
  claudium: number | null;
  amountBase: string | null;
  destination: string | null;
  mint: string | null;
  memo: string | null;
  quoteExpiryMs: number | null;
  split: ClaudiumNativeSplit | null;
  discount: ClaudiumNativeDiscount | null;
  reason: string | null;
}

/**
 * The native confirm result: the service re-derives settlement from the on-chain
 * signature. settled is false (with a reason) when the service is off or the tx
 * did not verify; fulfillment carries the new balance (credit) or the gift-card
 * code (giftcard) when it did.
 */
export interface ClaudiumNativeConfirmResult {
  settled: boolean;
  reason: string | null;
  observedAmountBase: string | null;
  fulfillment: { balance: number | null; giftCardCode: string | null } | null;
}

/** The gift-card redeem result: credited amount + resulting balance, or a reason. */
export interface ClaudiumGiftCardRedeemResult {
  credited: boolean;
  balance: number | null;
  denominationClaudium: number | null;
  reason: string | null;
}

/** The gift-card status lookup result (no account context). */
export interface ClaudiumGiftCardStatusResult {
  status: 'ACTIVE' | 'REDEEMED' | 'EXPIRED' | 'VOID' | 'not_found';
  denominationClaudium: number | null;
}

/** POST native/quote. Quote null (reason 'unavailable') when the service is off. */
export async function claudiumNativeQuote(input: {
  rail: ClaudiumNativeRail;
  claudium: number;
  fulfillment: ClaudiumFulfillment;
}): Promise<ClaudiumNativeQuoteResult> {
  const data = await callService<{
    reference: string;
    rail: ClaudiumNativeRail;
    claudium: number;
    amountBase: string;
    destination: string;
    mint?: string | null;
    memo: string;
    quoteExpiryMs: number;
    split?: ClaudiumNativeSplit;
    discount?: ClaudiumNativeDiscount;
    reason?: string;
  }>({ method: 'POST', path: 'native/quote', body: input });
  if (!data) {
    return {
      reference: null,
      rail: null,
      claudium: null,
      amountBase: null,
      destination: null,
      mint: null,
      memo: null,
      quoteExpiryMs: null,
      split: null,
      discount: null,
      reason: 'unavailable',
    };
  }
  return {
    reference: typeof data.reference === 'string' ? data.reference : null,
    rail: parseNativeRail(data.rail),
    claudium: typeof data.claudium === 'number' ? data.claudium : null,
    amountBase: typeof data.amountBase === 'string' ? data.amountBase : null,
    destination: typeof data.destination === 'string' ? data.destination : null,
    mint: typeof data.mint === 'string' ? data.mint : null,
    memo: typeof data.memo === 'string' ? data.memo : null,
    quoteExpiryMs: typeof data.quoteExpiryMs === 'number' ? data.quoteExpiryMs : null,
    split:
      data.split &&
      typeof data.split.burnBase === 'string' &&
      typeof data.split.treasuryBase === 'string' &&
      typeof data.split.treasury === 'string'
        ? {
            burnBase: data.split.burnBase,
            treasuryBase: data.split.treasuryBase,
            treasury: data.split.treasury,
          }
        : null,
    discount: parseNativeDiscount(data.discount),
    reason: typeof data.reason === 'string' ? data.reason : null,
  };
}

/**
 * Validate + carry through the service discount block. Every value is
 * service-authoritative; this only shape-checks it (a malformed block drops to null so
 * the game shows no discount row) and NEVER computes a discount.
 */
function parseNativeDiscount(value: unknown): ClaudiumNativeDiscount | null {
  if (!value || typeof value !== 'object') return null;
  const d = value as Record<string, unknown>;
  const rail = parseNativeRail(d.rail);
  const breakdown = d.breakdown as Record<string, unknown> | undefined;
  if (
    !rail ||
    typeof d.baseClaudium !== 'number' ||
    typeof d.discountBps !== 'number' ||
    typeof d.claudiumCredited !== 'number' ||
    typeof d.bonusClaudium !== 'number' ||
    typeof d.effectiveCentsPer100 !== 'number' ||
    !breakdown ||
    typeof breakdown.floorBps !== 'number' ||
    typeof breakdown.promoBps !== 'number'
  ) {
    return null;
  }
  return {
    rail,
    baseClaudium: d.baseClaudium,
    discountBps: d.discountBps,
    claudiumCredited: d.claudiumCredited,
    bonusClaudium: d.bonusClaudium,
    breakdown: { floorBps: breakdown.floorBps, promoBps: breakdown.promoBps },
    effectiveCentsPer100: d.effectiveCentsPer100,
  };
}

/** POST native/confirm. settled:false (reason 'unavailable') when the service is off. */
export async function claudiumNativeConfirm(input: {
  reference: string;
  signature: string;
}): Promise<ClaudiumNativeConfirmResult> {
  const data = await callService<{
    settled: boolean;
    reason?: string;
    observedAmountBase?: string;
    fulfillment?: { balance?: number; giftCardCode?: string };
  }>({ method: 'POST', path: 'native/confirm', body: input });
  if (!data) {
    return { settled: false, reason: 'unavailable', observedAmountBase: null, fulfillment: null };
  }
  const f = data.fulfillment;
  return {
    settled: Boolean(data.settled),
    reason: typeof data.reason === 'string' ? data.reason : null,
    observedAmountBase:
      typeof data.observedAmountBase === 'string' ? data.observedAmountBase : null,
    fulfillment: f
      ? {
          balance: typeof f.balance === 'number' ? f.balance : null,
          giftCardCode: typeof f.giftCardCode === 'string' ? f.giftCardCode : null,
        }
      : null,
  };
}

/** POST giftcard/redeem. credited:false (reason 'unavailable') when the service is off. */
export async function claudiumGiftCardRedeem(input: {
  code: string;
  accountId: string;
}): Promise<ClaudiumGiftCardRedeemResult> {
  const data = await callService<{
    credited: boolean;
    balance: number;
    denominationClaudium?: number;
    reason?: string;
  }>({ method: 'POST', path: 'giftcard/redeem', body: input });
  if (!data) {
    return { credited: false, balance: null, denominationClaudium: null, reason: 'unavailable' };
  }
  return {
    credited: Boolean(data.credited),
    balance: typeof data.balance === 'number' ? data.balance : null,
    denominationClaudium:
      typeof data.denominationClaudium === 'number' ? data.denominationClaudium : null,
    reason: typeof data.reason === 'string' ? data.reason : null,
  };
}

/** GET giftcard/status?code=... status 'not_found' when the service is off or unknown. */
export async function claudiumGiftCardStatus(code: string): Promise<ClaudiumGiftCardStatusResult> {
  const data = await callService<{
    status: string;
    denominationClaudium?: number;
  }>({ method: 'GET', path: `giftcard/status?code=${encodeURIComponent(code)}` });
  const status =
    data?.status === 'ACTIVE' ||
    data?.status === 'REDEEMED' ||
    data?.status === 'EXPIRED' ||
    data?.status === 'VOID'
      ? data.status
      : 'not_found';
  return {
    status,
    denominationClaudium:
      typeof data?.denominationClaudium === 'number' ? data.denominationClaudium : null,
  };
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
