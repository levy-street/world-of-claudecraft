import { QUEUE_REWARDS } from '../../../sim/content/queue_rewards';
import type { DungeonFinderInfo } from '../../../world_api/dungeon_finder';
import { esc } from '../../esc';
import { focusKeyAttr } from '../../focus_restore';
import { formatNumber, t } from '../../i18n';
import type { hudChromeStrings } from '../../i18n.catalog/hud_chrome';

const label = (key: keyof typeof hudChromeStrings.expeditions, values?: Record<string, string>) =>
  esc(t(`hudChrome.expeditions.${key}`, values));
const whole = (value: number) => formatNumber(value, { maximumFractionDigits: 0 });

/** A sculpted bell silhouette; the three metal finishes are stylesheet-owned. */
function bellArt(): string {
  return `<svg class="expedition-collectible" viewBox="0 0 160 160" aria-hidden="true" focusable="false"><circle class="expedition-bell-halo" cx="80" cy="80" r="67"/><circle class="expedition-bell-ring" cx="80" cy="80" r="59"/><path class="expedition-bell-metal" d="M72 35a8 8 0 0 1 16 0v8H72zM47 101c9-14 5-34 13-45 4-6 11-10 20-10s16 4 20 10c8 11 4 31 13 45l7 10c2 4-1 8-5 8H45c-4 0-7-4-5-8z"/><path class="expedition-bell-engraving" d="M66 62c-7 10-4 26-10 41M61 89c13 6 25 6 38 0M50 109h60M68 52h24"/><path class="expedition-bell-metal" d="M71 124h18a9 9 0 0 1-18 0z"/><path class="expedition-bell-gem" d="m80 64 7 9-7 9-7-9z"/></svg>`;
}

export function expeditionShopHtml(state: DungeonFinderInfo['queueRewards'] | null): string {
  const cards = QUEUE_REWARDS.map((reward) => {
    const owned = state?.unlocked.includes(reward.id) ?? false;
    const equipped = state?.equipped === reward.id;
    const action = owned ? 'equip-reward' : 'buy-reward';
    const disabled = equipped || (!owned && (state?.balance ?? 0) < reward.cost);
    return `<article class="expedition-reward ui-card-tile" data-finish="${reward.id}"><div class="expedition-reward-display">${bellArt()}<span class="expedition-reward-state">${label(owned ? 'shopOwned' : 'shopLocked')}</span></div><div class="expedition-reward-body"><h4>${label(reward.id)}</h4><p>${label('rewardScope')}</p><div class="expedition-reward-price">${label('price', { count: whole(reward.cost) })}</div><button type="button" class="ui-btn${!owned ? ' ui-btn--gold' : ''}" data-action="${action}" data-reward="${reward.id}" ${focusKeyAttr(`${action}:data-reward="${reward.id}"`)}${disabled ? ' disabled' : ''}>${label(equipped ? 'equipped' : owned ? 'equip' : 'buy')}</button></div></article>`;
  }).join('');
  const earned = state?.earnedToday ?? 0;
  const cap = state?.dailyCap ?? 60;
  const daily = label('dailyPoints', { earned: whole(earned), cap: whole(cap) });
  return `<section class="expedition-shop" aria-labelledby="expedition-shop-title"><header class="expedition-shop-intro"><div><p class="expedition-eyebrow">${label('shopCollection')}</p><h3 id="expedition-shop-title">${label('shopIntro')}</h3><p>${label('shopDescription')}</p></div><div class="expedition-shop-wallet ui-well"><strong>${whole(state?.balance ?? 0)}</strong><span>${label('points', { count: whole(state?.balance ?? 0) })}</span><p class="ui-meta">${daily}</p><progress class="expedition-progress" value="${earned}" max="${Math.max(1, cap)}" aria-label="${daily}"></progress></div></header><div class="expedition-reward-grid">${cards}</div><footer class="expedition-shop-foot"><details data-shop-rules><summary ${focusKeyAttr('shop-rules:')}>${label('shopRules')}</summary><p>${label('rewardRules')}</p></details><button type="button" class="ui-btn" data-action="default-bell" ${focusKeyAttr('default-bell:')}>${label('defaultBell')}</button></footer></section>`;
}
