// Client-side typed fetch wrapper for the CLAUDIUM economy surface.
//
// Same-origin only: it talks to the GAME server's /api/claudium/* routes (never
// the economy service directly). Those routes proxy to the service and already
// fail closed, so this layer only has to survive a network hiccup or a logged-out
// caller. It NEVER throws into render: every failure resolves to the same typed
// unavailable state the disabled UI renders (balance null, empty skus/store, buy
// disabled). The client computes NO peg/price/balance; it renders what it gets.

import { apiUrl } from './online';

export type ClaudiumRail = 'stripe' | 'sol' | 'woc';
export type ClaudiumPriceRail = 'stripe' | 'woc';
export type ClaudiumNativeRail = 'sol' | 'woc';

export interface ClaudiumBalance {
  available?: boolean;
  balance: number | null;
}

export interface ClaudiumPrice {
  rail: string;
  usdPerClaudium: number | null;
  wocBaseUnitsPerClaudium: string | null;
}

export interface ClaudiumSku {
  sku: string;
  usd: number;
  claudium: number;
  stripeConfigured?: boolean;
}

export interface ClaudiumStoreItem {
  itemId: string;
  name: string;
  kind: 'cosmetic' | 'skin' | 'item';
  costClaudium: number;
  owned: boolean;
}

export interface ClaudiumStoreSnapshot {
  available: boolean;
  balance: number | null;
  items: ClaudiumStoreItem[];
}

export interface ClaudiumPackSnapshot {
  available: boolean;
  balance: number | null;
  skus: ClaudiumSku[];
  nativeRails: Record<ClaudiumNativeRail, boolean>;
}

export interface ClaudiumStripeIntent {
  clientSecret: string;
  publishableKey: string;
}

export interface ClaudiumWocIntent {
  amountBase: string;
  burnBase: string;
  treasuryBase: string;
  treasury: string;
  memo: string;
  expiresAtMs: number;
}

export interface ClaudiumPurchase {
  ok: boolean;
  purchaseId: string | null;
  rail: ClaudiumRail | null;
  claudium: number | null;
  stripe: ClaudiumStripeIntent | null;
  woc: ClaudiumWocIntent | null;
  reason: string | null;
}

export interface ClaudiumNativeRails {
  available?: boolean;
  rails: Record<ClaudiumNativeRail, boolean>;
}

export interface ClaudiumNativePrice {
  rail: ClaudiumNativeRail;
  claudium: number | null;
  amountBase: string | null;
  reason?: string;
}

export interface ClaudiumSolBalance {
  owner: string;
  lamports: string | null;
}

export interface ClaudiumNativeQuote {
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
  reason: string | null;
}

export interface ClaudiumNativeConfirm {
  settled: boolean;
  balance: number | null;
  reason: string | null;
}

export interface ClaudiumSpend {
  granted: boolean;
  balance: number | null;
  costClaudium: number | null;
  reason: string | null;
}

/** How the SDK reaches the authed game-server routes: a live token + realm base. */
export interface EconomyClientConfig {
  token(): string | null | undefined;
  base?: string;
}

const OFF_BALANCE: ClaudiumBalance = { available: false, balance: null };
const OFF_PRICE = (rail: string): ClaudiumPrice => ({
  rail,
  usdPerClaudium: null,
  wocBaseUnitsPerClaudium: null,
});
const OFF_SKUS: ClaudiumSku[] = [];
const OFF_STORE: ClaudiumStoreItem[] = [];
const OFF_NATIVE_RAILS: ClaudiumNativeRails = {
  available: false,
  rails: { sol: false, woc: false },
};
const OFF_PURCHASE: ClaudiumPurchase = {
  ok: false,
  purchaseId: null,
  rail: null,
  claudium: null,
  stripe: null,
  woc: null,
  reason: 'unavailable',
};
const OFF_NATIVE_QUOTE: ClaudiumNativeQuote = {
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
  reason: 'unavailable',
};
const OFF_NATIVE_CONFIRM: ClaudiumNativeConfirm = {
  settled: false,
  balance: null,
  reason: 'unavailable',
};
const OFF_SPEND: ClaudiumSpend = {
  granted: false,
  balance: null,
  costClaudium: null,
  reason: 'unavailable',
};

const NATIVE_CONFIRM_RETRY_REASONS = new Set([
  'not_found_onchain',
  'not_finalized',
  'cannot_verify',
  'unavailable',
  'processing',
  'post_verify_failed',
  'fulfillment_failed',
]);
const NATIVE_CONFIRM_RETRY_DELAYS_MS = [1000, 1500, 2500, 4000, 6000, 8000, 10_000];
const NATIVE_CONFIRM_MAX_RETRY_MS = 12 * 60_000;

export interface NativeConfirmRetryOptions {
  delayMs?(ms: number): Promise<void>;
  nowMs?(): number;
  maxElapsedMs?: number;
}

export class EconomyClient {
  constructor(private readonly cfg: EconomyClientConfig) {}

  private async getResult<T>(path: string, fallback: T): Promise<{ ok: boolean; value: T }> {
    const token = this.cfg.token();
    if (!token) return { ok: false, value: fallback };
    try {
      const res = await fetch(apiUrl(path, this.cfg.base ?? ''), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { ok: false, value: fallback };
      return { ok: true, value: (await res.json()) as T };
    } catch {
      return { ok: false, value: fallback };
    }
  }

  private async get<T>(path: string, fallback: T): Promise<T> {
    return (await this.getResult(path, fallback)).value;
  }

  private async post<T>(path: string, body: unknown, fallback: T): Promise<T> {
    const token = this.cfg.token();
    if (!token) return fallback;
    try {
      const res = await fetch(apiUrl(path, this.cfg.base ?? ''), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) return fallback;
      return (await res.json()) as T;
    } catch {
      return fallback;
    }
  }

  balance(): Promise<ClaudiumBalance> {
    return this.get('/api/claudium/balance', OFF_BALANCE);
  }

  price(rail: ClaudiumPriceRail): Promise<ClaudiumPrice> {
    return this.get(`/api/claudium/price/${rail}`, OFF_PRICE(rail));
  }

  skus(): Promise<ClaudiumSku[]> {
    return this.get('/api/claudium/skus', { skus: OFF_SKUS }).then((r) => r.skus ?? OFF_SKUS);
  }

  store(): Promise<ClaudiumStoreItem[]> {
    return this.get('/api/claudium/store', { items: OFF_STORE }).then((r) => r.items ?? OFF_STORE);
  }

  async storeSnapshot(): Promise<ClaudiumStoreSnapshot> {
    const [balance, store] = await Promise.all([
      this.getResult('/api/claudium/balance', OFF_BALANCE),
      this.getResult<{ available?: boolean; items: ClaudiumStoreItem[] }>('/api/claudium/store', {
        available: false,
        items: OFF_STORE,
      }),
    ]);
    return {
      available:
        balance.ok &&
        balance.value.available !== false &&
        store.ok &&
        store.value.available !== false,
      balance: balance.value.balance,
      items: store.value.items ?? OFF_STORE,
    };
  }

  async packSnapshot(): Promise<ClaudiumPackSnapshot> {
    const [balance, skus, nativeRails] = await Promise.all([
      this.getResult('/api/claudium/balance', OFF_BALANCE),
      this.getResult<{ available?: boolean; skus: ClaudiumSku[] }>('/api/claudium/skus', {
        available: false,
        skus: OFF_SKUS,
      }),
      this.getResult('/api/claudium/native/rails', OFF_NATIVE_RAILS),
    ]);
    return {
      available:
        balance.ok &&
        balance.value.available === true &&
        skus.ok &&
        skus.value.available === true &&
        nativeRails.ok &&
        nativeRails.value.available === true,
      balance: balance.value.balance,
      skus: skus.value.skus ?? OFF_SKUS,
      nativeRails: nativeRails.value.rails,
    };
  }

  nativeRails(): Promise<ClaudiumNativeRails> {
    return this.get('/api/claudium/native/rails', OFF_NATIVE_RAILS);
  }

  nativePrice(rail: ClaudiumNativeRail, sku: string): Promise<ClaudiumNativePrice> {
    return this.get(`/api/claudium/native/price/${rail}?sku=${encodeURIComponent(sku)}`, {
      rail,
      claudium: null,
      amountBase: null,
      reason: 'unavailable',
    });
  }

  solBalance(owner: string): Promise<ClaudiumSolBalance> {
    return this.get(`/api/claudium/native/balance/sol/${encodeURIComponent(owner)}`, {
      owner,
      lamports: null,
    });
  }

  purchase(input: {
    rail: 'stripe';
    sku: string;
    idempotencyKey: string;
  }): Promise<ClaudiumPurchase> {
    return this.post('/api/claudium/purchase', input, OFF_PURCHASE);
  }

  nativeQuote(input: {
    rail: ClaudiumNativeRail;
    sku: string;
    payer: string;
  }): Promise<ClaudiumNativeQuote> {
    return this.post('/api/claudium/native/quote', input, OFF_NATIVE_QUOTE);
  }

  nativeConfirm(input: { reference: string; signature: string }): Promise<ClaudiumNativeConfirm> {
    return this.post('/api/claudium/native/confirm', input, OFF_NATIVE_CONFIRM);
  }

  spend(input: {
    itemId: string;
    kind: 'cosmetic' | 'skin' | 'item';
    expectedCostClaudium: number;
    idempotencyKey: string;
  }): Promise<ClaudiumSpend> {
    return this.post('/api/claudium/spend', input, OFF_SPEND);
  }
}

/** A fresh idempotency key for a purchase/spend attempt (crypto-random, safe to retry). */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && 'randomUUID' in c) return c.randomUUID();
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shouldRetryNativeConfirm(result: ClaudiumNativeConfirm): boolean {
  return !result.settled && NATIVE_CONFIRM_RETRY_REASONS.has(result.reason ?? '');
}

export async function confirmNativeSettlement(
  client: Pick<EconomyClient, 'nativeConfirm'>,
  reference: string,
  signature: string,
  opts: NativeConfirmRetryOptions = {},
): Promise<ClaudiumNativeConfirm> {
  const wait = opts.delayMs ?? delayMs;
  const now = opts.nowMs ?? (() => Date.now());
  const maxElapsedMs = opts.maxElapsedMs ?? NATIVE_CONFIRM_MAX_RETRY_MS;
  const startedAt = now();
  let scheduledWaitMs = 0;
  let retryIndex = 0;
  let result = await client.nativeConfirm({ reference, signature });
  while (shouldRetryNativeConfirm(result)) {
    const wallElapsedMs = Math.max(0, now() - startedAt);
    const elapsedMs = Math.max(wallElapsedMs, scheduledWaitMs);
    if (elapsedMs >= maxElapsedMs) return result;
    const configuredDelay =
      NATIVE_CONFIRM_RETRY_DELAYS_MS[
        Math.min(retryIndex, NATIVE_CONFIRM_RETRY_DELAYS_MS.length - 1)
      ];
    const delay = Math.min(configuredDelay, maxElapsedMs - elapsedMs);
    if (delay <= 0) return result;
    retryIndex += 1;
    await wait(delay);
    scheduledWaitMs += delay;
    result = await client.nativeConfirm({ reference, signature });
  }
  return result;
}

/**
 * Optional client-side signers for the two purchase rails. main.ts passes these
 * once the live integrations exist; until then they are absent and the flow stops
 * cleanly after the server intent (no crash, nothing charged).
 *
 * - stripe: hand the returned clientSecret + publishableKey to Stripe.js and
 *   confirm the PaymentIntent client-side. Needs a live publishable key + Stripe.js.
 * - nativeSignAndSend: sign and send the service-built SOL or WOC transaction,
 *   returning its signature to post to nativeConfirm. Needs a live wallet.
 */
export interface ClaudiumSigners {
  stripe?(intent: ClaudiumStripeIntent, purchaseId: string): Promise<void>;
  nativeSignAndSend?(transactionBase64: string, rail: ClaudiumNativeRail): Promise<string>;
}

/**
 * Orchestrate one purchase end to end: ask the server for the rail-specific intent,
 * then drive the client-side signing seam. This computes NOTHING about price or
 * credit; it only sequences the SDK calls. If the service is off (ok:false) or the
 * needed signer is not wired, it returns without charging anything.
 */
export async function startClaudiumPurchase(
  client: EconomyClient,
  rail: ClaudiumRail,
  sku: string,
  signers: ClaudiumSigners = {},
): Promise<ClaudiumPurchase | ClaudiumNativeQuote | ClaudiumNativeConfirm> {
  if (rail === 'stripe') {
    const purchase = await client.purchase({ rail, sku, idempotencyKey: newIdempotencyKey() });
    if (!purchase.ok || !purchase.purchaseId) return purchase;
    // SEAM: the stripe confirmation needs Stripe.js + a live publishable key. When
    // a signer is wired, it confirms the PaymentIntent with the returned
    // clientSecret; otherwise the flow stops here with the server intent captured.
    if (purchase.stripe && signers.stripe) {
      await signers.stripe(purchase.stripe, purchase.purchaseId);
    }
    return purchase;
  }

  if (!signers.nativeSignAndSend) return OFF_NATIVE_QUOTE;
  const wallet = await import('./wallet');
  const payer = wallet.currentWallet().address;
  if (!payer) return OFF_NATIVE_QUOTE;
  const quote = await client.nativeQuote({ rail, sku, payer });
  if (!quote.ok || !quote.reference || !quote.transactionBase64) return quote;
  const signature = await signers.nativeSignAndSend(quote.transactionBase64, rail);
  // Once the wallet has broadcast a signature, confirmation is bounded by its
  // own recovery window rather than the quote's wall-clock expiry. The service
  // validates the transfer's on-chain block time, so a payment broadcast on time
  // remains eligible even if finality or downstream fulfillment lands later.
  return confirmNativeSettlement(client, quote.reference, signature);
}
