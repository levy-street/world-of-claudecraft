// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { ITEMS, QUESTS } from '../src/sim/data';
import { defaultRewardChoice } from '../src/sim/quests/quest_reward_choice';
import type { ItemDef } from '../src/sim/types';
import {
  questRewardChoiceHtml,
  questRewardChoiceModel,
} from '../src/ui/hud/quest/quest_reward_choice_view';

const QUEST = 'q_wolves';
const offered = QUESTS[QUEST].choiceRewards ?? [];
const itemIcon = (item: ItemDef) => `<img alt="" data-icon="${item.id}">`;

describe('quest reward choice view', () => {
  it('models the cards the class can wear and checks the spec default', () => {
    const warrior = questRewardChoiceModel(QUEST, 'warrior', null);
    expect(warrior?.itemIds).toEqual(offered);
    expect(warrior?.selected).toBe(defaultRewardChoice(QUESTS[QUEST], 'warrior', null));
    const mage = questRewardChoiceModel(QUEST, 'mage', 'frost');
    expect(mage?.itemIds).toHaveLength(1);
    expect(mage?.selected).toBe(mage?.itemIds[0]);
  });

  it('keeps a pick only while it is offered', () => {
    const other = offered.find((id) => id !== defaultRewardChoice(QUESTS[QUEST], 'warrior', null));
    expect(questRewardChoiceModel(QUEST, 'warrior', null, other)?.selected).toBe(other);
    const notOffered = Object.keys(ITEMS).find((id) => !offered.includes(id));
    expect(questRewardChoiceModel(QUEST, 'warrior', null, notOffered)?.selected).toBe(
      defaultRewardChoice(QUESTS[QUEST], 'warrior', null),
    );
  });

  it('is null for an unknown quest or one without choices', () => {
    expect(questRewardChoiceModel('no_such_quest', 'warrior', null)).toBeNull();
    const plain = Object.values(QUESTS).find((q) => !q.choiceRewards?.length);
    expect(plain && questRewardChoiceModel(plain.id, 'warrior', null)).toBeNull();
  });

  it('paints radio cards with one tab stop at turn-in and a static preview elsewhere', () => {
    const model = questRewardChoiceModel(QUEST, 'warrior', null);
    if (!model) throw new Error('q_wolves offers no choice');
    const host = document.createElement('div');
    host.innerHTML = questRewardChoiceHtml(model, { itemIcon }, true);
    const cards = [...host.querySelectorAll<HTMLElement>('[data-reward-choice]')];
    expect(host.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(cards.every((c) => c.tagName === 'BUTTON' && c.getAttribute('role') === 'radio')).toBe(
      true,
    );
    const checked = cards.filter((c) => c.getAttribute('aria-checked') === 'true');
    expect(checked.map((c) => c.dataset.rewardChoice)).toEqual([model.selected]);
    expect(cards.filter((c) => c.tabIndex === 0)).toEqual(checked);
    expect(cards.every((c) => c.dataset.focusKey === `reward:${c.dataset.rewardChoice}`)).toBe(
      true,
    );

    host.innerHTML = questRewardChoiceHtml(model, { itemIcon }, false);
    expect(host.querySelector('[role="radiogroup"]')).toBeNull();
    expect(host.querySelectorAll('button')).toHaveLength(0);
    expect(host.querySelectorAll('[data-reward-choice]')).toHaveLength(model.itemIds.length);
  });

  it('escapes an item id and name into the markup', () => {
    const hostile = 'x"><img src=x onerror=alert(1)>';
    ITEMS[hostile] = { ...ITEMS[offered[0]], id: hostile, name: '<b>bold</b>' };
    try {
      const html = questRewardChoiceHtml(
        { itemIds: [hostile], selected: hostile },
        { itemIcon: () => '' },
        true,
      );
      expect(html).not.toContain('<img src=x');
      expect(html).not.toContain('<b>bold</b>');
    } finally {
      delete ITEMS[hostile];
    }
  });
});
