// Client-side typed fetch wrapper for the CLAUDIUM economy surface.
//
// Same-origin only: it talks to the GAME server's /api/claudium/* routes (never
// the economy service directly). Those routes proxy to the service and already
// fail closed, so this layer only has to survive a network hiccup or a logged-out
// caller. It NEVER throws into render: every failure resolves to the same typed
// unavailable state the disabled UI renders (balance null, empty skus/store, buy
// disabled). The client computes NO peg/price/balance; it renders what it gets.

import { apiUrl } from './online';

export type ClaudiumRail = 'stripe' | 'woc';

export interface ClaudiumBalance {
  balance: number | null;
}

export interface ClaudiumPrice {
  rail: string;
  usdPerClaudium: number | null;
  wocBaseUnitsPerClaudium: number | null;
}

export interface ClaudiumSku {
  sku: string;
  usd: number;
  claudium: number;
}

export interface ClaudiumStoreItem {
  itemId: string;
  name: string;
  kind: 'cosmetic' | 'skin' | 'item';
  costClaudium: number;
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

/**
 * The service-computed discount block that now rides on a purchase result. Every
 * value is owned by the economy service; this client NEVER derives a percentage, a
 * bonus, or a credited amount, it only carries these through for display. "X% off
 * the effective peg price": the buyer pays the full amount and receives MORE
 * Claudium (claudiumCredited >= baseClaudium). floorBps is the always-on $WOC floor
 * (1500 for the woc rail, else 0); promoBps is the admin/limited-time part.
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

export interface ClaudiumPurchase {
  ok: boolean;
  purchaseId: string | null;
  rail: ClaudiumRail | null;
  claudium: number | null;
  stripe: ClaudiumStripeIntent | null;
  woc: ClaudiumWocIntent | null;
  reason: string | null;
  /** The service-computed discount, or null when the service omitted one. */
  discount: ClaudiumDiscount | null;
}

export interface ClaudiumConfirm {
  credited: boolean;
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

const OFF_BALANCE: ClaudiumBalance = { balance: null };
const OFF_PRICE = (rail: string): ClaudiumPrice => ({
  rail,
  usdPerClaudium: null,
  wocBaseUnitsPerClaudium: null,
});
const OFF_SKUS: ClaudiumSku[] = [];
const OFF_STORE: ClaudiumStoreItem[] = [];
const OFF_PURCHASE: ClaudiumPurchase = {
  ok: false,
  purchaseId: null,
  rail: null,
  claudium: null,
  stripe: null,
  woc: null,
  reason: 'unavailable',
  discount: null,
};
const OFF_CONFIRM: ClaudiumConfirm = { credited: false, balance: null, reason: 'unavailable' };
const OFF_SPEND: ClaudiumSpend = {
  granted: false,
  balance: null,
  costClaudium: null,
  reason: 'unavailable',
};

export class EconomyClient {
  constructor(private readonly cfg: EconomyClientConfig) {}

  private async get<T>(path: string, fallback: T): Promise<T> {
    const token = this.cfg.token();
    if (!token) return fallback;
    try {
      const res = await fetch(apiUrl(path, this.cfg.base ?? ''), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return fallback;
      return (await res.json()) as T;
    } catch {
      return fallback;
    }
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

  price(rail: ClaudiumRail): Promise<ClaudiumPrice> {
    return this.get(`/api/claudium/price/${rail}`, OFF_PRICE(rail));
  }

  skus(): Promise<ClaudiumSku[]> {
    return this.get('/api/claudium/skus', { skus: OFF_SKUS }).then((r) => r.skus ?? OFF_SKUS);
  }

  store(): Promise<ClaudiumStoreItem[]> {
    return this.get('/api/claudium/store', { items: OFF_STORE }).then((r) => r.items ?? OFF_STORE);
  }

  purchase(input: {
    rail: ClaudiumRail;
    sku: string;
    idempotencyKey: string;
  }): Promise<ClaudiumPurchase> {
    return this.post('/api/claudium/purchase', input, OFF_PURCHASE);
  }

  confirmWoc(input: { purchaseId: string; inboundSignature: string }): Promise<ClaudiumConfirm> {
    return this.post('/api/claudium/purchase/woc/confirm', input, OFF_CONFIRM);
  }

  spend(input: {
    itemId: string;
    kind: 'cosmetic' | 'skin' | 'item';
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

/**
 * Optional client-side signers for the two purchase rails. main.ts passes these
 * once the live integrations exist; until then they are absent and the flow stops
 * cleanly after the server intent (no crash, nothing charged).
 *
 * - stripe: hand the returned clientSecret + publishableKey to Stripe.js and
 *   confirm the PaymentIntent client-side. Needs a live publishable key + Stripe.js.
 * - wocSignAndSend: build + sign the split transfer described by the woc intent
 *   via the Wallet Standard path (the repo's signAndSend), returning the inbound
 *   signature to post to confirmWoc. Needs a live wallet + a built transaction.
 */
export interface ClaudiumSigners {
  stripe?(intent: ClaudiumStripeIntent, purchaseId: string): Promise<void>;
  wocSignAndSend?(intent: ClaudiumWocIntent, purchaseId: string): Promise<string>;
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
): Promise<ClaudiumPurchase | ClaudiumConfirm> {
  const purchase = await client.purchase({ rail, sku, idempotencyKey: newIdempotencyKey() });
  if (!purchase.ok || !purchase.purchaseId) return purchase;

  if (rail === 'stripe') {
    // SEAM: the stripe confirmation needs Stripe.js + a live publishable key. When
    // a signer is wired, it confirms the PaymentIntent with the returned
    // clientSecret; otherwise the flow stops here with the server intent captured.
    if (purchase.stripe && signers.stripe) {
      await signers.stripe(purchase.stripe, purchase.purchaseId);
    }
    return purchase;
  }

  // woc rail: sign the split transfer and post the signature to confirm.
  // SEAM: wocSignAndSend needs a live wallet + a built split transaction (the repo
  // Wallet Standard signAndSend path). Without it the flow stops after the intent.
  if (purchase.woc && signers.wocSignAndSend) {
    const inboundSignature = await signers.wocSignAndSend(purchase.woc, purchase.purchaseId);
    return client.confirmWoc({ purchaseId: purchase.purchaseId, inboundSignature });
  }
  return purchase;
}
