// Client-side typed fetch wrapper for the merch-store surface.
//
// Same-origin only: it talks to the GAME server's /api/merch/* routes (never the
// economy service directly), a structural twin of economy_sdk.ts. Those routes
// proxy to the service and already fail closed, so this layer only has to survive
// a network hiccup or a logged-out caller. It NEVER throws into render: every
// failure resolves to the same typed unavailable state the disabled UI renders
// (store off, empty catalog, checkout refused). The client computes NO
// price/total; it renders what it gets.

import {
  type ClaudiumNativeConfirm,
  confirmNativeSettlement,
  type NativeConfirmRetryOptions,
  newIdempotencyKey,
} from './economy_sdk';
import { apiUrl } from './online';

export type MerchRail = 'stripe' | 'sol' | 'claudium';

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

export interface MerchProducts {
  enabled: boolean;
  products: MerchProduct[];
}

export interface MerchCartItem {
  variantId: string;
  qty: number;
}

/** Forwarded to the service once at checkout; never persisted client- or game-side. */
export interface MerchShipping {
  name: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface MerchStripeIntent {
  clientSecret: string;
  publishableKey: string;
}

export interface MerchNativeIntent {
  reference: string;
  amountBase: string;
  destination: string;
  mint: string | null;
  memo: string | null;
  quoteExpiryMs: number | null;
  transactionBase64: string;
}

export interface MerchCheckout {
  ok: boolean;
  orderId: string | null;
  rail: MerchRail | null;
  totalUsd: number | null;
  totalClaudium: number | null;
  stripe: MerchStripeIntent | null;
  native: MerchNativeIntent | null;
  paid: boolean;
  balance: number | null;
  reason: string | null;
}

export interface MerchNativeConfirm {
  settled: boolean;
  orderId: string | null;
  reason: string | null;
}

export interface MerchOrder {
  orderId: string;
  status: string;
  createdAtMs: number;
  totalLabel: string;
  items: { name: string; qty: number }[];
  trackingUrl: string | null;
}

/** How the SDK reaches the game-server routes: a live token + realm base. */
export interface MerchClientConfig {
  token(): string | null | undefined;
  base?: string;
}

const OFF_PRODUCTS: MerchProducts = { enabled: false, products: [] };
const OFF_CHECKOUT: MerchCheckout = {
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
const OFF_NATIVE_CONFIRM: MerchNativeConfirm = {
  settled: false,
  orderId: null,
  reason: 'unavailable',
};
const OFF_ORDERS: MerchOrder[] = [];

export class MerchClient {
  constructor(private readonly cfg: MerchClientConfig) {}

  private async get<T>(path: string, fallback: T, opts: { auth?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.auth !== false) {
      const token = this.cfg.token();
      if (!token) return fallback;
      headers.Authorization = `Bearer ${token}`;
    }
    try {
      const res = await fetch(apiUrl(path, this.cfg.base ?? ''), { headers });
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

  /** The public catalog read: works logged-out (the Store-tab reveal probes it). */
  products(): Promise<MerchProducts> {
    return this.get('/api/merch/products', OFF_PRODUCTS, { auth: false });
  }

  checkout(input: {
    rail: MerchRail;
    items: MerchCartItem[];
    shipping: MerchShipping;
    email: string;
    idempotencyKey: string;
    payer?: string;
  }): Promise<MerchCheckout> {
    return this.post('/api/merch/checkout', input, OFF_CHECKOUT);
  }

  nativeConfirm(input: { reference: string; signature: string }): Promise<MerchNativeConfirm> {
    return this.post('/api/merch/checkout/native/confirm', input, OFF_NATIVE_CONFIRM);
  }

  orders(): Promise<MerchOrder[]> {
    return this.get('/api/merch/orders', { orders: OFF_ORDERS }).then(
      (r) => r.orders ?? OFF_ORDERS,
    );
  }
}

/**
 * Optional client-side signers for the two client-signed rails, mirroring
 * ClaudiumSigners. main.ts passes these once the live integrations are wired;
 * until then they are absent and the flow stops cleanly after the server intent
 * (no crash, nothing charged). The claudium rail needs no signer: it settles
 * synchronously inside the checkout call.
 */
export interface MerchSigners {
  stripe?(intent: MerchStripeIntent, orderId: string): Promise<void>;
  /** Overrides the payer address (the desktop-wallet handoff path); falls back
   * to the connected Wallet Standard wallet, exactly like ClaudiumSigners. */
  nativePayer?: string | null;
  /** The reference rides along so a desktop-wallet handoff can authorize the
   * exact payment (the ClaudiumSigners shape). */
  nativeSignAndSend?(transactionBase64: string, reference: string): Promise<string>;
}

export interface MerchCheckoutInput {
  rail: MerchRail;
  items: MerchCartItem[];
  shipping: MerchShipping;
  email: string;
}

export interface MerchCheckoutOutcome {
  checkout: MerchCheckout;
  /** The settlement result for the sol rail; null on the other rails. */
  settlement: MerchNativeConfirm | null;
}

/** The client surface the orchestrator needs (a Pick so tests can pass a fake). */
export type MerchCheckoutClient = Pick<MerchClient, 'checkout' | 'nativeConfirm'>;

/**
 * Orchestrate one merch checkout end to end: ask the server for the rail-specific
 * intent, then drive the client-side signing seam. This computes NOTHING about
 * price or totals; it only sequences the SDK calls. If the store is off
 * (ok:false) or the needed signer/wallet is not wired, it returns without
 * charging anything.
 */
export async function startMerchCheckout(
  client: MerchCheckoutClient,
  input: MerchCheckoutInput,
  signers: MerchSigners = {},
  retry: NativeConfirmRetryOptions = {},
): Promise<MerchCheckoutOutcome> {
  const idempotencyKey = newIdempotencyKey();

  if (input.rail === 'sol') {
    if (!signers.nativeSignAndSend) return { checkout: OFF_CHECKOUT, settlement: null };
    const payer = signers.nativePayer ?? (await import('./wallet')).currentWallet().address;
    if (!payer) return { checkout: OFF_CHECKOUT, settlement: null };
    const checkout = await client.checkout({ ...input, idempotencyKey, payer });
    if (!checkout.ok || !checkout.native) return { checkout, settlement: null };
    const signature = await signers.nativeSignAndSend(
      checkout.native.transactionBase64,
      checkout.native.reference,
    );
    // Reuse the claudium confirm retry ladder through a shape adapter: merch's
    // confirm carries orderId instead of balance, so the adapter maps between the
    // two typed results without re-deriving the retry policy. Once the wallet has
    // broadcast a signature, confirmation is bounded by the ladder's own recovery
    // window, never the quote's wall-clock expiry: the service validates the
    // transfer's on-chain block time, so a payment broadcast on time remains
    // eligible even if finality lands later (the claudium twin's exact policy).
    let last: MerchNativeConfirm = OFF_NATIVE_CONFIRM;
    const adapted = await confirmNativeSettlement(
      {
        nativeConfirm: async (req): Promise<ClaudiumNativeConfirm> => {
          last = await client.nativeConfirm(req);
          return { settled: last.settled, balance: null, reason: last.reason };
        },
      },
      checkout.native.reference,
      signature,
      retry,
    );
    return {
      checkout,
      settlement: { settled: adapted.settled, orderId: last.orderId, reason: adapted.reason },
    };
  }

  const checkout = await client.checkout({ ...input, idempotencyKey });
  if (input.rail === 'stripe' && checkout.ok && checkout.orderId && checkout.stripe) {
    // SEAM: the stripe confirmation needs Stripe.js + a live publishable key. When
    // a signer is wired it opens the embedded checkout with the returned
    // clientSecret; otherwise the flow stops here with the server intent captured.
    if (signers.stripe) await signers.stripe(checkout.stripe, checkout.orderId);
  }
  return { checkout, settlement: null };
}
