import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import type { SubscriptionStoreHooks } from '../../src/subscription_contract';
import { renderAccountBank } from '../../src/ui/account_bank_window';
import { StoreSubscription } from '../../src/ui/store_subscription';
import type { IWorld } from '../../src/world_api';
import { cleanup, host, stubDeps } from './_harness';

afterEach(async () => {
  cleanup();
  document.body.className = '';
  await page.viewport(1280, 800);
});

it('keeps membership claim and every character tab reachable on a short landscape phone', async () => {
  await page.viewport(844, 390);
  document.body.className = 'mobile-touch game-active';
  document.documentElement.style.setProperty('--app-width', '844px');
  document.documentElement.style.setProperty('--app-height', '390px');
  document.documentElement.style.setProperty('--ui-scale', '1');
  const root = host('bank-window');
  root.style.display = 'flex';
  const world = {
    player: { membershipActive: true },
    inventory: [],
    accountBankInfo: {
      characters: Array.from({ length: 19 }, (_, i) => ({
        characterId: i + 2,
        name: `Character ${i + 1}`,
      })),
      selectedCharacterId: null,
      bank: null,
    },
  };
  renderAccountBank(root, stubDeps({ world: () => world as unknown as IWorld }), () => {});
  const claim = root.querySelector<HTMLElement>('[data-focus-key="account-armour"]')!;
  expect(claim.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
  const tabs = root.querySelector<HTMLElement>('.account-bank-panel .bank-tabs')!;
  expect(getComputedStyle(tabs).overflowX).toBe('auto');
  expect(tabs.getBoundingClientRect().right).toBeLessThanOrEqual(
    root.getBoundingClientRect().right,
  );
  expect(tabs.scrollWidth).toBeGreaterThan(tabs.clientWidth);
  for (const tab of tabs.querySelectorAll<HTMLElement>('.account-bank-tab')) {
    expect(tab.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
  }
});

it('keeps both membership token purchase controls touch sized', async () => {
  await page.viewport(844, 390);
  document.body.className = 'mobile-touch game-active';
  const hooks = {
    snapshot: async () => ({ available: false }),
    tokenOffer: async () => ({
      available: true,
      canCheckout: true,
      days: 30,
      price: { currency: 'usd', unitAmount: 500 },
    }),
  } as unknown as SubscriptionStoreHooks;
  const store = new StoreSubscription(() => hooks);
  await store.refresh();
  const root = host('daily-rewards-window');
  root.innerHTML = store.html();
  const controls = root.querySelectorAll<HTMLElement>('[data-membership-purchase-action]');
  expect(controls.length).toBe(2);
  for (const control of controls)
    expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
});
