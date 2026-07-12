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
const NATIVE_CONFIRM_TIMEOUT_MS = 60_000;

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
  wocBaseUnitsPerClaudium: string | null;
}

export interface ClaudiumNativePriceResult {
  rail: ClaudiumNativeRail;
  claudium: number;
  amountBase: string | null;
  reason?: string;
}

export interface ClaudiumSolBalanceResult {
  owner: string;
  lamports: string | null;
}

/** One rung of the $1..$10000 SKU ladder. usd/claudium both come from the service. */
export interface ClaudiumSku {
  sku: string;
  usd: number;
  claudium: number;
  stripeConfigured?: boolean;
}

/** The SKU ladder, empty when the service is off. */
export interface ClaudiumSkusResult {
  skus: ClaudiumSku[];
}

export type ClaudiumRail = 'stripe' | 'sol' | 'woc';
export type ClaudiumNativeRail = 'sol' | 'woc';

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

export interface ClaudiumNativeRailsResult {
  rails: Record<ClaudiumNativeRail, boolean>;
}

export interface ClaudiumNativeQuoteResult {
  ok: boolean;
  reference: string | null;
  rail: ClaudiumNativeRail | null;
  claudium: number | null;
  amountBase: string | null;
  destination: string | null;
  mint: string | null;
  memo: string | null;
  quoteExpiryMs: number | null;
  transactionBase64: string | null;
  split: { burnBase: string; treasuryBase: string; treasury: string } | null;
  reason: string | null;
}

export interface ClaudiumNativeConfirmResult {
  settled: boolean;
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
  owned: boolean;
}

/** The cosmetic store catalog, empty when the service is off. */
export interface ClaudiumStoreResult {
  available: boolean;
  items: ClaudiumStoreItem[];
}

export interface ClaudiumStripeWebhookResult {
  received: boolean;
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
  timeoutMs?: number;
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
      signal: AbortSignal.timeout(req.timeoutMs ?? SERVICE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${req.method} ${req.path} -> ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    logFailure(err);
    return null;
  }
}

export async function claudiumStripeWebhook(
  rawBody: Buffer,
  signatureHeader: string,
): Promise<ClaudiumStripeWebhookResult> {
  const base = serviceUrl();
  if (base === '') return { received: false };
  try {
    const url = new URL('stripe/webhook', base.endsWith('/') ? base : `${base}/`);
    const body = new Uint8Array(rawBody);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': signatureHeader,
      },
      body,
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    });
    if (!res.ok && res.status !== 400) throw new Error(`POST stripe/webhook -> ${res.status}`);
    const data = (await res.json()) as { received?: unknown };
    return { received: data.received === true };
  } catch (err) {
    logFailure(err);
    return { received: false };
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
    wocBaseUnitsPerClaudium: string | number | null;
  }>({ method: 'GET', path: `price/${encodeURIComponent(rail)}` });
  if (!data) return { rail, usdPerClaudium: null, wocBaseUnitsPerClaudium: null };
  const wocBaseUnits = data.wocBaseUnitsPerClaudium;
  return {
    rail: data.rail,
    usdPerClaudium: typeof data.usdPerClaudium === 'number' ? data.usdPerClaudium : null,
    wocBaseUnitsPerClaudium:
      typeof wocBaseUnits === 'string'
        ? wocBaseUnits
        : typeof wocBaseUnits === 'number'
          ? String(wocBaseUnits)
          : null,
  };
}

export async function claudiumNativePrice(
  rail: ClaudiumNativeRail,
  claudium: number,
): Promise<ClaudiumNativePriceResult> {
  const data = await callService<{
    rail?: ClaudiumNativeRail;
    claudium?: number;
    amountBase?: string | null;
    reason?: string;
  }>({
    method: 'GET',
    path: `native/price/${encodeURIComponent(rail)}?claudium=${encodeURIComponent(String(claudium))}`,
  });
  return {
    rail: data?.rail ?? rail,
    claudium: typeof data?.claudium === 'number' ? data.claudium : claudium,
    amountBase: typeof data?.amountBase === 'string' ? data.amountBase : null,
    reason: data?.reason ?? (data ? undefined : 'unavailable'),
  };
}

export async function claudiumSolBalance(owner: string): Promise<ClaudiumSolBalanceResult> {
  const data = await callService<{ owner?: string; lamports?: string | null }>({
    method: 'GET',
    path: `native/balance/sol/${encodeURIComponent(owner)}`,
  });
  return {
    owner: data?.owner ?? owner,
    lamports: typeof data?.lamports === 'string' ? data.lamports : null,
  };
}

export async function claudiumNativeRails(): Promise<ClaudiumNativeRailsResult> {
  const data = await callService<{ rails?: Partial<Record<ClaudiumNativeRail, boolean>> }>({
    method: 'GET',
    path: 'native/rails',
  });
  return { rails: { sol: data?.rails?.sol === true, woc: data?.rails?.woc === true } };
}

/** GET skus. Empty ladder when the service is off (stripe rail disabled). */
export async function claudiumSkus(): Promise<ClaudiumSkusResult> {
  const data = await callService<ClaudiumSku[]>({ method: 'GET', path: 'skus' });
  if (!Array.isArray(data)) return { skus: [] };
  const skus = data
    .filter(
      (s): s is ClaudiumSku =>
        typeof s?.sku === 'string' && typeof s.usd === 'number' && typeof s.claudium === 'number',
    )
    .map((s) => ({
      sku: s.sku,
      usd: s.usd,
      claudium: s.claudium,
      stripeConfigured:
        typeof (s as { stripeConfigured?: unknown }).stripeConfigured === 'boolean'
          ? (s as { stripeConfigured: boolean }).stripeConfigured
          : undefined,
    }));
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

export async function claudiumNativeQuote(input: {
  accountId: string;
  rail: ClaudiumNativeRail;
  sku: string;
  payer: string;
}): Promise<ClaudiumNativeQuoteResult> {
  const skus = await claudiumSkus();
  const sku = skus.skus.find((row) => row.sku === input.sku);
  if (!sku) {
    return {
      ok: false,
      reference: null,
      rail: null,
      claudium: null,
      amountBase: null,
      destination: null,
      mint: null,
      memo: null,
      quoteExpiryMs: null,
      transactionBase64: null,
      split: null,
      reason: 'unknown_sku',
    };
  }
  const data = await callService<{
    reference?: string;
    rail?: ClaudiumNativeRail;
    claudium?: number;
    amountBase?: string;
    destination?: string;
    mint?: string | null;
    memo?: string;
    quoteExpiryMs?: number;
    transactionBase64?: string;
    split?: { burnBase: string; treasuryBase: string; treasury: string };
    reason?: string;
  }>({
    method: 'POST',
    path: 'native/quote',
    body: {
      rail: input.rail,
      claudium: sku.claudium,
      payer: input.payer,
      fulfillment: { kind: 'credit', accountId: Number(input.accountId) },
    },
  });
  if (!data?.reference || !data.transactionBase64) {
    return {
      ok: false,
      reference: data?.reference ?? null,
      rail: data?.rail ?? null,
      claudium: typeof data?.claudium === 'number' ? data.claudium : null,
      amountBase: data?.amountBase ?? null,
      destination: data?.destination ?? null,
      mint: data?.mint ?? null,
      memo: data?.memo ?? null,
      quoteExpiryMs: typeof data?.quoteExpiryMs === 'number' ? data.quoteExpiryMs : null,
      transactionBase64: data?.transactionBase64 ?? null,
      split: data?.split ?? null,
      reason: data?.reason ?? 'unavailable',
    };
  }
  return {
    ok: true,
    reference: data.reference,
    rail: data.rail ?? input.rail,
    claudium: typeof data.claudium === 'number' ? data.claudium : sku.claudium,
    amountBase: data.amountBase ?? null,
    destination: data.destination ?? null,
    mint: data.mint ?? null,
    memo: data.memo ?? null,
    quoteExpiryMs: typeof data.quoteExpiryMs === 'number' ? data.quoteExpiryMs : null,
    transactionBase64: data.transactionBase64,
    split: data.split ?? null,
    reason: data.reason ?? null,
  };
}

export async function claudiumNativeConfirm(input: {
  reference: string;
  signature: string;
}): Promise<ClaudiumNativeConfirmResult> {
  const data = await callService<{
    settled: boolean;
    reason?: string;
    fulfillment?: { balance?: number };
  }>({
    method: 'POST',
    path: 'native/confirm',
    body: input,
    timeoutMs: NATIVE_CONFIRM_TIMEOUT_MS,
  });
  if (!data) return { settled: false, balance: null, reason: 'unavailable' };
  return {
    settled: Boolean(data.settled),
    balance: typeof data.fulfillment?.balance === 'number' ? data.fulfillment.balance : null,
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
export async function claudiumStore(accountId: string): Promise<ClaudiumStoreResult> {
  const data = await callService<ClaudiumStoreItem[]>({
    method: 'GET',
    path: `store/${encodeURIComponent(accountId)}`,
  });
  if (!Array.isArray(data)) return { available: false, items: [] };
  const items = data.filter(
    (i): i is ClaudiumStoreItem =>
      typeof i?.itemId === 'string' &&
      typeof i.name === 'string' &&
      typeof i.costClaudium === 'number' &&
      typeof i.owned === 'boolean' &&
      (i.kind === 'cosmetic' || i.kind === 'skin' || i.kind === 'item'),
  );
  return { available: true, items };
}
