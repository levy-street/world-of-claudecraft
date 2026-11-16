// The tracker's compact world-quest reward line (src/ui/hud/quest/
// world_quest_reward_line.ts): one chip per reward of the map's card, in the
// card's order, each carrying the card's full text for a screen reader.

import { describe, expect, it } from 'vitest';
import type { WorldQuestTooltipReward } from '../src/ui/hud/map/world_quest_tooltip_view';
import { worldQuestRewardLineHtml } from '../src/ui/hud/quest/world_quest_reward_line';
import { moneyParts } from '../src/ui/i18n';

const rewards: WorldQuestTooltipReward[] = [
  {
    kind: 'standing',
    factionId: 'church_order',
    amount: 80,
    text: '80 Church Order',
    iconUrl: '/crest.webp',
  },
  {
    kind: 'currency',
    currencyId: 'order_crest',
    amount: 10,
    text: '10 Order Crest',
    iconUrl: '/coin.webp',
  },
  { kind: 'money', copper: 5500, parts: moneyParts(5500), text: '55 silver' },
  { kind: 'xp', amount: 2784, text: '2,784 experience' },
];

describe('world quest reward line', () => {
  it('draws one chip per reward in the card order', () => {
    const html = worldQuestRewardLineHtml(rewards);
    const kinds = [...html.matchAll(/class="qt-wq-reward is-(\w+)"/g)].map((m) => m[1]);
    expect(kinds).toEqual(['standing', 'currency', 'money', 'xp']);
    expect(html).toContain('src="/crest.webp"');
    expect(html).toContain('src="/coin.webp"');
  });

  it('shows short amounts but keeps the full text for a screen reader', () => {
    const html = worldQuestRewardLineHtml(rewards);
    expect(html).toContain('<span aria-hidden="true">80</span>');
    expect(html).toContain('<span class="visually-hidden">80 Church Order</span>');
    expect(html).toContain('<span class="visually-hidden">2,784 experience</span>');
  });

  it('escapes reward text and is empty for no rewards', () => {
    const html = worldQuestRewardLineHtml([{ kind: 'xp', amount: 1, text: '<b>x</b>' }]);
    expect(html).not.toContain('<b>');
    expect(worldQuestRewardLineHtml([])).toBe('');
  });
});
