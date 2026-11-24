// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/armory_inspect', () => ({
  ArmoryInspect: class {},
  badgeLabel: () => '',
  rarityLabel: () => '',
  weaponTypeLabel: () => '',
}));
vi.mock('../src/ui/mount_inspect_controller', () => ({ MountInspect: class {} }));
vi.mock('../src/ui/portrait_chip', () => ({
  hydratePortraits: () => {},
  portraitChipHtml: () => '',
}));

import {
  GAME_SUBSCRIPTION_PLANS,
  SUBSCRIPTION_OFF,
  type SubscriptionSnapshot,
  type SubscriptionStoreHooks,
} from '../src/subscription_contract';
import { DailyRewardsWindow } from '../src/ui/daily_rewards_window';
import type { IWorld } from '../src/world_api';

const windows: DailyRewardsWindow[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  for (const store of windows.splice(0)) store.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  localStorage.clear();
});

function harness() {
  let state: SubscriptionSnapshot = {
    ...SUBSCRIPTION_OFF,
    available: true,
    accountId: 41,
    plans: Object.values(GAME_SUBSCRIPTION_PLANS),
    canManage: true,
  };
  const snapshot = vi.fn(async () => state);
  const tokenOffer = vi.fn();
  const annualMountClaim = vi.fn();
  const tokenClaim = vi.fn();
  const link = vi.fn();
  let hooks: SubscriptionStoreHooks = { snapshot, tokenOffer, annualMountClaim, tokenClaim, link };
  const root = document.createElement('div');
  document.body.append(root);
  const store = new DailyRewardsWindow({
    root: () => root,
    world: () => ({ player: {}, accountCosmetics: {} }) as IWorld,
    closeOthers: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    storeEnabled: () => true,
    subscriptionHooks: () => hooks,
    storeSnapshot: async () => ({ available: false, balance: null, items: [] }),
  });
  windows.push(store);
  return {
    store,
    root,
    snapshot,
    tokenOffer,
    annualMountClaim,
    tokenClaim,
    link,
    setState: (next: Partial<SubscriptionSnapshot>) => {
      state = { ...state, ...next };
    },
    setHooks: (next: SubscriptionStoreHooks) => {
      hooks = next;
    },
  };
}

describe('Memberships status refresh', () => {
  it('shows a delayed confirmation without reopening, with status-only reads every 15 seconds', async () => {
    const h = harness();
    localStorage.setItem('woc.subscription.41.game_annual.pending', 'pending-annual-intent');
    h.annualMountClaim.mockResolvedValue({ delivered: false });
    h.store.openStore('memberships');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.root.textContent).toContain('Checkout pending');
    expect(h.root.textContent).not.toContain('Update your payment details');
    expect(h.annualMountClaim).toHaveBeenCalledExactlyOnceWith('pending-annual-intent');
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(15_000);
    h.setState({
      status: 'trialing',
      plan: 'game_monthly',
      canStack: true,
      stackLimit: 2_000_000_000,
      currentPeriodEnd: 1_900_000_000,
    });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.root.textContent).toContain('Upgrade to 12 months');
    expect(h.root.textContent).not.toContain('Checkout pending');
    expect(h.snapshot).toHaveBeenCalledTimes(22);
    expect(h.tokenOffer).toHaveBeenCalledTimes(1);
    expect(h.annualMountClaim).toHaveBeenCalledTimes(1);
    expect(h.link).not.toHaveBeenCalled();
  });

  it('keeps annual discovery and pending token delivery on entry, outside status polls', async () => {
    localStorage.setItem('woc.membership-token.pending', 'pending-token-intent');
    const h = harness();
    h.setState({ status: 'active', plan: 'game_annual', canStack: true });
    h.annualMountClaim.mockResolvedValue({ delivered: false });
    h.tokenClaim.mockResolvedValue({ delivered: false });
    h.store.openStore('memberships');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.annualMountClaim).toHaveBeenCalledExactlyOnceWith();
    expect(h.tokenClaim).toHaveBeenCalledExactlyOnceWith('pending-token-intent');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.snapshot).toHaveBeenCalledTimes(5);
    expect(h.annualMountClaim).toHaveBeenCalledTimes(1);
    expect(h.tokenClaim).toHaveBeenCalledTimes(1);
  });

  it('performs a full entry refresh after reopening during an outstanding status poll', async () => {
    localStorage.setItem('woc.subscription.41.game_annual.pending', 'pending-annual-intent');
    const h = harness();
    h.annualMountClaim.mockResolvedValue({ delivered: false });
    h.store.openStore('memberships');
    await vi.advanceTimersByTimeAsync(0);
    let resolve!: (state: SubscriptionSnapshot) => void;
    h.snapshot.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await vi.advanceTimersByTimeAsync(15_000);
    h.store.close();
    h.store.openStore('memberships');
    await vi.advanceTimersByTimeAsync(0);
    h.store.openStore('memberships');
    await vi.advanceTimersByTimeAsync(0);
    resolve({ ...SUBSCRIPTION_OFF, available: true, accountId: 41 });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.snapshot).toHaveBeenCalledTimes(3);
    expect(h.tokenOffer).toHaveBeenCalledTimes(2);
    expect(h.annualMountClaim).toHaveBeenCalledTimes(2);
  });

  it('keeps identical DOM, keyboard focus and scroll across unchanged polls and failed reads', async () => {
    const h = harness();
    h.store.openStore('memberships');
    await vi.advanceTimersByTimeAsync(0);
    const body = h.root.querySelector<HTMLElement>('.dr-body')!;
    const manage = body.querySelector<HTMLButtonElement>('[data-subscription-action="portal"]')!;
    manage.focus();
    body.scrollTop = 180;
    await vi.advanceTimersByTimeAsync(15_000);
    h.snapshot.mockRejectedValueOnce(new Error('offline'));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(body.querySelector('[data-subscription-action="portal"]')).toBe(manage);
    expect(document.activeElement).toBe(manage);
    expect(body.scrollTop).toBe(180);
  });

  it('does not read status while hidden, on another tab, or after closing', async () => {
    const h = harness();
    h.store.openStore('memberships');
    await vi.advanceTimersByTimeAsync(0);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.snapshot).toHaveBeenCalledTimes(1);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    h.store.openStore('store');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.snapshot).toHaveBeenCalledTimes(1);
    h.store.close();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.snapshot).toHaveBeenCalledTimes(1);
  });

  it('holds the poll during a purchase request and while embedded checkout is open', async () => {
    const h = harness();
    h.setState({ canCheckout: true });
    let resolve!: (value: unknown) => void;
    h.link.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    h.store.openStore('memberships');
    await vi.advanceTimersByTimeAsync(0);
    h.root
      .querySelector<HTMLButtonElement>('[data-subscription-checkout-plan="game_monthly"]')!
      .click();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.link).toHaveBeenCalledTimes(1);
    expect(h.snapshot).toHaveBeenCalledTimes(1);
    resolve({ ok: false, url: null });
    await vi.advanceTimersByTimeAsync(0);
    const overlay = document.createElement('div');
    overlay.id = 'stripe-checkout-overlay';
    document.body.append(overlay);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.snapshot).toHaveBeenCalledTimes(1);
    overlay.remove();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.snapshot).toHaveBeenCalledTimes(2);
  });

  it('preserves focus and scroll when a confirmation replaces pending controls', async () => {
    const h = harness();
    h.store.openStore('memberships');
    await vi.advanceTimersByTimeAsync(0);
    const body = h.root.querySelector<HTMLElement>('.dr-body')!;
    body.querySelector<HTMLButtonElement>('[data-subscription-action="portal"]')!.focus();
    const announcement = h.root.querySelector('[data-membership-announcement]')!;
    expect(announcement.getAttribute('role')).toBe('status');
    expect(announcement.textContent).toContain('Checkout pending');
    body.scrollTop = 140;
    h.setState({
      status: 'active',
      canStack: true,
      stackLimit: 2_000_000_000,
      currentPeriodEnd: 1_900_000_000,
    });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(body.textContent).toContain('Add 12 months');
    expect(document.activeElement).toBe(body.querySelector('[data-subscription-action="portal"]'));
    expect(body.scrollTop).toBe(140);
    expect(h.root.querySelector('[data-membership-announcement]')).toBe(announcement);
    expect(announcement.textContent).toBe('Active');
  });

  it('does not repaint a closed store when an in-flight status read finishes', async () => {
    const h = harness();
    h.store.openStore('memberships');
    await vi.advanceTimersByTimeAsync(0);
    const markup = h.root.innerHTML;
    let resolve!: (state: SubscriptionSnapshot) => void;
    h.snapshot.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await vi.advanceTimersByTimeAsync(15_000);
    h.store.close();
    resolve({ ...SUBSCRIPTION_OFF, available: true, canCheckout: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.snapshot).toHaveBeenCalledTimes(2);
    // Loading indicators may change when closing; the membership controls stay pending.
    expect(h.root.textContent).toContain('Checkout pending');
    expect(h.root.querySelector('[data-subscription-action="checkout"]')).toBeNull();
    expect(markup).toContain('Checkout pending');
  });

  it('coalesces slow reads and ignores an old account response', async () => {
    const h = harness();
    h.store.openStore('memberships');
    await vi.advanceTimersByTimeAsync(0);
    let resolve!: (state: SubscriptionSnapshot) => void;
    h.snapshot.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await vi.advanceTimersByTimeAsync(45_000);
    expect(h.snapshot).toHaveBeenCalledTimes(2);
    const newSnapshot = vi.fn(async () => ({
      ...SUBSCRIPTION_OFF,
      available: true,
      accountId: 42,
      canCheckout: true,
    }));
    h.setHooks({ snapshot: newSnapshot, link: vi.fn() });
    resolve({
      ...SUBSCRIPTION_OFF,
      available: true,
      accountId: 41,
      status: 'active',
      canStack: true,
      stackLimit: 2_000_000_000,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.root.textContent).not.toContain('Add 12 months');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(newSnapshot).toHaveBeenCalledTimes(1);
    expect(h.root.textContent).toContain('Subscribe');
  });

  it('drops a previous account token offer when the same hooks return a new account', async () => {
    const h = harness();
    h.tokenOffer.mockResolvedValue({
      available: true,
      canCheckout: true,
      days: 30,
      price: { currency: 'usd', unitAmount: 500 },
    });
    h.store.openStore('memberships');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.root.querySelector('[data-membership-purchase-action="buy"]')).not.toBeNull();
    h.setState({ accountId: 42, canCheckout: true });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.root.querySelector('[data-membership-purchase-action="buy"]')).toBeNull();
    expect(h.tokenOffer).toHaveBeenCalledTimes(1);
  });
});
