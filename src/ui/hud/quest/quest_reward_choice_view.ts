// The choose-one quest reward list (QuestDef.choiceRewards) for the quest dialog
// and the quest log. A pure model over the sim's one resolver
// (sim/quests/quest_reward_choice.ts), so the list a player sees, the piece
// preselected for their spec, and what the server grants on turn-in are the same
// set; plus a string painter both windows inject into their reward block.
//
// The dialog paints it interactive (a radio row per piece; the turn-in sends the
// checked one), the quest log and the accept step paint it as a preview.

import { ITEMS, QUESTS } from '../../../sim/data';
import { defaultRewardChoice, questRewardChoices } from '../../../sim/quests/quest_reward_choice';
import type { ItemDef, PlayerClass } from '../../../sim/types';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { focusKeyAttr } from '../../focus_restore';
import { t } from '../../i18n';
import { itemNameColor } from '../../item_name_color';

export interface QuestRewardChoiceModel {
  readonly itemIds: readonly string[];
  /** The checked piece: the player's pick if it is offered, else the spec default. */
  readonly selected: string | null;
}

export function questRewardChoiceModel(
  questId: string,
  cls: PlayerClass,
  spec: string | null | undefined,
  picked?: string | null,
): QuestRewardChoiceModel | null {
  const quest = QUESTS[questId];
  if (!quest) return null;
  const itemIds = questRewardChoices(quest, cls);
  if (itemIds.length === 0) return null;
  const selected =
    picked && itemIds.includes(picked) ? picked : (defaultRewardChoice(quest, cls, spec) ?? null);
  return { itemIds, selected };
}

export interface QuestRewardChoicePaintDeps {
  itemIcon(item: ItemDef): string;
}

/** The heading plus one row per offered piece; `interactive` makes each row a radio button. */
export function questRewardChoiceHtml(
  model: QuestRewardChoiceModel,
  deps: QuestRewardChoicePaintDeps,
  interactive: boolean,
): string {
  // The radio group's one tab stop (APG roving tabindex): the checked card, else the first.
  const tabStop =
    model.selected && model.itemIds.includes(model.selected) ? model.selected : model.itemIds[0];
  const heading = t(interactive ? 'questUi.detail.chooseReward' : 'questUi.detail.rewardChoices');
  const rows = model.itemIds
    .map((id) => {
      const item = ITEMS[id];
      const name = `<span class="qd-reward-name q-${item.quality ?? 'common'}" style="color:${itemNameColor(item)}">${esc(itemDisplayName(item))}</span>`;
      const socket = `<span class="qd-reward-socket ui-socket ui-socket--bag">${deps.itemIcon(item)}</span>`;
      if (!interactive) {
        return `<div class="qd-reward-row qd-reward-choice ui-card" data-reward-choice="${esc(id)}">${socket}${name}</div>`;
      }
      const checked = id === model.selected;
      const tabindex = id === tabStop ? 0 : -1;
      return `<button type="button" class="qd-reward-row qd-reward-choice ui-card${checked ? ' is-selected' : ''}" role="radio" aria-checked="${checked}" tabindex="${tabindex}"${focusKeyAttr(`reward:${id}`)} data-reward-choice="${esc(id)}">${socket}${name}</button>`;
    })
    .join('');
  const group = interactive ? ` role="radiogroup" aria-label="${esc(heading)}"` : '';
  return `<div class="qd-reward-label qd-reward-choice-heading">${esc(heading)}</div><div class="qd-reward-choices"${group}>${rows}</div>`;
}
