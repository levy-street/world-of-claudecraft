// The world quest hover card's thin painter: the pure model
// (world_quest_tooltip_view.ts) rendered as the shared #tooltip body. A cold
// string builder over esc() and t(); every icon is committed art (currency art,
// the coin readout, the item pipeline), and an item reward embeds the SAME item
// card the bags paint, injected by the host so this module never reaches Hud.

import type { ItemDef } from '../../../sim/types';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import { itemNameColor } from '../../item_name_color';
import { moneyHtml } from '../../money_html';
import { knownItemIconHtml, unknownItemIconHtml } from '../../unknown_item_icon';
import type {
  WorldQuestTooltipItemReward,
  WorldQuestTooltipModel,
  WorldQuestTooltipReward,
} from './world_quest_tooltip_view';

export interface WorldQuestTooltipHtmlDeps {
  /** The full item tooltip card (Hud.itemTooltip: name, quality/kind, slot,
   *  binding, stats, set lines). Absent on a host that has not wired it, where
   *  the card degrades to the quality-colored name plus item level. */
  itemTooltip?(item: ItemDef): string;
}

function iconImg(url: string | null, cls: string): string {
  return url ? `<img class="${cls}" src="${esc(url)}" alt="" draggable="false">` : '';
}

/** Put the item level line right under the card's title when the card does
 *  not already carry it (the item card shows it only with the Show Item Level
 *  option on); a quest reward always states it. */
export function withItemLevelLine(cardHtml: string, levelText: string | null): string {
  if (!levelText) return cardHtml;
  const escaped = esc(levelText);
  if (cardHtml.includes(escaped)) return cardHtml;
  const line = `<div class="tt-stat wq-tt-ilvl">${escaped}</div>`;
  const titleEnd = cardHtml.startsWith('<div class="tt-title"') ? cardHtml.indexOf('</div>') : -1;
  if (titleEnd < 0) return line + cardHtml;
  const cut = titleEnd + '</div>'.length;
  return cardHtml.slice(0, cut) + line + cardHtml.slice(cut);
}

function itemRewardHtml(
  reward: WorldQuestTooltipItemReward,
  deps: WorldQuestTooltipHtmlDeps,
): string {
  const icon = reward.item
    ? knownItemIconHtml(reward.item)
    : unknownItemIconHtml(reward.itemId, reward.quality);
  const count =
    reward.count > 1
      ? `<span class="wq-tt-item-count">${esc(formatNumber(reward.count, { maximumFractionDigits: 0 }))}</span>`
      : '';
  const color = itemNameColor({ kind: reward.item?.kind, quality: reward.quality });
  const fallbackTitle = `<div class="tt-title" style="color:${color}">${esc(reward.name)}</div>`;
  const card = reward.item && deps.itemTooltip ? deps.itemTooltip(reward.item) : fallbackTitle;
  return `<div class="wq-tt-item"><span class="wq-tt-item-icon">${icon}${count}</span><div class="wq-tt-item-card">${withItemLevelLine(card, reward.itemLevelText)}</div></div>`;
}

function rewardHtml(reward: WorldQuestTooltipReward, deps: WorldQuestTooltipHtmlDeps): string {
  switch (reward.kind) {
    case 'standing':
      return `<div class="wq-tt-reward is-standing"><span class="wq-tt-crest">${iconImg(reward.iconUrl, 'wq-tt-icon')}</span><span>${esc(reward.text)}</span></div>`;
    case 'currency':
      return `<div class="wq-tt-reward is-currency">${iconImg(reward.iconUrl, 'wq-tt-icon')}<span>${esc(reward.text)}</span></div>`;
    case 'money':
      return `<div class="wq-tt-reward is-money">${moneyHtml(reward.copper, { compact: true })}</div>`;
    case 'xp':
      return `<div class="wq-tt-reward is-xp"><span class="wq-tt-xp-orb" aria-hidden="true"></span><span>${esc(reward.text)}</span></div>`;
    case 'item':
      return itemRewardHtml(reward, deps);
  }
}

/** The whole #tooltip body for one world quest marker. */
export function worldQuestTooltipHtml(
  model: WorldQuestTooltipModel,
  deps: WorldQuestTooltipHtmlDeps = {},
): string {
  const time = model.timeRemaining
    ? `<div class="wq-tt-time"><span class="wq-tt-label">${esc(t('hudChrome.worldQuestTooltip.timeRemaining'))}</span><span>${esc(model.timeRemaining)}</span></div>`
    : '';
  const rewards = model.rewards.map((reward) => rewardHtml(reward, deps)).join('');
  return (
    `<div class="wq-tt">` +
    `<div class="tt-title">${esc(model.title)}</div>` +
    `<div class="wq-tt-faction">${esc(model.factionName)}</div>` +
    time +
    `<div class="wq-tt-objective">${esc(model.objective.text)}</div>` +
    `<div class="wq-tt-rewards-head">${esc(t('questUi.detail.rewards'))}</div>` +
    `<div class="wq-tt-rewards">${rewards}</div>` +
    `</div>`
  );
}
