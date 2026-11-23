import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { createReferralCardsHud } from '../../src/ui/hud/referral_cards/referral_cards_hud_controller';
import type { IWorld } from '../../src/world_api';
import { cleanup } from './_harness';

let controller: ReturnType<typeof createReferralCardsHud> | null = null;
afterEach(async () => {
  controller?.destroy();
  controller = null;
  cleanup();
  document.body.className = '';
  await page.viewport(1280, 800);
});

it.each([
  [1280, 800],
  [390, 844],
  [844, 390],
])('claims Friendship armour from the stamp menu at %sx%s', async (width, height) => {
  await page.viewport(width, height);
  document.body.className = width === 1280 ? 'game-active' : 'game-active mobile-touch';
  document.documentElement.style.setProperty('--app-vw', `${width}px`);
  document.documentElement.style.setProperty('--app-vh', `${height}px`);
  document.documentElement.style.setProperty('--ui-scale', '1');
  document.body.innerHTML =
    '<div id="ui"><button id="mm-social"></button><div id="prompt-stack"></div></div>';
  const snapshot = {
    revision: 1,
    accountId: 10,
    characterId: 100,
    characterName: 'Aster',
    inviteUrl: 'https://example.test/?ref=aster',
    links: [],
    completedFriends: 0,
    rewardedTiers: [],
    notices: [],
  };
  const claim = vi.fn();
  const world = {
    player: { membershipActive: false, referralInviterName: 'Briar' },
    claimMembershipArmour: claim,
    referralCardsSnapshot: () => snapshot,
    referralCardsAction: vi.fn(),
  };
  controller = createReferralCardsHud({
    world: () => world as unknown as IWorld,
    focus: { captureFocus: () => null, restoreFocus: vi.fn() },
    focusFirst: (root) => root.querySelector<HTMLButtonElement>('button')?.focus(),
    closeOthers: vi.fn(),
    visibilityChanged: vi.fn(),
    snapshotChanged: vi.fn(),
  });
  controller.open();
  const root = document.getElementById('referral-cards-window')!;
  const button = root.querySelector<HTMLButtonElement>(
    '.referral-invite .friendship-armour-claim',
  )!;
  expect(button).not.toBeNull();
  button.focus();
  snapshot.revision++;
  controller.update();
  const refreshed = root.querySelector<HTMLButtonElement>('.friendship-armour-claim')!;
  expect(document.activeElement).toBe(refreshed);
  await userEvent.keyboard('{Enter}');
  expect(claim).toHaveBeenCalledOnce();
  const bounds = refreshed.getBoundingClientRect();
  expect(bounds.height).toBeGreaterThanOrEqual(40);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(width);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(height);
  expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
  const forcedColors = matchMedia('(forced-colors: active)').matches;
  await page.screenshot({
    path: `../../docs/screenshots/referral-armour/stamp-menu-${forcedColors ? 'forced-' : ''}${width}x${height}.png`,
  });
});
