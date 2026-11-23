import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { REFERRAL_ITEMS } from '../../src/sim/content/referral';
import { createFriendshipArmourClaim } from '../../src/ui/friendship_armour_claim';
import { membershipItemTooltipLines } from '../../src/ui/membership_item_tooltip';
import type { IWorld } from '../../src/world_api';
import { cleanup, host } from './_harness';

afterEach(async () => {
  cleanup();
  document.body.className = '';
  await page.viewport(1280, 800);
});

it.each([
  [1280, 800],
  [390, 844],
  [844, 390],
])('keeps referral claims and the party condition readable at %sx%s', async (width, height) => {
  await page.viewport(width, height);
  document.body.className = 'mobile-touch game-active';
  document.documentElement.style.setProperty('--app-width', `${width}px`);
  document.documentElement.style.setProperty('--app-height', `${height}px`);
  document.documentElement.style.setProperty('--ui-scale', '1');
  const root = host('friendship-claim-fixture', 'panel');
  root.style.display = 'flex';
  const claim = vi.fn();
  const world = {
    player: { membershipActive: false, referralInviterName: 'Aldric' },
    accountBankInfo: null,
    claimMembershipArmour: claim,
  };
  const button = createFriendshipArmourClaim(() => world as unknown as IWorld)!;
  root.append(button);
  expect(button.textContent).toBe('Claim friendship armour');
  expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
  button.focus();
  expect(document.activeElement).toBe(button);
  button.click();
  expect(claim).toHaveBeenCalledOnce();
  const pane = document.createElement('div');
  root.append(pane);
  pane.insertAdjacentHTML(
    'beforeend',
    membershipItemTooltipLines(REFERRAL_ITEMS.referral_chest, {
      level: 20,
      referralInviterName: 'Aldric',
      membershipActive: false,
    }),
  );
  expect(pane.textContent).toContain('20% more experience while in a party with Aldric');
  expect(pane.textContent).toContain('Their membership must be active');
  expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth + 1);
  expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(width);
});
