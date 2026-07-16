// Coverage for the pure merch-store view core (src/ui/merch_view.ts): the
// disabled state, catalog/cart projection, the display-only totals, rail gating,
// and the forward-compatible order-status mapping. DOM-free and i18n-free by
// construction; this drives it directly.

import { describe, expect, it } from 'vitest';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';
import {
  buildMerchView,
  type MerchOutcomeInput,
  type MerchProductInput,
  type MerchViewInput,
  merchShippingComplete,
  merchStatusKey,
  resolveCheckoutOutcome,
} from '../src/ui/merch_view';

const TEE: MerchProductInput = {
  productId: 'tee',
  name: 'Claudemoon Tee',
  description: 'Soft cotton.',
  imageUrl: null,
  variants: [
    { variantId: 'tee-m', label: 'M', usd: 24.99, claudium: 2499, inStock: true },
    { variantId: 'tee-l', label: 'L', usd: 24.99, claudium: 2499, inStock: false },
  ],
};

const MUG: MerchProductInput = {
  productId: 'mug',
  name: 'Guild Mug',
  description: 'Holds coffee.',
  imageUrl: 'https://cdn.test/mug.png',
  variants: [{ variantId: 'mug-std', label: 'Standard', usd: 14.5, claudium: 1450, inStock: true }],
};

function input(overrides: Partial<MerchViewInput> = {}): MerchViewInput {
  return {
    enabled: true,
    products: [TEE, MUG],
    claudiumBalance: null,
    cart: [],
    ...overrides,
  };
}

describe('disabled state', () => {
  it('renders a clean empty model when the store is off', () => {
    const view = buildMerchView(input({ enabled: false, cart: [{ variantId: 'tee-m', qty: 1 }] }));
    expect(view.disabled).toBe(true);
    expect(view.productRows).toEqual([]);
    expect(view.cartRows).toEqual([]);
    expect(view.rails).toEqual({ stripe: false, sol: false, claudium: false });
    expect(view.canCheckout).toBe(false);
  });
});

describe('catalog + cart projection', () => {
  it('mirrors the catalog verbatim and joins the cart onto known variants', () => {
    const view = buildMerchView(
      input({
        cart: [
          { variantId: 'tee-m', qty: 2 },
          { variantId: 'mug-std', qty: 1 },
          { variantId: 'gone', qty: 3 }, // unknown variant: dropped, never guessed
          { variantId: 'tee-l', qty: 0 }, // non-positive qty: dropped
        ],
      }),
    );
    expect(view.disabled).toBe(false);
    expect(view.productRows).toHaveLength(2);
    expect(view.cartRows.map((r) => r.variantId)).toEqual(['tee-m', 'mug-std']);
    expect(view.cartRows[0]).toMatchObject({
      productName: 'Claudemoon Tee',
      variantLabel: 'M',
      qty: 2,
      lineUsd: 49.98,
      lineClaudium: 4998,
    });
    expect(view.cartCount).toBe(3);
    expect(view.totalUsd).toBeCloseTo(64.48, 2);
    expect(view.totalClaudium).toBe(6448);
  });

  it('blocks checkout while the cart holds an out-of-stock variant', () => {
    const view = buildMerchView(input({ cart: [{ variantId: 'tee-l', qty: 1 }] }));
    expect(view.cartRows).toHaveLength(1);
    expect(view.canCheckout).toBe(false);
    expect(view.rails).toEqual({ stripe: false, sol: false, claudium: false });
  });
});

describe('rail availability', () => {
  it('needs a checkout-able cart for stripe/sol and a covering balance for claudium', () => {
    const empty = buildMerchView(input({ claudiumBalance: 100_000 }));
    expect(empty.rails).toEqual({ stripe: false, sol: false, claudium: false });

    const cart = [{ variantId: 'mug-std', qty: 1 }];
    const noBalance = buildMerchView(input({ cart }));
    expect(noBalance.rails).toEqual({ stripe: true, sol: true, claudium: false });

    const short = buildMerchView(input({ cart, claudiumBalance: 1449 }));
    expect(short.rails.claudium).toBe(false);

    const funded = buildMerchView(input({ cart, claudiumBalance: 1450 }));
    expect(funded.rails).toEqual({ stripe: true, sol: true, claudium: true });
  });
});

describe('order rows', () => {
  it('maps known statuses to their label keys and unknown ones to unknown', () => {
    expect(merchStatusKey('pending_payment')).toBe('pendingPayment');
    expect(merchStatusKey('in_production')).toBe('inProduction');
    expect(merchStatusKey('fulfillment_failed')).toBe('fulfillmentFailed');
    expect(merchStatusKey('teleported_to_moon')).toBe('unknown');

    const view = buildMerchView(
      input({
        orders: [
          {
            orderId: 'ord_1',
            status: 'shipped',
            createdAtMs: 1_700_000_000_000,
            totalLabel: '$24.99',
            items: [
              { name: 'Claudemoon Tee', qty: 1 },
              { name: 'Guild Mug', qty: 2 },
            ],
            trackingUrl: 'https://track.test/1',
          },
          {
            orderId: 'ord_2',
            status: 'some_future_status',
            createdAtMs: 1_700_000_100_000,
            totalLabel: '1450 Claudium',
            items: [],
            trackingUrl: null,
          },
        ],
      }),
    );
    expect(view.orderRows[0]).toMatchObject({
      orderId: 'ord_1',
      statusKey: 'shipped',
      items: [
        { name: 'Claudemoon Tee', qty: 1 },
        { name: 'Guild Mug', qty: 2 },
      ],
      trackingUrl: 'https://track.test/1',
    });
    expect(view.orderRows[1].statusKey).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// The status label keys stay in lockstep with the hudChrome.merch.status catalog.
// ---------------------------------------------------------------------------

describe('status keys', () => {
  it('every service lifecycle status resolves to a real hudChrome.merch.status.* key', () => {
    // The PRD order lifecycle (docs/prd/woc/merch-store.md) plus the unknown
    // fallback; a status added to one side without the other fails here.
    const lifecycle = [
      'pending_payment',
      'paid',
      'submitted',
      'in_production',
      'shipped',
      'delivered',
      'payment_failed',
      'expired',
      'canceled',
      'refunded',
      'fulfillment_failed',
    ];
    const catalog = hudChromeStrings.merch.status as Record<string, string>;
    for (const status of lifecycle) {
      const suffix = merchStatusKey(status);
      expect(suffix, status).not.toBe('unknown');
      expect(typeof catalog[suffix], `${status} -> ${suffix}`).toBe('string');
    }
    expect(typeof catalog[merchStatusKey('brand_new_status')]).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// resolveCheckoutOutcome: the when-does-the-cart-clear decision, all branches.
// ---------------------------------------------------------------------------

describe('resolveCheckoutOutcome', () => {
  const outcome = (
    checkout: Partial<MerchOutcomeInput['checkout']>,
    settlement: MerchOutcomeInput['settlement'] = null,
  ): MerchOutcomeInput => ({
    checkout: { ok: false, orderId: null, rail: null, reason: null, ...checkout },
    settlement,
  });

  it('a refused checkout keeps the cart: invalid_request maps to invalid', () => {
    expect(resolveCheckoutOutcome(outcome({ reason: 'invalid_request' }))).toEqual({
      clearCart: false,
      orderId: null,
      notice: 'invalid',
    });
  });

  it('a refused checkout with any other reason maps to unavailable', () => {
    expect(resolveCheckoutOutcome(outcome({ reason: 'out_of_stock' }))).toEqual({
      clearCart: false,
      orderId: null,
      notice: 'unavailable',
    });
    // ok:true but no orderId is malformed: also unavailable, cart intact.
    expect(resolveCheckoutOutcome(outcome({ ok: true }))).toEqual({
      clearCart: false,
      orderId: null,
      notice: 'unavailable',
    });
  });

  it('a settled sol order is placed and clears the cart', () => {
    expect(
      resolveCheckoutOutcome(
        outcome({ ok: true, orderId: 'ord_9', rail: 'sol' }, { settled: true }),
      ),
    ).toEqual({ clearCart: true, orderId: 'ord_9', notice: 'orderPlaced' });
  });

  it('an unsettled or settlement-less sol order keeps the cart with notSettled', () => {
    expect(
      resolveCheckoutOutcome(
        outcome({ ok: true, orderId: 'ord_9', rail: 'sol' }, { settled: false }),
      ),
    ).toEqual({ clearCart: false, orderId: 'ord_9', notice: 'notSettled' });
    expect(
      resolveCheckoutOutcome(outcome({ ok: true, orderId: 'ord_9', rail: 'sol' }, null)),
    ).toEqual({ clearCart: false, orderId: 'ord_9', notice: 'notSettled' });
  });

  it('a stripe order clears the cart but stays HONESTLY payment-pending, never placed', () => {
    expect(resolveCheckoutOutcome(outcome({ ok: true, orderId: 'ord_5', rail: 'stripe' }))).toEqual(
      { clearCart: true, orderId: 'ord_5', notice: 'paymentPending' },
    );
  });

  it('a claudium order settled synchronously in the call is placed', () => {
    expect(
      resolveCheckoutOutcome(outcome({ ok: true, orderId: 'ord_3', rail: 'claudium' })),
    ).toEqual({ clearCart: true, orderId: 'ord_3', notice: 'orderPlaced' });
  });
});

// ---------------------------------------------------------------------------
// merchShippingComplete: required fields only; address2/state stay optional.
// ---------------------------------------------------------------------------

describe('merchShippingComplete', () => {
  const full = {
    name: 'Alice Example',
    address1: '1 Claudemoon Way',
    city: 'Valeholm',
    zip: '00001',
    country: 'US',
  };

  it('accepts a complete block and a non-empty email', () => {
    expect(merchShippingComplete(full, 'a@b.example')).toBe(true);
  });

  it('rejects each missing required field and a missing email', () => {
    for (const key of ['name', 'address1', 'city', 'zip', 'country'] as const) {
      expect(merchShippingComplete({ ...full, [key]: '' }, 'a@b.example'), key).toBe(false);
    }
    expect(merchShippingComplete(full, '')).toBe(false);
  });
});
