// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import type { ReferralCardsSnapshot } from '../src/ui/hud/referral_cards';
import { createReferralCardsHud } from '../src/ui/hud/referral_cards/referral_cards_hud_controller';
import type { IWorld } from '../src/world_api';

const controllers: ReturnType<typeof createReferralCardsHud>[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function setup(member = false) {
  document.body.innerHTML =
    '<div id="ui"><button id="mm-social"></button></div><div id="prompt-stack"></div>';
  let snapshot: ReferralCardsSnapshot | null = {
    revision: 1,
    accountId: 10,
    characterId: 100,
    characterName: 'Aster',
    inviteUrl: 'https://example.test/?ref=abc',
    links: [],
    completedFriends: 0,
    rewardedTiers: [],
    notices: [],
  };
  const world = {
    player: { membershipActive: member, referralInviterName: 'Briar' as string | null },
    claimMembershipArmour: vi.fn(),
    referralCardsSnapshot: () => snapshot,
    referralCardsAction: vi.fn(),
  };
  const controller = createReferralCardsHud({
    world: () => world as unknown as IWorld,
    focus: { captureFocus: () => null, restoreFocus: vi.fn() },
    focusFirst: (root) => root.querySelector<HTMLButtonElement>('button')?.focus(),
    closeOthers: vi.fn(),
    visibilityChanged: vi.fn(),
    snapshotChanged: vi.fn(),
  });
  controllers.push(controller);
  return {
    controller,
    world,
    snapshot,
    root: document.getElementById('referral-cards-window')!,
    replace: (value: ReferralCardsSnapshot | null) => {
      snapshot = value;
      controller.update();
    },
  };
}

it.each([false, true])(
  'places the explicit claim in the stamp menu for membership=%s',
  (member) => {
    const f = setup(member);
    f.controller.open();
    expect(f.world.claimMembershipArmour).not.toHaveBeenCalled();
    const button = f.root.querySelector<HTMLButtonElement>(
      '.referral-invite .friendship-armour-claim',
    )!;
    expect(button.textContent).toBe('Claim friendship armour');
    button.click();
    expect(f.world.claimMembershipArmour).toHaveBeenCalledOnce();
    expect(f.world.referralCardsAction).toHaveBeenCalledExactlyOnceWith({ type: 'page' });
  },
);

it('preserves claim focus across snapshot repaint and avoids unchanged-frame DOM work', () => {
  const f = setup();
  f.controller.open();
  f.root.querySelector<HTMLButtonElement>('.friendship-armour-claim')!.focus();
  f.replace({ ...f.snapshot!, revision: 2 });
  expect(document.activeElement).toBe(f.root.querySelector('.friendship-armour-claim'));
  const writes = vi.spyOn(f.root, 'innerHTML', 'set');
  const reads = vi.spyOn(f.root, 'querySelector');
  f.controller.update();
  f.controller.update();
  expect(writes).not.toHaveBeenCalled();
  expect(reads).not.toHaveBeenCalled();
});

it('refreshes eligibility without waiting for a stamp-card revision', () => {
  const f = setup();
  f.world.player.referralInviterName = null;
  f.controller.open();
  expect(f.root.querySelector('.friendship-armour-claim')).toBeNull();
  f.world.player.referralInviterName = 'Briar';
  f.controller.update();
  expect(f.root.querySelector('.friendship-armour-claim')).not.toBeNull();
  f.world.player.referralInviterName = null;
  f.controller.update();
  expect(f.root.querySelector('.friendship-armour-claim')).toBeNull();
});

it('keeps armour recovery available while the separate stamp-card snapshot is loading', () => {
  const f = setup();
  f.replace(null);
  f.controller.open();
  f.root.querySelector<HTMLButtonElement>('.friendship-armour-claim')!.click();
  expect(f.world.claimMembershipArmour).toHaveBeenCalledOnce();
});
