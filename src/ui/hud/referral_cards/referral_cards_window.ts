import {
  REFERRAL_BUDDY_WHISTLE,
  REFERRAL_SLIME_REINS,
} from '../../../sim/content/referral_rewards';
import type { ReferralMilestone } from '../../../sim/referral_cards';
import { esc } from '../../esc';
import { focusKeyAttr } from '../../focus_restore';
import { formatNumber, type TranslationKey, t } from '../../i18n';
import { itemImageUrl } from '../../icons';
import { svgIcon, type UiIconName } from '../../ui_icons';
import { referralOwnParticipant, referralStampKey, referralStampRows } from './referral_cards_view';
import type { ReferralCardsSnapshot, ReferralLinkSnapshot } from './types';

export function referralText(key: string, values?: Record<string, string>): string {
  return t(`referralCards.${key}` as TranslationKey, values);
}

function button(key: string, action: string, label: string, extra = ''): string {
  return `<button type="button" class="ui-btn" data-referral-action="${action}"${focusKeyAttr(key)} ${extra}>${esc(label)}</button>`;
}

const STAMP_ART: Partial<Record<ReferralMilestone, string>> = {
  tutorial: 'referral_satchel',
  hollow: 'referral_hollow_charm',
  fogbinder: 'referral_fog_charm',
  raid: REFERRAL_SLIME_REINS,
};

function rewardArt(itemId: string | undefined, fallback: UiIconName): string {
  const image = itemId ? itemImageUrl(itemId) : null;
  return image
    ? `<img src="${esc(image)}" alt="" width="128" height="128" decoding="async">`
    : svgIcon(fallback);
}

export function referralCardsHtml(
  snapshot: ReferralCardsSnapshot | null,
  animated: ReadonlySet<string>,
): string {
  const head = `<header class="ui-win-head"><div class="referral-heading"><span class="referral-emblem" aria-hidden="true">${svgIcon('bond-link')}</span><div class="referral-heading-copy"><h2 class="ui-win-title" id="referral-cards-title">${esc(referralText('title'))}</h2><p class="ui-win-sub">${esc(referralText('subtitle'))}</p></div></div><button type="button" class="ui-x-btn" data-referral-action="close"${focusKeyAttr('close')} aria-label="${esc(referralText('close'))}">${svgIcon('close')}</button></header>`;
  if (!snapshot) return `${head}<div class="ui-win-body">${esc(referralText('loading'))}</div>`;
  const cards = snapshot.links.map((link) => cardHtml(link, snapshot, animated)).join('');
  const pages = `<nav class="referral-actions referral-pages" aria-label="${esc(referralText('pages'))}">${button('first-page', 'firstPage', referralText('firstPage'))}${snapshot.nextCursor != null ? button('next-page', 'nextPage', referralText('nextPage')) : ''}</nav>`;
  const invite = `<section class="referral-invite ui-card ui-card-tile"><div class="referral-section-heading">${svgIcon('mail')}<h3 class="ui-h">${esc(referralText('inviteTitle'))}</h3></div><p class="referral-invite-intro">${esc(referralText('inviteHelp'))}</p>${snapshot.inviteUrl ? `<label>${esc(referralText('inviteLabel'))}<input class="ui-input referral-link" readonly value="${esc(snapshot.inviteUrl)}"${focusKeyAttr('invite-url')}></label>` : `<p class="ui-muted">${esc(referralText('inviteUnavailable'))}</p>`}<p class="ui-muted">${esc(referralText('membership'))}</p></section>`;
  const tierArt = [
    'reins_referral_raptor',
    undefined,
    undefined,
    undefined,
    REFERRAL_BUDDY_WHISTLE,
  ];
  const tierIcons: UiIconName[] = ['mount', 'chest', 'market', 'market', 'sprout'];
  const tiers = [1, 2, 3, 4, 5]
    .map(
      (tier) =>
        `<li class="ui-card ui-card-tile referral-tier ${snapshot.rewardedTiers.includes(tier) ? 'is-awarded' : ''}"><span class="referral-tier-art" aria-hidden="true">${rewardArt(tierArt[tier - 1], tierIcons[tier - 1])}</span><div class="referral-tier-copy"><span class="ui-h">${esc(referralText('friendTier', { count: formatNumber(tier) }))}</span><span>${esc(referralText(`referrerRewards.${tier}`))}</span><span class="ui-muted">${esc(referralText(snapshot.rewardedTiers.includes(tier) ? 'awarded' : 'pending'))}</span></div></li>`,
    )
    .join('');
  return `${head}<div class="ui-win-body referral-body"><div class="referral-main">${cards || `<div class="referral-empty ui-card ui-card-tile"><span class="referral-empty-art" aria-hidden="true">${svgIcon('social')}</span><p>${esc(referralText('empty'))}</p></div>`}${pages}${invite}</div><aside class="referral-sidebar"><section class="referral-referrer ui-card ui-card-tile"><h3 class="ui-h">${esc(referralText('referrerTitle'))}</h3><p>${esc(referralText('referrerCount', { count: formatNumber(snapshot.completedFriends) }))}</p><ol class="referral-tiers">${tiers}</ol></section></aside></div>`;
}

function cardHtml(
  link: ReferralLinkSnapshot,
  snapshot: ReferralCardsSnapshot,
  animated: ReadonlySet<string>,
): string {
  const { card } = link;
  const own = referralOwnParticipant(link, snapshot.accountId);
  if (!own) return '';
  const friend = card.participants.find((p) => p.accountId !== snapshot.accountId)!;
  const name = own.characterName || referralText('unassigned');
  const friendName = friend.characterName || link.friendName;
  const lockedText = referralText(own.locked ? 'locked' : 'unlocked', { name });
  const lock = own.locked
    ? svgIcon('lock')
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 10V6a5 5 0 0 1 10 0h-2a3 3 0 0 0-6 0v4h10v12H4V10h2zm4 5v3h2v-3h-2z"/></svg>';
  const actions =
    card.status === 'idle'
      ? button(`start:${card.linkId}`, 'start', referralText('start'))
      : card.status === 'pending'
        ? `<p>${esc(referralText('waiting'))}</p>${card.accepted[card.participants.indexOf(own)] ? '' : button(`respond:${card.linkId}`, 'respond', referralText('accept'))}`
        : own.characterId !== snapshot.characterId
          ? button(`move:${card.linkId}`, 'move', referralText('move'))
          : '';
  const cooldown = Math.max(0, Math.ceil(link.summonRemainingSeconds));
  const summonText =
    cooldown > 0
      ? referralText('summonCooldown', {
          minutes: formatNumber(Math.floor(cooldown / 60)),
          seconds: formatNumber(cooldown % 60),
        })
      : referralText('summon');
  const rows = referralStampRows(own);
  const progress = `<div class="referral-progress"><strong>${formatNumber(rows.filter((stamp) => stamp.earned).length)}/${formatNumber(rows.length)}</strong><small>${esc(referralText('earned'))}</small></div>`;
  const stamps =
    card.status === 'active'
      ? rows
          .map((stamp) => {
            const stampKey = referralStampKey(card.linkId, own.characterId!, stamp.id);
            const isAnimating = stamp.earned && !stamp.redeemed && !animated.has(stampKey);
            const status = stamp.redeemed ? 'redeemed' : stamp.earned ? 'earned' : 'emptyStamp';
            const tooltip = referralText('reward', { reward: referralText(`rewards.${stamp.id}`) });
            const id = `referral-reward-${card.linkId}-${stamp.id}`;
            const sameCharacter = own.characterId === snapshot.characterId;
            const rewardButton =
              stamp.earned && !stamp.redeemed && sameCharacter
                ? button(
                    `redeem:${card.linkId}:${stamp.id}`,
                    'redeem',
                    referralText(isAnimating ? 'stamping' : 'redeem'),
                    `data-milestone="${stamp.id}" ${!stamp.redeemable || isAnimating ? 'disabled' : ''}`,
                  )
                : '';
            return `<li class="referral-stamp ui-card ui-card-tile ${stamp.earned ? 'is-earned' : ''} ${stamp.redeemed ? 'is-redeemed' : ''} ${stamp.redeemable && sameCharacter ? 'is-ready' : ''}" data-stamp-key="${esc(stampKey)}" data-animate="${isAnimating}"><button type="button" class="referral-stamp-inspect" aria-describedby="${id}"${focusKeyAttr(`stamp:${card.linkId}:${stamp.id}`)}><span class="referral-stamp-art" aria-hidden="true">${rewardArt(STAMP_ART[stamp.id], 'mount')}</span><span class="referral-stamp-mark" aria-hidden="true">${stamp.earned ? svgIcon('check') : formatNumber(stamp.index + 1)}</span><span class="referral-stamp-name">${esc(referralText(`milestones.${stamp.id}`))}</span><span class="referral-stamp-status ui-muted">${esc(referralText(status))}</span></button><span class="referral-reward ui-panel-strong" role="tooltip" id="${id}">${esc(tooltip)}</span>${rewardButton}${stamp.earned && !stamp.redeemable && !stamp.redeemed ? `<span class="ui-muted">${esc(referralText('previous'))}</span>` : ''}</li>`;
          })
          .join('')
      : '';
  return `<section class="referral-card ui-card ui-card-tile" data-link-id="${card.linkId}"><div class="referral-card-heading"><div class="referral-card-identity"><span class="referral-pair-emblem" aria-hidden="true">${svgIcon('social')}</span><div><h3 class="ui-h">${esc(referralText('cardBetween', { you: name, friend: friendName }))}</h3><p>${esc(referralText('yourCard', { name }))}</p></div></div><span class="referral-lock-wrap"><button type="button" class="ui-icon-btn referral-lock" aria-label="${esc(lockedText)}" aria-describedby="referral-lock-${card.linkId}">${lock}</button><span class="referral-reward ui-panel-strong" role="tooltip" id="referral-lock-${card.linkId}">${esc(lockedText)}</span></span></div><div class="referral-card-intro"><p class="ui-muted">${esc(referralText('playTogether'))}</p>${card.status === 'active' ? progress : ''}</div>${card.status === 'active' ? `<ol class="referral-stamps">${stamps}</ol><p class="ui-muted referral-fallback">${esc(referralText('fallback'))}</p>` : ''}<div class="referral-actions referral-card-actions">${actions}${button(`summon:${card.linkId}`, 'summon', summonText, `title="${esc(referralText('summonHelp'))}" ${cooldown > 0 ? 'disabled' : ''}`)}</div></section>`;
}
