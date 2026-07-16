// Coverage for the merch client SDK (src/net/merch_sdk.ts): the tokenless public
// catalog read, the typed OFF fallbacks for authed calls, and the checkout
// orchestrator's stop-clean seams (no signer / store off => nothing charged),
// mirroring tests/economy_sdk.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type MerchCheckout,
  type MerchCheckoutClient,
  MerchClient,
  type MerchShipping,
  startMerchCheckout,
} from '../src/net/merch_sdk';

const SHIPPING: MerchShipping = {
  name: 'Alice Example',
  address1: '1 Claudemoon Way',
  address2: '',
  city: 'Valeholm',
  state: '',
  zip: '00001',
  country: 'US',
};

function checkoutInput(rail: 'stripe' | 'sol' | 'claudium') {
  return {
    rail,
    items: [{ variantId: 'tee-m', qty: 1 }],
    shipping: SHIPPING,
    email: 'alice@example.com',
  };
}

function okCheckout(overrides: Partial<MerchCheckout> = {}): MerchCheckout {
  return {
    ok: true,
    orderId: 'ord_1',
    rail: 'stripe',
    totalUsd: 24.99,
    totalClaudium: 2499,
    stripe: null,
    native: null,
    paid: false,
    balance: null,
    reason: null,
    ...overrides,
  };
}

// The sol rail reads the connected wallet address through a lazy import; the
// mock keeps it out of the network and lets tests flip the connected state.
let walletAddress: string | null = 'payer-wallet';
vi.mock('../src/net/wallet', () => ({
  currentWallet: () => ({ address: walletAddress, isConnected: walletAddress !== null }),
}));

afterEach(() => {
  walletAddress = 'payer-wallet';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MerchClient', () => {
  it('reads the public catalog without a token (no Authorization header)', async () => {
    const fetchSpy = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ enabled: true, products: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const client = new MerchClient({ token: () => null });

    const result = await client.products();
    expect(result).toEqual({ enabled: true, products: [] });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('resolves authed calls to their OFF fallbacks without a token (no fetch)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const client = new MerchClient({ token: () => null });

    expect(await client.orders()).toEqual([]);
    expect((await client.checkout({ ...checkoutInput('stripe'), idempotencyKey: 'k' })).ok).toBe(
      false,
    );
    expect(await client.nativeConfirm({ reference: 'r', signature: 's' })).toEqual({
      settled: false,
      orderId: null,
      reason: 'unavailable',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolves a network failure to the OFF fallback, never a throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const client = new MerchClient({ token: () => 'tok' });
    expect(await client.products()).toEqual({ enabled: false, products: [] });
    expect(await client.orders()).toEqual([]);
  });
});

describe('startMerchCheckout', () => {
  it('sol rail without a wired signer stops cleanly: nothing fetched, nothing charged', async () => {
    const checkout = vi.fn();
    const client = { checkout, nativeConfirm: vi.fn() } as unknown as MerchCheckoutClient;

    const outcome = await startMerchCheckout(client, checkoutInput('sol'), {});
    expect(outcome.checkout.ok).toBe(false);
    expect(outcome.checkout.reason).toBe('unavailable');
    expect(outcome.settlement).toBeNull();
    expect(checkout).not.toHaveBeenCalled();
  });

  it('stripe rail hands the intent to the stripe signer with the orderId', async () => {
    const intent = { clientSecret: 'cs_test', publishableKey: 'pk_test' };
    const checkout = vi.fn(async (_input: { idempotencyKey: string }) =>
      okCheckout({ stripe: intent }),
    );
    const client = { checkout, nativeConfirm: vi.fn() } as unknown as MerchCheckoutClient;
    const stripe = vi.fn(async () => {});

    const outcome = await startMerchCheckout(client, checkoutInput('stripe'), { stripe });
    expect(outcome.checkout.orderId).toBe('ord_1');
    expect(stripe).toHaveBeenCalledWith(intent, 'ord_1');
    // The orchestrator generated the idempotency key itself.
    const sent = checkout.mock.calls[0][0];
    expect(sent.idempotencyKey).toBeTruthy();
  });

  it('stripe rail without a signer stops after the server intent (seam captured)', async () => {
    const checkout = vi.fn(async () =>
      okCheckout({ stripe: { clientSecret: 'cs', publishableKey: 'pk' } }),
    );
    const client = { checkout, nativeConfirm: vi.fn() } as unknown as MerchCheckoutClient;

    const outcome = await startMerchCheckout(client, checkoutInput('stripe'), {});
    expect(outcome.checkout.ok).toBe(true);
    expect(outcome.settlement).toBeNull();
  });

  it('claudium rail settles synchronously in the checkout call (no signer leg)', async () => {
    const checkout = vi.fn(async () =>
      okCheckout({ rail: 'claudium', paid: true, balance: 1000, stripe: null }),
    );
    const client = { checkout, nativeConfirm: vi.fn() } as unknown as MerchCheckoutClient;

    const outcome = await startMerchCheckout(client, checkoutInput('claudium'), {});
    expect(outcome.checkout.paid).toBe(true);
    expect(outcome.checkout.balance).toBe(1000);
    expect(outcome.settlement).toBeNull();
  });

  it('a store-off checkout passes the typed refusal through unchanged', async () => {
    const off: MerchCheckout = {
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
    const checkout = vi.fn(async () => off);
    const stripe = vi.fn(async () => {});
    const client = { checkout, nativeConfirm: vi.fn() } as unknown as MerchCheckoutClient;

    const outcome = await startMerchCheckout(client, checkoutInput('stripe'), { stripe });
    expect(outcome.checkout).toEqual(off);
    expect(stripe).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The sol rail end to end: wallet address, sign, and the confirm retry ladder
// (REAL startMerchCheckout + REAL confirmNativeSettlement; only the HTTP client
// and the wallet module are fakes).
// ---------------------------------------------------------------------------

describe('startMerchCheckout: sol rail', () => {
  const NATIVE = {
    reference: 'ref_1',
    amountBase: '1000000',
    destination: 'Dest1111111111111111111111111111111111111111',
    mint: null,
    memo: null,
    quoteExpiryMs: 1_700_000_060_000,
    transactionBase64: 'dHgtYnl0ZXM=',
  };
  const NO_WAIT = { delayMs: async () => {}, nowMs: () => 1_700_000_000_000 };

  it('signs the service-built transaction and settles through the confirm adapter', async () => {
    const checkout = vi.fn(async (_input: { payer?: string; idempotencyKey: string }) =>
      okCheckout({ rail: 'sol', native: NATIVE }),
    );
    const nativeConfirm = vi.fn(async (_req: { reference: string; signature: string }) => ({
      settled: true,
      orderId: 'ord_1',
      reason: null,
    }));
    const client = { checkout, nativeConfirm } as unknown as MerchCheckoutClient;
    const nativeSignAndSend = vi.fn(async (_tx: string) => 'sig-abc');

    const outcome = await startMerchCheckout(
      client,
      checkoutInput('sol'),
      { nativeSignAndSend },
      NO_WAIT,
    );

    expect(checkout.mock.calls[0][0]).toMatchObject({ payer: 'payer-wallet' });
    expect(checkout.mock.calls[0][0].idempotencyKey).toBeTruthy();
    expect(nativeSignAndSend).toHaveBeenCalledWith('dHgtYnl0ZXM=', 'ref_1');
    expect(nativeConfirm).toHaveBeenCalledWith({ reference: 'ref_1', signature: 'sig-abc' });
    expect(outcome.settlement).toEqual({ settled: true, orderId: 'ord_1', reason: null });
  });

  it('walks the retry ladder on retryable reasons and maps the LAST orderId out', async () => {
    const answers = [
      { settled: false, orderId: null, reason: 'not_found_onchain' },
      { settled: false, orderId: null, reason: 'not_finalized' },
      { settled: true, orderId: 'ord_1', reason: null },
    ];
    let call = 0;
    const nativeConfirm = vi.fn(async () => answers[Math.min(call++, answers.length - 1)]);
    const checkout = vi.fn(async () => okCheckout({ rail: 'sol', native: NATIVE }));
    const client = { checkout, nativeConfirm } as unknown as MerchCheckoutClient;
    const delays: number[] = [];
    const outcome = await startMerchCheckout(
      client,
      checkoutInput('sol'),
      { nativeSignAndSend: async () => 'sig' },
      {
        delayMs: async (ms) => {
          delays.push(ms);
        },
        nowMs: () => 1_700_000_000_000,
      },
    );
    expect(nativeConfirm).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([1000, 1500]);
    expect(outcome.settlement).toEqual({ settled: true, orderId: 'ord_1', reason: null });
  });

  it('keeps retrying past the quote expiry once the signature is broadcast', async () => {
    // The claudium twin's policy: post-broadcast confirmation is bounded by the
    // ladder's own recovery window, never the quote's wall-clock expiry. The
    // clock here starts AFTER the quote expired; the ladder must still retry.
    const expired = { ...NATIVE, quoteExpiryMs: 1_699_999_000_000 };
    const answers = [
      { settled: false, orderId: null, reason: 'not_finalized' },
      { settled: true, orderId: 'ord_1', reason: null },
    ];
    let call = 0;
    const nativeConfirm = vi.fn(async () => answers[Math.min(call++, answers.length - 1)]);
    const checkout = vi.fn(async () => okCheckout({ rail: 'sol', native: expired }));
    const client = { checkout, nativeConfirm } as unknown as MerchCheckoutClient;
    const outcome = await startMerchCheckout(
      client,
      checkoutInput('sol'),
      { nativeSignAndSend: async () => 'sig' },
      { delayMs: async () => {}, nowMs: () => 1_700_000_000_000 },
    );
    expect(nativeConfirm).toHaveBeenCalledTimes(2);
    expect(outcome.settlement?.settled).toBe(true);
  });

  it('reports an unsettled outcome verbatim after a non-retryable refusal', async () => {
    const nativeConfirm = vi.fn(async () => ({
      settled: false,
      orderId: 'ord_1',
      reason: 'expired',
    }));
    const checkout = vi.fn(async () => okCheckout({ rail: 'sol', native: NATIVE }));
    const client = { checkout, nativeConfirm } as unknown as MerchCheckoutClient;
    const outcome = await startMerchCheckout(
      client,
      checkoutInput('sol'),
      { nativeSignAndSend: async () => 'sig' },
      NO_WAIT,
    );
    expect(nativeConfirm).toHaveBeenCalledTimes(1);
    expect(outcome.settlement).toEqual({ settled: false, orderId: 'ord_1', reason: 'expired' });
  });

  it('prefers the nativePayer override over the connected wallet (desktop handoff)', async () => {
    const checkout = vi.fn(async (_input: { payer?: string }) =>
      okCheckout({ rail: 'sol', native: NATIVE }),
    );
    const nativeConfirm = vi.fn(async () => ({ settled: true, orderId: 'ord_1', reason: null }));
    const client = { checkout, nativeConfirm } as unknown as MerchCheckoutClient;

    await startMerchCheckout(
      client,
      checkoutInput('sol'),
      { nativePayer: 'desktop-linked-wallet', nativeSignAndSend: async () => 'sig' },
      NO_WAIT,
    );
    expect(checkout.mock.calls[0][0]).toMatchObject({ payer: 'desktop-linked-wallet' });
  });

  it('stops before charging when no wallet is connected (no checkout call)', async () => {
    walletAddress = null;
    const checkout = vi.fn();
    const client = { checkout, nativeConfirm: vi.fn() } as unknown as MerchCheckoutClient;
    const outcome = await startMerchCheckout(client, checkoutInput('sol'), {
      nativeSignAndSend: async () => 'sig',
    });
    expect(outcome.checkout.ok).toBe(false);
    expect(outcome.settlement).toBeNull();
    expect(checkout).not.toHaveBeenCalled();
  });

  it('stops after the intent when the checkout carries no native leg (nothing signed)', async () => {
    const checkout = vi.fn(async () => okCheckout({ rail: 'sol', native: null }));
    const nativeSignAndSend = vi.fn(async () => 'sig');
    const client = { checkout, nativeConfirm: vi.fn() } as unknown as MerchCheckoutClient;
    const outcome = await startMerchCheckout(client, checkoutInput('sol'), { nativeSignAndSend });
    expect(outcome.checkout.ok).toBe(true);
    expect(outcome.settlement).toBeNull();
    expect(nativeSignAndSend).not.toHaveBeenCalled();
  });
});
