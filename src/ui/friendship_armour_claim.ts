import type { IWorld } from '../world_api';
import { FOCUS_KEY_ATTR } from './focus_restore';
import { t } from './i18n';

/** Referral-screen recovery control; the existing world command owns eligibility. */
export function createFriendshipArmourClaim(
  world: () => Pick<IWorld, 'player' | 'claimMembershipArmour'>,
): HTMLButtonElement | null {
  if (!world().player?.referralInviterName) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ui-btn friendship-armour-claim';
  button.setAttribute(FOCUS_KEY_ATTR, 'friendship-armour');
  button.textContent = t('hudChrome.bank.referralArmour');
  button.addEventListener('click', () => {
    const current = world();
    if (current.player?.referralInviterName) current.claimMembershipArmour();
  });
  return button;
}
