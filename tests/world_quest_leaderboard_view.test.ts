// The World Quests high-score tab's pure core (src/ui/world_quest_leaderboard_view.ts).
import { describe, expect, it } from 'vitest';
import { TURRET_MISSION_POWDER } from '../src/sim/content/fire_and_fly_missions';
import { FIRE_AND_FLY_QUEST_ID } from '../src/sim/content/world_quest_fire_and_fly';
import { fireAndFlyScoreboardId } from '../src/sim/fire_and_fly_scoreboards';
import { WORLD_QUEST_SCOREBOARDS } from '../src/sim/world_quest_scoreboards';
import {
  DEFAULT_WORLD_QUEST_BOARD,
  resolveWorldQuestBoard,
  worldQuestBoardChips,
  worldQuestBoardFamily,
  worldQuestBoardLabel,
  worldQuestLeaderboardRow,
  worldQuestMedalText,
  worldQuestMetricHeader,
  worldQuestMetricText,
} from '../src/ui/world_quest_leaderboard_view';

describe('board chips', () => {
  it('lists every scoreboard once with its localized quest name and marks the active one', () => {
    const chips = worldQuestBoardChips('forge');
    expect(chips.map((c) => c.id)).toEqual(
      WORLD_QUEST_SCOREBOARDS.filter((b) => worldQuestBoardFamily(b.id) === 'quests').map(
        (b) => b.id,
      ),
    );
    expect(chips.map((c) => c.id)).toEqual([
      'north_watch_cannon',
      'last_keep_cannon',
      'calligraphy',
      'slalom',
      'forge',
    ]);
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

describe('board families', () => {
  it('groups the glider courses and the Fire and Fly trials apart from the quest-wide boards', () => {
    expect(worldQuestBoardFamily('forge')).toBe('quests');
    expect(worldQuestBoardFamily('slalom')).toBe('quests');
    expect(worldQuestBoardFamily('glider_downs_v2_daily')).toBe('glider');
    expect(worldQuestBoardFamily('fire_and_fly_standard_v2_lifetime')).toBe('fireAndFly');
    const chips = worldQuestBoardChips('fire_and_fly_standard_v2_lifetime');
    expect(chips.map((c) => c.label)).toEqual([
      "Recruit's Trial: Today",
      "Recruit's Trial: All time",
      'Standing Watch: Today',
      'Standing Watch: All time',
      "Veterans' Test: Today",
      "Veterans' Test: All time",
    ]);
    expect(chips.filter((c) => c.active).map((c) => c.id)).toEqual([
      'fire_and_fly_standard_v2_lifetime',
    ]);
  });

  it("titles a mission's board with the mission's own name, not the quest's", () => {
    const id = fireAndFlyScoreboardId(TURRET_MISSION_POWDER.id, 'lifetime');
    expect(id).not.toBeNull();
    const label = worldQuestBoardLabel({
      id: id ?? '',
      questId: FIRE_AND_FLY_QUEST_ID,
      metric: 'points',
      primary: 'medal',
    });
    expect(label).toBe('The Powder Store: All time');
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
