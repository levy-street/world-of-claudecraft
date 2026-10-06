import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/claudium_proxy', () => ({ callService: vi.fn() }));

import { callService } from '../../server/claudium_proxy';
import { gameSubscriptionLink } from '../../server/subscription_proxy';

const input = { plan: 'game_annual', rail: 'stripe', idempotencyKey: 'annual-intent-123456' };
const recipient = { characterId: 42, realm: 'main' };
beforeEach(() => {
  vi.stubEnv('WOC_SUBSCRIPTIONS_ENABLED', '1');
  vi.mocked(callService).mockReset().mockResolvedValue({
    ok: true,
    url: 'https://checkout.stripe.com/c/pay/annual',
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('annual subscription game proxy', () => {
  it('fixes the annual price and uses only the server-selected recipient', async () => {
    expect((await gameSubscriptionLink(7, 'checkout', input, recipient)).ok).toBe(true);
    expect(callService).toHaveBeenCalledExactlyOnceWith({
      method: 'POST',
      path: 'subscriptions/checkout',
      body: {
        ...input,
        accountId: 7,
        ...recipient,
        price: { currency: 'usd', unitAmount: 5000, interval: 'year' },
      },
    });
  });
  it('refuses missing recipients and client authority overrides before service IO', async () => {
    expect((await gameSubscriptionLink(7, 'checkout', input)).ok).toBe(false);
    for (const extra of [
      { characterId: 8 },
      { realm: 'other' },
      { price: 1 },
      { trialDays: 7 },
      { claudium: 6000 },
      { accountId: 9 },
    ])
      expect(
        (await gameSubscriptionLink(7, 'checkout', { ...input, ...extra }, recipient)).ok,
      ).toBe(false);
    expect(callService).not.toHaveBeenCalled();
  });
  it('does not require a world character to manage existing annual billing', async () => {
    vi.mocked(callService).mockResolvedValue({
      ok: true,
      url: 'https://billing.stripe.com/p/session/annual',
    });
    expect((await gameSubscriptionLink(7, 'portal', input)).ok).toBe(true);
    expect(vi.mocked(callService).mock.calls[0][0].body).not.toHaveProperty('characterId');
  });
});
