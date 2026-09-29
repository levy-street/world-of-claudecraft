import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/net/online', () => ({ apiUrl: (path: string, base: string) => `${base}${path}` }));

import { createSubscriptionStoreHooks, storeSnapshotForHud } from '../src/net/subscription_sdk';
import { dailyRewardsStoreSnapshot } from '../src/ui/store_snapshot_adapter';

afterEach(() => vi.unstubAllGlobals());
describe('subscription SDK', () => {
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
});
