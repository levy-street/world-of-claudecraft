// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ desktop: false }));
vi.mock('../src/client_origin', () => ({
  get DESKTOP_APP() {
    return runtime.desktop;
  },
}));

import { SUBSCRIPTION_OFF, type SubscriptionStoreHooks } from '../src/subscription_contract';
import { StoreSubscription } from '../src/ui/store_subscription';

afterEach(() => {
  vi.restoreAllMocks();
  runtime.desktop = false;
  document.body.innerHTML = '';
});
function panelWith(hooks: SubscriptionStoreHooks) {
  return new StoreSubscription(() => hooks);
}
describe('subscription store section', () => {
  it('opens the validated Stripe URL through the desktop shell without a blank window', async () => {
    runtime.desktop = true;
    const url = 'https://checkout.stripe.com/c/pay/cs_test_1';
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const panel = panelWith({
      snapshot: async () => ({ ...SUBSCRIPTION_OFF, available: true, canCheckout: true }),
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
      snapshot: async () => ({ ...SUBSCRIPTION_OFF, available: true, canCheckout: true }),
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
  it('retries the same checkout intent and never marks the account active from a redirect', async () => {
    const link = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, url: null })
      .mockResolvedValueOnce({ ok: true, url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    const panel = panelWith({
      snapshot: async () => ({ ...SUBSCRIPTION_OFF, available: true, canCheckout: true }),
      link,
    });
    const tab = { opener: {}, close: vi.fn(), location: { replace: vi.fn() } };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    await panel.refresh();
    document.body.innerHTML = panel.html();
    panel.bind(document.body);
    const button = document.querySelector<HTMLButtonElement>('button')!;
    button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    button.click();
    await vi.waitFor(() => expect(tab.location.replace).toHaveBeenCalled());
    expect(link.mock.calls[0]).toEqual(link.mock.calls[1]);
    expect(tab.opener).toBeNull();
    expect(panel.html()).toContain('Not subscribed');
  });
  it('does not create checkout when the browser blocks the tab', async () => {
    const link = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue(null);
    const panel = panelWith({
      snapshot: async () => ({ ...SUBSCRIPTION_OFF, available: true, canCheckout: true }),
      link,
    });
    await panel.refresh();
    document.body.innerHTML = panel.html();
    panel.bind(document.body);
    document.querySelector<HTMLButtonElement>('button')!.click();
    expect(link).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Allow popups');
  });
});
