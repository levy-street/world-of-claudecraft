// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ desktop: false }));
vi.mock('../src/client_origin', () => ({
  get DESKTOP_APP() {
    return runtime.desktop;
  },
}));
const stripe = vi.hoisted(() => ({
  open: vi.fn(async (_intent: unknown, _labels: unknown, _opts?: { onComplete?(): void }) => {}),
}));
vi.mock('../src/net/stripe_checkout', () => ({ openStripeCheckout: stripe.open }));

import {
  GAME_SUBSCRIPTION_PLANS,
  SUBSCRIPTION_OFF,
  type SubscriptionStoreHooks,
} from '../src/subscription_contract';
import { StoreSubscription } from '../src/ui/store_subscription';

afterEach(() => {
  vi.restoreAllMocks();
  stripe.open.mockClear();
  runtime.desktop = false;
  document.body.innerHTML = '';
  localStorage.clear();
});
function panelWith(hooks: SubscriptionStoreHooks) {
  return new StoreSubscription(() => hooks);
}
describe('subscription store section', () => {
  it('discovers an owed annual reward without a saved key after changing plans or devices', async () => {
    const annualMountClaim = vi.fn(async () => ({ delivered: true }));
    const link = vi.fn();
    const panel = panelWith({
      snapshot: async () => ({
        ...SUBSCRIPTION_OFF,
        available: true,
        accountId: 41,
        plan: 'game_monthly',
        status: 'active',
        canManage: true,
        plans: Object.values(GAME_SUBSCRIPTION_PLANS),
      }),
      link,
      annualMountClaim,
    });
    await panel.refresh();
    expect(annualMountClaim).not.toHaveBeenCalled();
    document.body.innerHTML = panel.html();
    panel.bind(document.body);
    document.querySelector<HTMLButtonElement>('[data-subscription-mount-claim]')!.click();
    await vi.waitFor(() => expect(annualMountClaim).toHaveBeenCalledExactlyOnceWith(undefined));
    expect(link).not.toHaveBeenCalled();
    expect(localStorage.getItem('woc.subscription.41.game_annual.pending')).toBeNull();
  });
  it.each(['game_monthly', 'game_annual'] as const)(
    'starts a fresh %s checkout on every click instead of resuming a saved one',
    async (plan) => {
      runtime.desktop = true;
      const storageKey = `woc.subscription.41.${plan}.pending`;
      localStorage.setItem(storageKey, 'earlier-checkout-intent');
      const link = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, url: null })
        .mockResolvedValueOnce({ ok: false, url: null, retryWithNewKey: true })
        .mockResolvedValueOnce({ ok: true, url: 'https://checkout.stripe.com/c/pay/new' });
      const panel = panelWith({
        snapshot: async () => ({
          ...SUBSCRIPTION_OFF,
          available: true,
          accountId: 41,
          status: 'canceled',
          canCheckout: true,
          plans: Object.values(GAME_SUBSCRIPTION_PLANS),
        }),
        link,
      });
      vi.spyOn(window, 'open').mockReturnValue(null);
      await panel.refresh();
      document.body.innerHTML = panel.html();
      panel.bind(document.body);
      const button = document.querySelector<HTMLButtonElement>(
        `[data-subscription-checkout-plan="${plan}"]`,
      )!;
      for (let click = 1; click <= 3; click++) {
        button.click();
        await vi.waitFor(() => expect(link).toHaveBeenCalledTimes(click));
        await vi.waitFor(() => expect(button.disabled).toBe(false));
      }
      const keys = link.mock.calls.map((call) => call[1]);
      expect(keys).not.toContain('earlier-checkout-intent');
      expect(new Set(keys).size).toBe(3);
      expect(localStorage.getItem(storageKey)).toBe(keys[2]);
    },
  );
  it('uses authenticated account scope when switching accounts in the same panel', async () => {
    localStorage.setItem('woc.subscription.41.game_annual.pending', 'first-account-intent');
    localStorage.setItem('woc.subscription.42.game_annual.pending', 'second-account-intent');
    let accountId = 41;
    const annualMountClaim = vi.fn(async () => ({ delivered: accountId === 42 }));
    const panel = panelWith({
      snapshot: async () => ({
        ...SUBSCRIPTION_OFF,
        available: true,
        accountId,
        plans: Object.values(GAME_SUBSCRIPTION_PLANS),
      }),
      link: vi.fn(),
      annualMountClaim,
    });
    await panel.refresh();
    expect(annualMountClaim).toHaveBeenLastCalledWith('first-account-intent');
    accountId = 42;
    await panel.refresh();
    expect(annualMountClaim).toHaveBeenLastCalledWith('second-account-intent');
    expect(localStorage.getItem('woc.subscription.42.game_annual.pending')).toBeNull();
    expect(localStorage.getItem('woc.subscription.41.game_annual.pending')).toBe(
      'first-account-intent',
    );
    accountId = 41;
    await panel.refresh();
    expect(annualMountClaim).toHaveBeenLastCalledWith('first-account-intent');
    expect(panel.html()).not.toContain('key has been delivered');
  });
  it('offers no resume checkout and keeps the saved annual key after a failed reward lookup', async () => {
    runtime.desktop = true;
    localStorage.setItem('woc.subscription.41.game_annual.pending', 'known-annual-intent');
    const link = vi.fn(async () => ({ ok: true, url: 'https://checkout.stripe.com/c/pay/annual' }));
    const panel = panelWith({
      snapshot: async () => ({
        ...SUBSCRIPTION_OFF,
        available: true,
        accountId: 41,
        status: 'incomplete',
        plans: Object.values(GAME_SUBSCRIPTION_PLANS),
      }),
      link,
      annualMountClaim: async () => {
        throw Error('network');
      },
    });
    vi.spyOn(window, 'open').mockReturnValue(null);
    await panel.refresh();
    document.body.innerHTML = panel.html();
    panel.bind(document.body);
    expect(document.body.textContent).not.toContain('Resume checkout');
    expect(document.querySelector('[data-subscription-action="checkout"]')).toBeNull();
    expect(document.querySelector('[data-subscription-mount-claim]')).not.toBeNull();
    expect(localStorage.getItem('woc.subscription.41.game_annual.pending')).toBe(
      'known-annual-intent',
    );
    expect(link).not.toHaveBeenCalled();
  });
  it('resumes annual mount delivery after reload without buying again or losing its intent', async () => {
    runtime.desktop = true;
    const link = vi.fn(async () => ({ ok: true, url: 'https://checkout.stripe.com/c/pay/annual' }));
    const annualMountClaim = vi
      .fn()
      .mockResolvedValueOnce({ delivered: false })
      .mockResolvedValueOnce({ delivered: true });
    const hooks: SubscriptionStoreHooks = {
      snapshot: async () => ({
        ...SUBSCRIPTION_OFF,
        available: true,
        accountId: 41,
        canCheckout: true,
        plans: Object.values(GAME_SUBSCRIPTION_PLANS),
        trialEligible: true,
        trialDays: 7,
      }),
      link,
      annualMountClaim,
    };
    vi.spyOn(window, 'open').mockReturnValue(null);
    let panel = panelWith(hooks);
    await panel.refresh();
    document.body.innerHTML = panel.html();
    panel.bind(document.body);
    document
      .querySelector<HTMLButtonElement>('[data-subscription-checkout-plan="game_annual"]')!
      .click();
    await vi.waitFor(() => expect(link).toHaveBeenCalledTimes(1));
    const key = (link.mock.calls[0] as unknown as [string, string, string])[1];
    expect(link).toHaveBeenCalledWith('checkout', key, 'game_annual');
    expect(localStorage.getItem('woc.subscription.41.game_annual.pending')).toBe(key);
    panel = panelWith(hooks);
    await panel.refresh();
    expect(annualMountClaim).toHaveBeenCalledWith(key);
    expect(localStorage.getItem('woc.subscription.41.game_annual.pending')).toBe(key);
    document.body.innerHTML = panel.html();
    panel.bind(document.body);
    document.querySelector<HTMLButtonElement>('[data-subscription-mount-claim]')!.click();
    await vi.waitFor(() =>
      expect(localStorage.getItem('woc.subscription.41.game_annual.pending')).toBeNull(),
    );
    expect(document.body.textContent).toContain('delivered by mail');
    expect(link).toHaveBeenCalledTimes(1);
  });
  it('mints a new checkout key on every click, across refreshes and panel instances', async () => {
    runtime.desktop = true;
    vi.spyOn(window, 'open').mockReturnValue(null);
    const link = vi.fn(async (_action: string, _key: string) => ({ ok: false, url: null }));
    const hooks: SubscriptionStoreHooks = {
      snapshot: async () => ({
        ...SUBSCRIPTION_OFF,
        available: true,
        accountId: 41,
        canCheckout: true,
      }),
      link,
    };
    let panel = panelWith(hooks);
    for (let attempt = 0; attempt < 3; attempt++) {
      await panel.refresh();
      document.body.innerHTML = panel.html();
      panel.bind(document.body);
      document.querySelector<HTMLButtonElement>('[data-subscription-action="checkout"]')!.click();
      await vi.waitFor(() => expect(link).toHaveBeenCalledTimes(attempt + 1));
      if (attempt === 1) panel = panelWith(hooks);
    }
    expect(new Set(link.mock.calls.map((call) => call[1])).size).toBe(3);
  });
  it('lets a live member stack a year onto their membership through checkout', async () => {
    runtime.desktop = true;
    const now = Math.floor(Date.now() / 1000);
    const link = vi.fn(async () => ({ ok: true, url: 'https://checkout.stripe.com/c/pay/stack' }));
    const panel = panelWith({
      snapshot: async () => ({
        ...SUBSCRIPTION_OFF,
        available: true,
        accountId: 41,
        status: 'active',
        plan: 'game_monthly',
        plans: Object.values(GAME_SUBSCRIPTION_PLANS),
        trialEligible: false,
        trialDays: 7,
        currentPeriodEnd: now + 10 * 86_400,
        canStack: true,
        stackLimit: now + 730 * 86_400,
        canManage: true,
      }),
      link,
    });
    vi.spyOn(window, 'open').mockReturnValue(null);
    await panel.refresh();
    document.body.innerHTML = panel.html();
    panel.bind(document.body);
    const annual = document.querySelector<HTMLButtonElement>(
      '[data-subscription-checkout-plan="game_annual"]',
    )!;
    expect(annual.textContent).toBe('Add 12 months');
    annual.click();
    await vi.waitFor(() =>
      expect(link).toHaveBeenCalledWith('checkout', expect.any(String), 'game_annual'),
    );
  });
  it('offers a new subscription after cancellation even when the account has a billing customer', async () => {
    const panel = panelWith({
      snapshot: async () => ({
        ...SUBSCRIPTION_OFF,
        available: true,
        accountId: 41,
        status: 'canceled',
        canCheckout: true,
        canManage: true,
      }),
      link: vi.fn(),
    });
    await panel.refresh();
    document.body.innerHTML = panel.html();
    expect(
      document
        .querySelector('[data-subscription-action]')
        ?.getAttribute('data-subscription-action'),
    ).toBe('checkout');
  });
  it('opens the validated Stripe URL through the desktop shell without a blank window', async () => {
    runtime.desktop = true;
    const url = 'https://checkout.stripe.com/c/pay/cs_test_1';
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const panel = panelWith({
      snapshot: async () => ({
        ...SUBSCRIPTION_OFF,
        available: true,
        accountId: 41,
        canCheckout: true,
      }),
      link: async () => ({ ok: true, url }),
    });
    await panel.refresh();
    document.body.innerHTML = panel.html();
    panel.bind(document.body);
    document.querySelector<HTMLButtonElement>('button')!.click();
    await vi.waitFor(() =>
      expect(open).toHaveBeenCalledExactlyOnceWith(url, '_blank', 'noopener,noreferrer'),
    );
  });
  it('re-enables the replacement control when a store repaint happens during checkout', async () => {
    let done!: (value: { ok: boolean; url: null }) => void;
    const panel = panelWith({
      snapshot: async () => ({
        ...SUBSCRIPTION_OFF,
        available: true,
        accountId: 41,
        canCheckout: true,
      }),
      link: () =>
        new Promise((resolve) => {
          done = resolve;
        }),
    });
    vi.spyOn(window, 'open').mockReturnValue({ opener: null, close: vi.fn() } as unknown as Window);
    await panel.refresh();
    document.body.innerHTML = panel.html();
    panel.bind(document.body);
    document.querySelector<HTMLButtonElement>('button')!.click();
    document.body.innerHTML = panel.html();
    panel.bind(document.body);
    const replacement = document.querySelector<HTMLButtonElement>('button')!;
    expect(replacement.disabled).toBe(true);
    done({ ok: false, url: null });
    await vi.waitFor(() => expect(replacement.disabled).toBe(false));
  });
  it('hides unsupported service state and coalesces concurrent status requests', async () => {
    let done!: (value: typeof SUBSCRIPTION_OFF) => void;
    const snapshot = vi.fn(
      () =>
        new Promise<typeof SUBSCRIPTION_OFF>((resolve) => {
          done = resolve;
        }),
    );
    const panel = panelWith({ snapshot, link: vi.fn() });
    expect(panel.html()).toBe('');
    const first = panel.refresh();
    expect(panel.refresh()).toBe(first);
    await Promise.resolve();
    expect(snapshot).toHaveBeenCalledTimes(1);
    done({ ...SUBSCRIPTION_OFF });
    await first;
    expect(panel.html()).toBe('');
  });
  it('shows the recurring fiat price and manages existing subscriptions', async () => {
    const panel = panelWith({
      snapshot: async () => ({
        ...SUBSCRIPTION_OFF,
        available: true,
        accountId: 41,
        status: 'active',
        canManage: true,
        cancelAtPeriodEnd: true,
      }),
      link: vi.fn(),
    });
    await panel.refresh();
    document.body.innerHTML = panel.html();
    expect(document.body.textContent).toContain('$5.00 per month');
    expect(document.body.textContent).toContain('Renews monthly');
    expect(document.body.textContent).toContain('Cancels at the end');
    expect(
      document
        .querySelector('[data-subscription-action]')
        ?.getAttribute('data-subscription-action'),
    ).toBe('portal');
  });
  it('retries with a fresh checkout and never marks the account active from a redirect', async () => {
    const link = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, url: null })
      .mockResolvedValueOnce({ ok: true, url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    const panel = panelWith({
      snapshot: async () => ({
        ...SUBSCRIPTION_OFF,
        available: true,
        accountId: 41,
        canCheckout: true,
      }),
      link,
    });
    const tab = { opener: {}, close: vi.fn(), location: { replace: vi.fn() } };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    await panel.refresh();
    document.body.innerHTML = panel.html();
    panel.bind(document.body);
    const button = document.querySelector<HTMLButtonElement>('button')!;
    button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(open).not.toHaveBeenCalled();
    button.click();
    await vi.waitFor(() =>
      expect(open).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_1', '_blank'),
    );
    expect(link.mock.calls[0][1]).not.toBe(link.mock.calls[1][1]);
    expect(tab.opener).toBeNull();
    expect(panel.html()).toContain('Not subscribed');
  });
  it.each([false, true])(
    'embeds checkout in the game with no tab or popup (desktop %s)',
    async (desktop) => {
      runtime.desktop = desktop;
      const intent = { clientSecret: 'cs_test_1_secret_x', publishableKey: 'pk_test_1' };
      const link = vi.fn(async () => ({ ok: true, url: null, stripe: intent }));
      const completed = vi.fn();
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      const panel = new StoreSubscription(() => hooks);
      const hooks: SubscriptionStoreHooks = {
        snapshot: async () => ({
          ...SUBSCRIPTION_OFF,
          available: true,
          accountId: 41,
          canCheckout: true,
        }),
        link,
      };
      await panel.refresh();
      document.body.innerHTML = panel.html();
      panel.bind(document.body, completed);
      const button = document.querySelector<HTMLButtonElement>('button')!;
      button.click();
      await vi.waitFor(() => expect(stripe.open).toHaveBeenCalledOnce());
      expect(stripe.open.mock.calls[0][0]).toEqual(intent);
      expect(open).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(button.disabled).toBe(false));
      expect(document.querySelector('[data-subscription-error]')?.textContent ?? '').toBe('');
      stripe.open.mock.calls[0][2]?.onComplete?.();
      expect(completed).toHaveBeenCalledOnce();
    },
  );
  it('reports a blocked tab only for a hosted checkout link', async () => {
    const link = vi.fn(async () => ({
      ok: true,
      url: 'https://checkout.stripe.com/c/pay/cs_test_1',
    }));
    vi.spyOn(window, 'open').mockReturnValue(null);
    const panel = panelWith({
      snapshot: async () => ({
        ...SUBSCRIPTION_OFF,
        available: true,
        accountId: 41,
        canCheckout: true,
      }),
      link,
    });
    await panel.refresh();
    document.body.innerHTML = panel.html();
    panel.bind(document.body);
    document.querySelector<HTMLButtonElement>('button')!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Allow popups'));
    expect(link).toHaveBeenCalledOnce();
    expect(stripe.open).not.toHaveBeenCalled();
  });
  it('buys a token through embedded checkout without opening a tab', async () => {
    const intent = { clientSecret: 'cs_test_2_secret_x', publishableKey: 'pk_test_1' };
    const tokenCheckout = vi.fn(async (_key: string) => ({ ok: true, url: null, stripe: intent }));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const panel = panelWith({
      snapshot: async () => ({ ...SUBSCRIPTION_OFF }),
      link: vi.fn(),
      tokenOffer: async () => ({
        available: true,
        accountId: 41,
        canCheckout: true,
        days: 30,
        price: { currency: 'usd', unitAmount: 500 },
      }),
      tokenCheckout,
    });
    await panel.refresh();
    document.body.innerHTML = panel.html();
    panel.bind(document.body);
    document.querySelector<HTMLButtonElement>('[data-membership-purchase-action="buy"]')!.click();
    await vi.waitFor(() => expect(stripe.open).toHaveBeenCalledOnce());
    expect(stripe.open.mock.calls[0][0]).toEqual(intent);
    expect(open).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(document.querySelector('[data-membership-token-status]')?.textContent).not.toContain(
        'Allow popups',
      ),
    );
  });
  it('buys a tradable token with a stable intent and collects mail only after verified delivery', async () => {
    runtime.desktop = true;
    localStorage.clear();
    const tokenCheckout = vi.fn(async (_key: string) => ({
      ok: true,
      url: 'https://checkout.stripe.com/c/pay/token',
    }));
    const tokenClaim = vi
      .fn()
      .mockResolvedValueOnce({ delivered: false })
      .mockResolvedValueOnce({ delivered: true });
    const hooks: SubscriptionStoreHooks = {
      snapshot: async () => ({ ...SUBSCRIPTION_OFF }),
      link: vi.fn(),
      tokenOffer: async () => ({
        available: true,
        accountId: 41,
        canCheckout: true,
        days: 30,
        price: { currency: 'usd', unitAmount: 500 },
      }),
      tokenCheckout,
      tokenClaim,
    };
    vi.spyOn(window, 'open').mockReturnValue(null);
    let panel = panelWith(hooks);
    await panel.refresh();
    document.body.innerHTML = panel.html();
    panel.bind(document.body);
    document.querySelector<HTMLButtonElement>('[data-membership-purchase-action="buy"]')!.click();
    await vi.waitFor(() => expect(tokenCheckout).toHaveBeenCalledTimes(1));
    const key = tokenCheckout.mock.calls[0][0];
    expect(localStorage.getItem('woc.membership-token.pending')).toBe(key);
    // A reload restores the purchase intent; it never starts another paid checkout.
    panel = panelWith(hooks);
    await panel.refresh();
    document.body.innerHTML = panel.html();
    panel.bind(document.body);
    const collect = document.querySelector<HTMLButtonElement>(
      '[data-membership-purchase-action="claim"]',
    )!;
    collect.click();
    await vi.waitFor(() => expect(collect.disabled).toBe(false));
    expect(tokenClaim).toHaveBeenLastCalledWith(key);
    expect(localStorage.getItem('woc.membership-token.pending')).toBe(key);
    collect.click();
    await vi.waitFor(() => expect(localStorage.getItem('woc.membership-token.pending')).toBeNull());
    expect(tokenClaim).toHaveBeenLastCalledWith(key);
    expect(tokenCheckout).toHaveBeenCalledTimes(1);
  });
});
