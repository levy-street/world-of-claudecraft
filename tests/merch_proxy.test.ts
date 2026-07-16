// Fail-closed coverage for server/merch_proxy.ts (the merch twin of
// claudium_proxy). The contract under test: with MERCH_STORE_ENABLED unset (or
// the economy-service env pair missing) every function resolves to its typed
// unavailable result WITHOUT touching fetch; with the env set but the service
// rejecting / timing out / answering non-2xx, the same typed results come back
// and nothing ever throws into the caller.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  merchCheckout,
  merchNativeConfirm,
  merchOrders,
  merchPrintfulWebhook,
  merchProducts,
  merchServiceConfigured,
  merchStripeWebhook,
  resetMerchProductsCacheForTests,
} from '../server/merch_proxy';

const ENV_KEYS = [
  'MERCH_STORE_ENABLED',
  'WOC_ECONOMY_SERVICE_URL',
  'WOC_ECONOMY_INTERNAL_SECRET',
] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

const SHIPPING = {
  name: 'Alice Example',
  address1: '1 Claudemoon Way',
  address2: '',
  city: 'Valeholm',
  state: '',
  zip: '00001',
  country: 'US',
};

function checkoutInput() {
  return {
    accountId: '7',
    rail: 'stripe' as const,
    items: [{ variantId: 'tee-black-m', qty: 1 }],
    shipping: SHIPPING,
    email: 'alice@example.com',
    idempotencyKey: 'idem-1',
  };
}

function configureService(): void {
  process.env.MERCH_STORE_ENABLED = '1';
  process.env.WOC_ECONOMY_SERVICE_URL = 'https://economy.test';
  process.env.WOC_ECONOMY_INTERNAL_SECRET = 'shh';
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  resetMerchProductsCacheForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = ORIGINAL_ENV[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('unconfigured (fail closed, no fetch)', () => {
  it('is unconfigured with all env unset, and with only the flag missing', () => {
    expect(merchServiceConfigured()).toBe(false);
    // The kill switch alone keeps the store off even with the service pair set.
    process.env.WOC_ECONOMY_SERVICE_URL = 'https://economy.test';
    process.env.WOC_ECONOMY_INTERNAL_SECRET = 'shh';
    expect(merchServiceConfigured()).toBe(false);
    process.env.MERCH_STORE_ENABLED = '1';
    expect(merchServiceConfigured()).toBe(true);
  });

  it('every function resolves to its typed unavailable result without fetching', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(await merchProducts()).toEqual({ enabled: false, products: [] });
    expect(await merchCheckout(checkoutInput())).toMatchObject({
      ok: false,
      orderId: null,
      paid: false,
      reason: 'unavailable',
    });
    expect(await merchNativeConfirm({ reference: 'r', signature: 's' })).toEqual({
      settled: false,
      orderId: null,
      reason: 'unavailable',
    });
    expect(await merchOrders('7')).toEqual({ orders: [] });
    expect(await merchStripeWebhook(Buffer.from('{}'), 'sig')).toEqual({ received: false });
    expect(await merchPrintfulWebhook(Buffer.from('{}'), 'sig')).toEqual({ received: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps relaying webhooks on a flag-off rollback (env pair set, store off)', async () => {
    // An order placed while the store was on still gets its payment/fulfillment
    // callbacks after MERCH_STORE_ENABLED flips off; only the player surface dies.
    process.env.WOC_ECONOMY_SERVICE_URL = 'https://economy.test';
    process.env.WOC_ECONOMY_INTERNAL_SECRET = 'shh';
    const fetchSpy = vi.fn(async (_url: URL, _init: RequestInit) =>
      jsonResponse({ received: true }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    expect(await merchStripeWebhook(Buffer.from('{"id":1}'), 'sig-a')).toEqual({
      received: true,
    });
    expect(await merchPrintfulWebhook(Buffer.from('{"id":2}'), 'sig-b')).toEqual({
      received: true,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // The player surface stays fail-closed in the same configuration.
    expect(await merchProducts()).toEqual({ enabled: false, products: [] });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('configured but the service is down (typed unavailable, never throws)', () => {
  beforeEach(() => {
    configureService();
  });

  it('maps a rejected fetch to the typed unavailable results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    expect(await merchProducts()).toEqual({ enabled: false, products: [] });
    expect((await merchCheckout(checkoutInput())).reason).toBe('unavailable');
    expect((await merchNativeConfirm({ reference: 'r', signature: 's' })).settled).toBe(false);
    expect(await merchOrders('7')).toEqual({ orders: [] });
    expect(await merchStripeWebhook(Buffer.from('{}'), 'sig')).toEqual({ received: false });
  });

  it('maps a non-2xx service answer to the typed unavailable results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'boom' }, 503)),
    );
    expect(await merchProducts()).toEqual({ enabled: false, products: [] });
    expect((await merchCheckout(checkoutInput())).ok).toBe(false);
  });
});

describe('configured and reachable (pass-through, no recomputation)', () => {
  beforeEach(() => {
    configureService();
  });

  it('GETs merch/products with the secret header and maps the catalog', async () => {
    const fetchSpy = vi.fn(async (_url: URL, _init: RequestInit) =>
      jsonResponse({
        enabled: true,
        products: [
          {
            productId: 'tee',
            name: 'Claudemoon Tee',
            description: 'Soft.',
            imageUrl: 'https://cdn.test/tee.png',
            variants: [
              { variantId: 'tee-m', label: 'M', usd: 24.99, claudium: 2499, inStock: true },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const result = await merchProducts();
    expect(result.enabled).toBe(true);
    expect(result.products).toHaveLength(1);
    expect(result.products[0].variants[0]).toEqual({
      variantId: 'tee-m',
      label: 'M',
      usd: 24.99,
      claudium: 2499,
      inStock: true,
    });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://economy.test/merch/products');
    expect((init.headers as Record<string, string>)['x-woc-economy-secret']).toBe('shh');
  });

  it('POSTs merch/checkout and passes the service intent through verbatim', async () => {
    const fetchSpy = vi.fn(async (_url: URL, _init: RequestInit) =>
      jsonResponse({
        orderId: 'ord_1',
        rail: 'stripe',
        totalUsd: 24.99,
        totalClaudium: 2499,
        stripe: { clientSecret: 'cs_test', publishableKey: 'pk_test' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const result = await merchCheckout(checkoutInput());
    expect(result).toMatchObject({
      ok: true,
      orderId: 'ord_1',
      rail: 'stripe',
      totalUsd: 24.99,
      totalClaudium: 2499,
      stripe: { clientSecret: 'cs_test', publishableKey: 'pk_test' },
      native: null,
      paid: false,
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://economy.test/merch/checkout');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toMatchObject({ accountId: '7', rail: 'stripe' });
  });

  it('relays webhooks with the provider signature header and tolerates a 400', async () => {
    const fetchSpy = vi.fn(async (_url: URL, _init: RequestInit) =>
      jsonResponse({ received: true }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    expect(await merchStripeWebhook(Buffer.from('{"id":1}'), 'sig-a')).toEqual({
      received: true,
    });
    let [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://economy.test/merch/stripe/webhook');
    expect((init.headers as Record<string, string>)['stripe-signature']).toBe('sig-a');

    expect(await merchPrintfulWebhook(Buffer.from('{"id":2}'), 'sig-b')).toEqual({
      received: true,
    });
    [url, init] = fetchSpy.mock.calls[1];
    expect(String(url)).toBe('https://economy.test/merch/printful/webhook');
    expect((init.headers as Record<string, string>)['x-pf-webhook-signature']).toBe('sig-b');

    // A service 400 (bad signature) is a normal outcome, not an outage.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ received: false }, 400)),
    );
    expect(await merchStripeWebhook(Buffer.from('{}'), 'bad')).toEqual({ received: false });
  });

  it('drops malformed catalog rows instead of passing them through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          enabled: true,
          products: [
            { productId: 'ok', name: 'Ok', variants: [] },
            { productId: 42, name: 'Bad', variants: [] },
            { productId: 'bad-variant', name: 'Bad', variants: [{ variantId: 1 }] },
          ],
        }),
      ),
    );
    const result = await merchProducts();
    expect(result.products.map((p) => p.productId)).toEqual(['ok']);
  });
});

// ---------------------------------------------------------------------------
// merchCheckout answers ok:true only for a coherent intent on the REQUESTED
// rail (the claudiumPurchase strictness).
// ---------------------------------------------------------------------------

describe('merchCheckout response validation', () => {
  beforeEach(() => {
    configureService();
  });

  const serve = (body: unknown) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(body)),
    );
  };
  const STRIPE_OK = {
    orderId: 'ord_1',
    rail: 'stripe',
    totalUsd: 24.99,
    totalClaudium: 2499,
    stripe: { clientSecret: 'cs', publishableKey: 'pk' },
  };

  it('collapses an orderId WITH a refusal reason to the typed refusal', async () => {
    serve({ ...STRIPE_OK, reason: 'card_declined' });
    const r = await merchCheckout(checkoutInput());
    expect(r).toMatchObject({ ok: false, orderId: null, reason: 'card_declined' });
  });

  it('refuses a rail mismatch (asked stripe, answered sol)', async () => {
    serve({ ...STRIPE_OK, rail: 'sol' });
    expect((await merchCheckout(checkoutInput())).ok).toBe(false);
  });

  it('refuses a stripe intent with an empty clientSecret or missing leg', async () => {
    serve({ ...STRIPE_OK, stripe: { clientSecret: ' ', publishableKey: 'pk' } });
    expect((await merchCheckout(checkoutInput())).ok).toBe(false);
    serve({ ...STRIPE_OK, stripe: undefined });
    expect((await merchCheckout(checkoutInput())).ok).toBe(false);
  });

  it('refuses non-positive or malformed totals', async () => {
    serve({ ...STRIPE_OK, totalUsd: 0 });
    expect((await merchCheckout(checkoutInput())).ok).toBe(false);
    serve({ ...STRIPE_OK, totalClaudium: 24.5 });
    expect((await merchCheckout(checkoutInput())).ok).toBe(false);
  });

  it('a sol checkout needs a well-formed native leg', async () => {
    const input = { ...checkoutInput(), rail: 'sol' as const, payer: 'payer1' };
    serve({
      ...STRIPE_OK,
      rail: 'sol',
      stripe: undefined,
      native: { reference: 'ref_1', transactionBase64: '' },
    });
    expect((await merchCheckout(input)).ok).toBe(false);
    serve({
      ...STRIPE_OK,
      rail: 'sol',
      stripe: undefined,
      native: {
        reference: 'ref_1',
        amountBase: '100',
        destination: 'dest',
        transactionBase64: 'dHg=',
      },
    });
    const ok = await merchCheckout(input);
    expect(ok.ok).toBe(true);
    expect(ok.native).toMatchObject({ reference: 'ref_1', quoteExpiryMs: null });
    expect(ok.stripe).toBeNull();
  });

  it('a claudium checkout is ok only when paid with a numeric balance', async () => {
    const input = { ...checkoutInput(), rail: 'claudium' as const };
    serve({ ...STRIPE_OK, rail: 'claudium', stripe: undefined, paid: true });
    expect((await merchCheckout(input)).ok).toBe(false);
    serve({ ...STRIPE_OK, rail: 'claudium', stripe: undefined, paid: true, balance: 970 });
    const ok = await merchCheckout(input);
    expect(ok).toMatchObject({ ok: true, paid: true, balance: 970 });
  });
});

// ---------------------------------------------------------------------------
// The products TTL memo: one upstream read per window, process-wide.
// ---------------------------------------------------------------------------

describe('merchProducts TTL memo', () => {
  it('serves repeat probes from the memo without another upstream fetch', async () => {
    configureService();
    const fetchSpy = vi.fn(async (_url: URL, _init: RequestInit) =>
      jsonResponse({ enabled: true, products: [] }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    expect((await merchProducts()).enabled).toBe(true);
    expect((await merchProducts()).enabled).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    resetMerchProductsCacheForTests();
    await merchProducts();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
