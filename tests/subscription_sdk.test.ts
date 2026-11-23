import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/net/online', () => ({ apiUrl: (path: string, base: string) => `${base}${path}` }));

import { createSubscriptionStoreHooks, storeSnapshotForHud } from '../src/net/subscription_sdk';
import { GAME_SUBSCRIPTION_PRICE } from '../src/subscription_contract';
import { dailyRewardsStoreSnapshot } from '../src/ui/store_snapshot_adapter';

afterEach(() => vi.unstubAllGlobals());
describe('subscription SDK', () => {
  it('can discover a mount on another device and carries only definitive terminal checkout state', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ delivered: true })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, url: null, retryWithNewKey: true })),
      )
      .mockRejectedValueOnce(Error('timeout'));
    vi.stubGlobal('fetch', fetcher);
    const sdk = createSubscriptionStoreHooks({ token: () => 'session' });
    expect(await sdk.annualMountClaim!()).toEqual({ delivered: true });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({});
    expect(await sdk.link('checkout', 'expired-annual-intent', 'game_annual')).toEqual({
      ok: false,
      url: null,
      retryWithNewKey: true,
    });
    expect(await sdk.link('checkout', 'uncertain-annual-intent', 'game_annual')).toEqual({
      ok: false,
      url: null,
    });
  });
  it('reads authenticated storage scope without forwarding account identity into checkout', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accountId: 41,
            available: true,
            plan: 'game_monthly',
            price: GAME_SUBSCRIPTION_PRICE,
            status: 'none',
            cancelAtPeriodEnd: false,
            currentPeriodEnd: null,
            canCheckout: true,
            canManage: false,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, url: 'https://checkout.stripe.com/c/pay/test' })),
      );
    vi.stubGlobal('fetch', fetcher);
    const sdk = createSubscriptionStoreHooks({ token: () => 'session' });
    expect((await sdk.snapshot()).accountId).toBe(41);
    await sdk.link('checkout', 'account-scoped-key', 'game_annual');
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      plan: 'game_annual',
      rail: 'stripe',
      idempotencyKey: 'account-scoped-key',
    });
  });
  it('sends annual intent without trusting browser price, reward or recipient identity', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, url: 'https://checkout.stripe.com/c/pay/annual' })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ delivered: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ delivered: 'true' })));
    vi.stubGlobal('fetch', fetcher);
    const sdk = createSubscriptionStoreHooks({ token: () => 'session' });
    await sdk.link('checkout', 'annual-intent-12345', 'game_annual');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      plan: 'game_annual',
      rail: 'stripe',
      idempotencyKey: 'annual-intent-12345',
    });
    expect(await sdk.annualMountClaim!('annual-intent-12345')).toEqual({ delivered: true });
    expect(fetcher.mock.calls[1][0]).toBe('/api/claudium/subscription/annual/claim');
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      idempotencyKey: 'annual-intent-12345',
    });
    expect(await sdk.annualMountClaim!('annual-intent-12345')).toEqual({ delivered: false });
  });
  it('never fetches for a logged-out account', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const sdk = createSubscriptionStoreHooks({ token: () => null });
    expect((await sdk.snapshot()).available).toBe(false);
    expect((await sdk.link('checkout', 'intent-1234567890')).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('sends only the fixed fiat plan and caller-held retry key to the game API', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: true, url: 'https://checkout.stripe.com/c/pay/cs_test_1' }),
        ),
    );
    vi.stubGlobal('fetch', fetcher);
    const sdk = createSubscriptionStoreHooks({
      token: () => 'test-token',
      base: 'https://game.example',
    });
    expect((await sdk.link('checkout', 'intent-1234567890')).ok).toBe(true);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://game.example/api/claudium/subscription/checkout');
    expect(JSON.parse(options!.body as string)).toEqual({
      plan: 'game_monthly',
      rail: 'stripe',
      idempotencyKey: 'intent-1234567890',
    });
    expect(options!.headers).toMatchObject({ Authorization: 'Bearer test-token' });
  });
  it('preserves the existing cosmetic snapshot through the extracted adapters', async () => {
    const snapshot = {
      available: true,
      balance: 400,
      items: [
        {
          itemId: 'example',
          name: 'Example',
          kind: 'skin' as const,
          costClaudium: 200,
          owned: false,
        },
      ],
    };
    const adapted = dailyRewardsStoreSnapshot(
      await storeSnapshotForHud({ storeSnapshot: async () => snapshot }),
    );
    expect(adapted).toEqual(snapshot);
    expect(adapted.items).not.toBe(snapshot.items);
  });
  it('uses the authenticated same-origin token purchase and receipt endpoints', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, url: 'https://checkout.stripe.com/c/pay/token' })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ delivered: true })));
    vi.stubGlobal('fetch', fetcher);
    const sdk = createSubscriptionStoreHooks({ token: () => 'test-token' });
    expect((await sdk.tokenCheckout!('token-intent-123456')).ok).toBe(true);
    expect(await sdk.tokenClaim!('token-intent-123456')).toEqual({ delivered: true });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/claudium/membership-token/checkout',
      '/api/claudium/membership-token/claim',
    ]);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      idempotencyKey: 'token-intent-123456',
    });
  });
});
