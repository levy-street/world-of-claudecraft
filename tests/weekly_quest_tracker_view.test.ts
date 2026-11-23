import { describe, expect, it } from 'vitest';
import type { WeeklyQuestProgress } from '../src/sim/types';
import { questStripView } from '../src/ui/hud/quest/quest_strip_core';
import { weeklyQuestTrackerRow } from '../src/ui/hud/quest/weekly_quest_tracker_view';

describe('weeklyQuestTrackerRow', () => {
  it.each([
    ['wk_dungeons', 'Dungeons', 'Dungeons completed: 0/3', 3],
    ['wk_raid', 'Raid', 'Raids completed: 0/1', 1],
    ['wk_battlegrounds', 'Battlegrounds', 'Battlegrounds completed: 0/3', 3],
    ['wk_worldboss', 'World boss', 'World bosses defeated: 0/1', 1],
  ] as const)(
    'projects the active %s charge with its localized tally',
    (questId, category, tally, total) => {
      const progress: WeeklyQuestProgress = { questId, week: 'wk_1', count: 0, state: 'active' };
      const row = weeklyQuestTrackerRow(progress)!;
      expect(row.title).toBe(`Weekly quest: ${category}`);
      expect(row.id).toBe(questId);
      expect(row.number).toBe(0);
      expect(row.complete).toBe(false);
      expect(row.objectives[0].label).toBe(tally);
      expect(row.objectives[0].instruction).toBe(true);
      expect(row.objectives[0].total).toBe(total);
      expect(row.objectives[0].current).toBe(0);
      const mobile = questStripView([row], 0);
      expect(mobile.visible).toBe(true);
      expect(mobile.title).toBe(row.title);
      expect(mobile.objectives[0].label).toBe(tally);
    },
  );

  it('updates progress without mutating authoritative state and clamps the displayed tally', () => {
    const progress: WeeklyQuestProgress = {
      questId: 'wk_dungeons',
      week: 'wk_1',
      count: 2,
      state: 'active',
    };
    expect(weeklyQuestTrackerRow(progress)?.objectives[0].label).toBe('Dungeons completed: 2/3');
    expect(weeklyQuestTrackerRow(progress)?.objectives[0].current).toBe(2);
    progress.count = 4;
    expect(weeklyQuestTrackerRow(progress)?.objectives[0].label).toBe('Dungeons completed: 3/3');
    expect(weeklyQuestTrackerRow(progress)?.objectives[0].current).toBe(3);
    expect(progress.count).toBe(4);
  });

  it('omits absent, completed and unknown charges', () => {
    expect(weeklyQuestTrackerRow(null)).toBeNull();
    expect(weeklyQuestTrackerRow(undefined)).toBeNull();
    expect(
      weeklyQuestTrackerRow({
        questId: 'wk_dungeons',
        week: 'wk_1',
        count: 3,
        state: 'completed',
      }),
    ).toBeNull();
    for (const questId of ['future_weekly', 'toString', '__proto__']) {
      expect(
        weeklyQuestTrackerRow({ questId, week: 'wk_1', count: 0, state: 'active' }),
      ).toBeNull();
    }
  });
});
