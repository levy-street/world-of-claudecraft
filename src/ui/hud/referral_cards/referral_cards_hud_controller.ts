import type { IWorld } from '../../../world_api';
import { createFriendshipArmourClaim } from '../../friendship_armour_claim';
import { svgIcon } from '../../ui_icons';
import type { WindowFocusBridge } from '../../window_focus';
import { ReferralCardsController } from './referral_cards_controller';

/** Page-lifetime composition; the HUD owns cadence, window stacking and focus. */
export function createReferralCardsHud(deps: {
  world(): IWorld;
  focus: WindowFocusBridge;
  focusFirst(root: HTMLElement): void;
  closeOthers(): void;
  visibilityChanged(): void;
  snapshotChanged(): void;
  playReward?(): void;
}): ReferralCardsController {
  const root = document.createElement('div');
  root.classList.add('panel');
  document.getElementById('ui')!.append(root);
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.id = 'mm-referral-cards';
  launcher.hidden = true;
  launcher.className = 'micro-btn ui-icon-btn ui-icon-btn--micro';
  launcher.innerHTML = svgIcon('cards');
  document.getElementById('mm-social')!.before(launcher);
  const mobile = document.createElement('button');
  mobile.type = 'button';
  mobile.id = 'mobile-referral-cards';
  mobile.className = 'mobile-btn';
  mobile.hidden = true;
  mobile.innerHTML = `${svgIcon('cards')}<span class="mobile-label"></span>`;
  const mountMobile = () => {
    if (!mobile.isConnected) document.getElementById('mobile-extra-grid')?.append(mobile);
  };
  mountMobile();
  let opener: HTMLElement | null = null;
  return new ReferralCardsController({
    root,
    launcher,
    extraLaunchers: [mobile],
    promptStack: document.getElementById('prompt-stack')!,
    getSnapshot: () => {
      mountMobile();
      return deps.world().referralCardsSnapshot();
    },
    send: (action) => deps.world().referralCardsAction(action),
    friendshipArmour: {
      inviterName: () => deps.world().player?.referralInviterName ?? null,
      create: () => createFriendshipArmourClaim(deps.world),
    },
    onSnapshotChange: () => deps.snapshotChanged(),
    playReward: () => deps.playReward?.(),
    beforeOpen: () => {
      if (document.body.classList.contains('mobile-more-open')) {
        document.body.classList.remove('mobile-more-open');
        document.getElementById('mobile-controls')?.classList.remove('expanded');
        document.getElementById('mobile-more')?.classList.remove('active');
        document.getElementById('mobile-menu-anchor')?.focus();
      }
      opener = deps.focus.captureFocus();
      // Social closes as this window opens, so return to its visible HUD entry.
      if (opener?.closest('#social-window')) {
        opener = document.getElementById(
          document.body.classList.contains('mobile-touch') ? 'mobile-menu-anchor' : 'mm-social',
        );
      }
      if (opener?.closest('#mobile-extra-controls')) {
        opener = document.getElementById('mobile-menu-anchor');
      }
      deps.closeOthers();
      deps.world().referralCardsAction({ type: 'page' });
    },
    focusWindow: () => {
      deps.visibilityChanged();
      deps.focusFirst(root);
    },
    onClose: () => {
      deps.focus.restoreFocus(opener);
      opener = null;
      deps.visibilityChanged();
    },
  });
}
