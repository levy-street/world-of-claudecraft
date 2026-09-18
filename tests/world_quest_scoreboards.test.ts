// The world-quest scoreboards: board lookup, the one sortable key every host
// shares, the emit helper, and the shared paging (src/sim/world_quest_*).
import { describe, expect, it } from 'vitest';
import { LAST_KEEP_CANNON, NORTH_WATCH_CANNON } from '../src/sim/content/vehicle_stations';
import { WORLD_QUEST_CALLIGRAPHY_ID } from '../src/sim/content/world_quest_calligraphy';
import { FORGE_QUEST_ID } from '../src/sim/content/world_quest_forging';
import { GLIDER_QUEST_ID } from '../src/sim/content/world_quest_glider';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { LEADERBOARD_MAX, LEADERBOARD_PAGE_SIZE } from '../src/sim/leaderboard_page';
import type { SimEvent } from '../src/sim/types';
import {
  emptyWorldQuestLeaderboardPage,
  paginateWorldQuestLeaderboard,
} from '../src/sim/world_quest_leaderboard_page';
import { emitWorldQuestScore } from '../src/sim/world_quest_score_events';
import {
  WORLD_QUEST_MEDAL_RANK,
  WORLD_QUEST_SCOREBOARDS,
  type WorldQuestScoreboard,
  worldQuestScoreboard,
  worldQuestScoreboardForQuest,
  worldQuestScoreSortKey,
} from '../src/sim/world_quest_scoreboards';

const board = (id: string): WorldQuestScoreboard => {
  const found = worldQuestScoreboard(id);
  if (!found) throw new Error(`no board ${id}`);
  return found;
};

describe('scoreboard catalog', () => {
  it('names one board per medal world quest, each backed by a real quest record', () => {
    expect(WORLD_QUEST_SCOREBOARDS.map((b) => b.questId)).toEqual([
      NORTH_WATCH_CANNON.questId,
      LAST_KEEP_CANNON.questId,
      WORLD_QUEST_CALLIGRAPHY_ID,
      GLIDER_QUEST_ID,
      FORGE_QUEST_ID,
    ]);
    for (const b of WORLD_QUEST_SCOREBOARDS) expect(WORLD_QUESTS_BY_ID[b.questId]).toBeDefined();
    expect(new Set(WORLD_QUEST_SCOREBOARDS.map((b) => b.id)).size).toBe(
      WORLD_QUEST_SCOREBOARDS.length,
    );
  });

  it('resolves boards by id and by quest, and nothing for an unknown id', () => {
    expect(worldQuestScoreboard('forge')?.questId).toBe(FORGE_QUEST_ID);
    expect(worldQuestScoreboardForQuest(GLIDER_QUEST_ID)?.id).toBe('slalom');
    expect(worldQuestScoreboard('nope')).toBeUndefined();
    expect(worldQuestScoreboardForQuest('wq_eastbrook_bandits')).toBeUndefined();
  });

  it('ranks the cannon boards by waves first (the endless line), medal second', () => {
    const cannon = board('north_watch_cannon');
    expect(cannon.primary).toBe('metric');
    expect(worldQuestScoreSortKey(cannon, null, 9)).toBeGreaterThan(
      worldQuestScoreSortKey(cannon, 'gold', 8),
    );
    expect(worldQuestScoreSortKey(cannon, 'gold', 8)).toBeGreaterThan(
      worldQuestScoreSortKey(cannon, 'bronze', 8),
    );
  });

  it('ranks medal boards by medal first, then the number in the board direction', () => {
    const forge = board('forge');
    expect(forge.metric).toBe('seconds');
    // A faster silver beats a slower silver; any silver beats a bronze.
    expect(worldQuestScoreSortKey(forge, 'silver', 41)).toBeGreaterThan(
      worldQuestScoreSortKey(forge, 'silver', 59),
    );
    expect(worldQuestScoreSortKey(forge, 'bronze', 5)).toBeLessThan(
      worldQuestScoreSortKey(forge, 'silver', 59.9),
    );
    const calligraphy = board('calligraphy');
    expect(calligraphy.metric).toBe('points');
    expect(worldQuestScoreSortKey(calligraphy, 'gold', 91)).toBeGreaterThan(
      worldQuestScoreSortKey(calligraphy, 'gold', 90),
    );
    expect(worldQuestScoreSortKey(calligraphy, 'gold', 0)).toBeGreaterThan(
      worldQuestScoreSortKey(calligraphy, 'silver', 999_999_999),
    );
    expect(WORLD_QUEST_MEDAL_RANK).toEqual({ bronze: 1, silver: 2, gold: 3 });
  });

  it('never lets a bad number sort above a finite one', () => {
    const slalom = board('slalom');
    expect(worldQuestScoreSortKey(slalom, 'gold', Number.NaN)).toBe(
      worldQuestScoreSortKey(slalom, 'gold', 0),
    );
    expect(worldQuestScoreSortKey(slalom, 'gold', Number.POSITIVE_INFINITY)).toBeLessThan(
      worldQuestScoreSortKey(slalom, 'gold', 1e9),
    );
    expect(worldQuestScoreSortKey(slalom, 'gold', -5)).toBe(
      worldQuestScoreSortKey(slalom, 'gold', 0),
    );
  });
});

describe('emitWorldQuestScore', () => {
  it('emits one personal event carrying the board id, and nothing for an unboarded quest', () => {
    const events: SimEvent[] = [];
    const ctx = { emit: (ev: SimEvent) => void events.push(ev) };
    expect(emitWorldQuestScore(ctx, 7, FORGE_QUEST_ID, 'silver', 52.5)).toBe(true);
    expect(events).toEqual([
      { type: 'worldQuestScore', pid: 7, board: 'forge', medal: 'silver', metric: 52.5 },
    ]);
    expect(emitWorldQuestScore(ctx, 7, 'wq_eastbrook_bandits', 'gold', 1)).toBe(false);
    expect(events).toHaveLength(1);
  });
});

describe('shared paging', () => {
  it('pages a ranked ladder identically to the other boards and caps the depth', () => {
    const entries = Array.from({ length: LEADERBOARD_MAX + 5 }, (_, i) => ({
      rank: i + 1,
      name: `p${i}`,
      medal: null,
      metric: i,
    }));
    const page = paginateWorldQuestLeaderboard('forge', entries, 1, 10);
    expect(page.board).toBe('forge');
    expect(page.leaders.map((e) => e.rank)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(page.total).toBe(LEADERBOARD_MAX);
    expect(page.pageCount).toBe(LEADERBOARD_MAX / 10);
  });

  it('resolves the empty page for the offline world', () => {
    expect(emptyWorldQuestLeaderboardPage('slalom', 3)).toEqual({
      board: 'slalom',
      leaders: [],
      page: 0,
      pageCount: 1,
      total: 0,
      pageSize: LEADERBOARD_PAGE_SIZE,
      self: null,
    });
  });
});
