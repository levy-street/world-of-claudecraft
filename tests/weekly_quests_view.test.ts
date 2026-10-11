// The weekly window's pure core (src/ui/weekly_quests_view.ts).
import { describe, expect, it } from 'vitest';
import { WEEKLY_QUESTS_BY_ID } from '../src/sim/content/weekly_quests';
import { EMISSARY_CACHE_MARKS } from '../src/sim/emissary_cache';
import { weeklyQuestRewardCopper } from '../src/sim/weekly_quests';
import { formatMoney } from '../src/ui/i18n';
import {
  buildWeeklyQuestDialog,
  buildWeeklyQuestsView,
  weeklyResetText,
} from '../src/ui/weekly_quests_view';

const HOUR = 3_600_000;

describe('weekly quests view', () => {
  it('offers all four cards open with a pick label and the reset countdown', () => {
    const view = buildWeeklyQuestsView({ weeklyQuest: null, weeklyQuestResetAtMs: 3 * HOUR }, 0);
    expect(view.cards.map((card) => card.id)).toEqual([
      'wk_dungeons',
      'wk_raid',
      'wk_battlegrounds',
      'wk_worldboss',
    ]);
    expect(view.cards.every((card) => card.state === 'open')).toBe(true);
    expect(view.cards[0]).toMatchObject({
      category: 'Dungeons',
      buttonLabel: 'Choose quest',
      art: 'ui/weekly/dungeons.webp',
      medal: 'ui/weekly/medal_dungeons.webp',
      required: 3,
    });
    expect(view.cards[0].goal).toBe('Complete 3 dungeons on any difficulty.');
    expect(view.resetText).toBe(weeklyResetText(3 * HOUR, 0));
    expect(view.resetText).toContain('resets in');
    expect(view.footer).toContain('Pick a card');
    expect(view.emissaryName).toBe('Cham Pete');
    expect(view.emissaryPortrait).toBe('ui/weekly/emissary.webp');
  });

  it('marks the held card active with its tally and locks the other three', () => {
    const view = buildWeeklyQuestsView(
      {
        weeklyQuest: { questId: 'wk_battlegrounds', week: 'wk_1', count: 2, state: 'active' },
        weeklyQuestResetAtMs: HOUR,
      },
      0,
    );
    expect(view.cards.map((card) => card.state)).toEqual(['locked', 'locked', 'active', 'locked']);
    expect(view.cards[2].buttonLabel).toBe('In progress (2/3)');
    expect(view.cards[0].buttonLabel).toBe('Locked this week');
    expect(view.footer).toContain('unlock at the reset');
    const done = buildWeeklyQuestsView(
      {
        weeklyQuest: { questId: 'wk_raid', week: 'wk_1', count: 1, state: 'completed' },
        weeklyQuestResetAtMs: HOUR,
      },
      0,
    );
    expect(done.cards[1]).toMatchObject({ state: 'completed', buttonLabel: 'Completed this week' });
  });

  it('never shows a negative countdown', () => {
    expect(weeklyResetText(0, HOUR)).toBe(weeklyResetText(5, 5));
  });

  it('prices the confirm dialog for the character level and names the cache contents', () => {
    const dialog = buildWeeklyQuestDialog(WEEKLY_QUESTS_BY_ID.wk_raid, 12, 'resets in 3 days.');
    expect(dialog.heading).toBe('Weekly quest: Raid');
    expect(dialog.goalLabel).toBe('Raids completed');
    expect(dialog.goalCount).toBe('0 / 1');
    expect(dialog.rewardMoney).toBe(formatMoney(weeklyQuestRewardCopper(12)));
    expect(dialog.rewardItem).toBe("Emissary's Cache");
    expect(dialog.rewardItemIcon).toBe('ui/items/emissary_cache.webp');
    expect(dialog.rewardItemDesc).toContain('Normal raid piece');
    expect(dialog.rewardItemDesc).toContain(`${EMISSARY_CACHE_MARKS} x Heroic Mark`);
    expect(dialog.note).toContain('resets in 3 days.');
    expect(dialog.art).toBe('ui/weekly/raid.webp');
  });
});

describe('the commendation view', () => {
  it('is absent until the charge is finished, then offers every faction with the capped ones off', () => {
    expect(
      buildWeeklyQuestsView(
        {
          weeklyQuest: { questId: 'wk_raid', week: 'wk_2', count: 0, state: 'active' },
          weeklyQuestResetAtMs: 0,
        },
        0,
      ).commendation,
    ).toBeNull();
    const view = buildWeeklyQuestsView(
      {
        weeklyQuest: { questId: 'wk_raid', week: 'wk_2', count: 1, state: 'completed' },
        weeklyQuestResetAtMs: 0,
        factions: { rift_watch: 3000, church_order: 0, automatons: 0 },
        player: { level: 10 },
      },
      0,
    );
    expect(view.commendation?.heading).toBe("Emissary's commendation");
    expect(view.commendation?.note).toContain('1,000');
    expect(view.commendation?.options.map((o) => [o.factionId, o.capped, o.claimed])).toEqual([
      ['rift_watch', true, false],
      ['church_order', false, false],
      ['automatons', false, false],
    ]);
    expect(view.commendation?.claimedText).toBeNull();
  });

  it('marks the claimed faction and names it once the choice is made', () => {
    const view = buildWeeklyQuestsView(
      {
        weeklyQuest: {
          questId: 'wk_raid',
          week: 'wk_2',
          count: 1,
          state: 'completed',
          commended: 'church_order',
        },
        weeklyQuestResetAtMs: 0,
        factions: {},
        player: { level: 20 },
      },
      0,
    );
    expect(view.commendation?.options.find((o) => o.factionId === 'church_order')?.claimed).toBe(
      true,
    );
    expect(view.commendation?.claimedText).toBe(
      "This week's commendation went to the Church Order.",
    );
  });
});
