import { REFERRAL_STAMP_ITEMS } from '../../../sim/content/referral_rewards';
import type { ReferralMilestone } from '../../../sim/referral_cards';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { itemImageUrl } from '../../icons';
import { svgIcon } from '../../ui_icons';
import { referralText } from './referral_cards_window';
import type { ReferralRewardClaim } from './referral_reward_core';

const REWARD_ITEMS: Partial<Record<ReferralMilestone, string>> = {
  tutorial: 'referral_satchel',
  hollow: 'referral_hollow_charm',
  fogbinder: 'referral_fog_charm',
  raid: 'reins_referral_tank',
};

/** One finite CSS reveal; no animation loop, timers, random particles or automatic dismissal. */
export function referralRewardCelebration(claim: ReferralRewardClaim): HTMLElement {
  const root = document.createElement('div');
  root.className = 'prompt referral-prompt referral-celebration';
  const itemId = REWARD_ITEMS[claim.milestone];
  const art = itemId && itemImageUrl(itemId);
  const rewardName = itemId
    ? itemDisplayName(REFERRAL_STAMP_ITEMS[itemId])
    : referralText('rewards.gravewyrm');
  root.innerHTML = `<div class="referral-celebration-sparks" aria-hidden="true">${Array.from({ length: 12 }, () => '<i></i>').join('')}</div>
    <p class="referral-celebration-eyebrow">${esc(referralText('celebration.earned'))}</p>
    <h2 class="prompt-text">${esc(referralText('celebration.title'))}</h2>
    <div class="referral-celebration-art" aria-hidden="true">${art ? `<img src="${esc(art)}" alt="">` : svgIcon('mount')}<span class="referral-celebration-seal">${svgIcon('check')}</span></div>
    <h3 class="referral-celebration-name">${esc(rewardName)}</h3>
    ${claim.milestone === 'tutorial' ? `<p>${esc(referralText('celebration.titleReward', { title: referralText('trailmateTitle') }))}</p>` : ''}
    <p class="referral-celebration-milestone">${esc(referralText(`milestones.${claim.milestone}`))}</p>
    <p>${esc(referralText('celebration.together', { friend: claim.friendName }))}</p>`;
  return root;
}
