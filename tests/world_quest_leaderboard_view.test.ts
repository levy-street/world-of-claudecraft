// The World Quests high-score tab's pure core (src/ui/world_quest_leaderboard_view.ts).
import { describe, expect, it } from 'vitest';
import { WORLD_QUEST_SCOREBOARDS } from '../src/sim/world_quest_scoreboards';
import {
  DEFAULT_WORLD_QUEST_BOARD,
  resolveWorldQuestBoard,
  worldQuestBoardChips,
  worldQuestLeaderboardRow,
  worldQuestMedalText,
  worldQuestMetricHeader,
  worldQuestMetricText,
} from '../src/ui/world_quest_leaderboard_view';

describe('board chips', () => {
  it('lists every scoreboard once with its localized quest name and marks the active one', () => {
    const chips = worldQuestBoardChips('forge');
    expect(chips.map((c) => c.id)).toEqual(
      WORLD_QUEST_SCOREBOARDS.filter((b) => !b.id.startsWith('glider_')).map((b) => b.id),
    );
    expect(chips.filter((c) => c.active).map((c) => c.id)).toEqual(['forge']);
    expect(chips.find((c) => c.id === 'forge')?.label).toBe('A Helping Hammer');
    for (const chip of chips) expect(chip.label).not.toMatch(/^wq_|Unknown/);
  });

  it('falls back to the first board for an unknown selection', () => {
    expect(DEFAULT_WORLD_QUEST_BOARD).toBe(WORLD_QUEST_SCOREBOARDS[0].id);
    expect(resolveWorldQuestBoard('nope').id).toBe(DEFAULT_WORLD_QUEST_BOARD);
    expect(resolveWorldQuestBoard('slalom').id).toBe('slalom');
  });
});

describe('cells', () => {
  it('names the number column after the board metric', () => {
    expect(worldQuestMetricHeader(resolveWorldQuestBoard('north_watch_cannon'))).toBe('Waves held');
    expect(worldQuestMetricHeader(resolveWorldQuestBoard('forge'))).toBe('Time');
    expect(worldQuestMetricHeader(resolveWorldQuestBoard('calligraphy'))).toBe('Score');
  });

  it('formats waves and points whole, seconds with the unit', () => {
    expect(worldQuestMetricText(resolveWorldQuestBoard('last_keep_cannon'), 12)).toBe('12');
    expect(worldQuestMetricText(resolveWorldQuestBoard('forge'), 41.26)).toBe('41.3s');
    expect(worldQuestMetricText(resolveWorldQuestBoard('slalom'), 1234.6)).toBe('1,235');
  });

  it('labels the medal cell, including the no-medal case', () => {
    expect(worldQuestMedalText('gold')).toBe('Gold');
    expect(worldQuestMedalText(null)).toBe('None');
  });

  it('builds a row and marks the viewer by character name', () => {
    const row = worldQuestLeaderboardRow(
      resolveWorldQuestBoard('forge'),
      { rank: 3, name: 'Hero', medal: 'silver', metric: 55 },
      'Hero',
    );
    expect(row).toEqual({
      rank: '3',
      name: 'Hero',
      medal: 'silver',
      medalText: 'Silver',
      metricText: '55s',
      me: true,
    });
    expect(
      worldQuestLeaderboardRow(
        resolveWorldQuestBoard('forge'),
        { rank: 4, name: 'Other', medal: null, metric: 70 },
        'Hero',
      ).me,
    ).toBe(false);
  });
});
