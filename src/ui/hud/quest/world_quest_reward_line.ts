// The compact reward line under a world quest in the objective tracker's World
// Quests section: one small chip per reward of the map's world-quest card
// (world_quest_tooltip_view.ts), in the card's order: faction standing,
// faction currency, money, experience, then any item as its icon. A cold string
// builder over esc(); every chip carries the card's full localized text as a
// visually hidden label, so a screen reader hears "80 Church Order" rather than
// a bare number. Hovering the line opens the full card (quest_tracker_controller).

import { esc } from '../../esc';
import { formatNumber } from '../../i18n';
import { moneyHtml } from '../../money_html';
import { knownItemIconHtml, unknownItemIconHtml } from '../../unknown_item_icon';
import type { WorldQuestTooltipReward } from '../map/world_quest_tooltip_view';

const whole = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });

function hiddenLabel(text: string): string {
  return `<span class="visually-hidden">${esc(text)}</span>`;
}

function iconImg(url: string | null): string {
  return url ? `<img class="qt-wq-reward-icon" src="${esc(url)}" alt="" draggable="false">` : '';
}

function chip(reward: WorldQuestTooltipReward): string {
  switch (reward.kind) {
    case 'standing':
    case 'currency':
      return `<span class="qt-wq-reward is-${reward.kind}">${iconImg(reward.iconUrl)}<span aria-hidden="true">${esc(whole(reward.amount))}</span>${hiddenLabel(reward.text)}</span>`;
    case 'money':
      return `<span class="qt-wq-reward is-money">${moneyHtml(reward.copper, { compact: true })}</span>`;
    case 'xp':
      return `<span class="qt-wq-reward is-xp"><span class="qt-wq-xp-orb" aria-hidden="true"></span><span aria-hidden="true">${esc(whole(reward.amount))}</span>${hiddenLabel(reward.text)}</span>`;
    case 'item': {
      const icon = reward.item
        ? knownItemIconHtml(reward.item)
        : unknownItemIconHtml(reward.itemId, reward.quality);
      return `<span class="qt-wq-reward is-item">${icon}${hiddenLabel(reward.name)}</span>`;
    }
  }
}

/** The line's markup, or '' for a quest that pays nothing this client can name. */
export function worldQuestRewardLineHtml(rewards: readonly WorldQuestTooltipReward[]): string {
  if (rewards.length === 0) return '';
  return rewards.map(chip).join('');
}
