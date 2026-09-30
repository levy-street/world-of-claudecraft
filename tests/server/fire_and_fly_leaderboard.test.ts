// Fire and Fly's trial ladders through the world quest scoreboard observer and read
// (server/world_quest_leaderboard.ts): the validation arm, the one run onto both
// periods, the daily read keyed by the realm day, and the ladder order the table returns.
import { afterEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ rows: vi.fn(), upsert: vi.fn() }));
vi.mock('../../server/db', () => ({
  pool: {},
  ELIGIBLE_ACCOUNT_SQL: 'true',
  runWithStatementTimeout: async (_ms: number, fn: (query: unknown) => unknown) => fn(vi.fn()),
}));
vi.mock('../../server/fire_and_fly_scores_db', () => ({
  FIRE_AND_FLY_SCORES_SCHEMA: '',
  fireAndFlyScoreRows: db.rows,
  upsertFireAndFlyScore: db.upsert,
}));

import {
  configureWorldQuestScoreDbForTests,
  recordWorldQuestScore,
  worldQuestLeaderboardPage,
  worldQuestScoresIdle,
  worldQuestScoresPending,
  worldQuestScoresShedCount,
} from '../../server/world_quest_leaderboard';
import { FIRE_AND_FLY_MAX_POINTS } from '../../src/sim/fire_and_fly_personal_records';
import { worldQuestScoreboard } from '../../src/sim/world_quest_scoreboards';

const LIFETIME = 'fire_and_fly_hard_v2_lifetime';
const DAILY = 'fire_and_fly_hard_v2_daily';
const who = { characterId: 7, accountId: 3 };

afterEach(async () => {
  await worldQuestScoresIdle();
  configureWorldQuestScoreDbForTests(null);
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('Fire and Fly score submission', () => {
  it('queues a valid lifetime run once, carrying its realm day', async () => {
    db.upsert.mockResolvedValue(true);
    recordWorldQuestScore(who, {
      board: LIFETIME,
      medal: 'silver',
      metric: 14_400,
      resetDay: '2026-09-23',
    });
    await worldQuestScoresIdle();
    expect(db.upsert).toHaveBeenCalledTimes(1);
    expect(db.upsert.mock.calls[0][1]).toMatchObject({
      board: LIFETIME,
      characterId: 7,
      accountId: 3,
      medal: 'silver',
      metric: 14_400,
      resetDay: '2026-09-23',
    });
  });

  it.each([
    ['an unknown board', { board: 'fire_and_fly_hard_v0_lifetime', medal: 'gold', metric: 10 }],
    ['the daily board', { board: DAILY, medal: 'gold', metric: 10 }],
    ['a non-finite score', { board: LIFETIME, medal: 'gold', metric: Number.NaN }],
    ['an infinite score', { board: LIFETIME, medal: 'gold', metric: Number.POSITIVE_INFINITY }],
    ['no medal', { board: LIFETIME, medal: null, metric: 10 }],
    ['an unknown medal', { board: LIFETIME, medal: 'platinum', metric: 10 }],
    ['negative points', { board: LIFETIME, medal: 'gold', metric: -1 }],
    ['fractional points', { board: LIFETIME, medal: 'gold', metric: 10.5 }],
    [
      'points past the bound',
      { board: LIFETIME, medal: 'gold', metric: FIRE_AND_FLY_MAX_POINTS + 1 },
    ],
  ] as const)('drops %s', async (_label, ev) => {
    recordWorldQuestScore(who, { ...ev, resetDay: '2026-09-23' } as never);
    expect(worldQuestScoresPending()).toBe(0);
    expect(worldQuestScoresShedCount()).toBe(0);
    await worldQuestScoresIdle();
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it('drops a run without a well-formed realm day', async () => {
    for (const resetDay of [undefined, '', '23/09/2026']) {
      recordWorldQuestScore(who, { board: LIFETIME, medal: 'gold', metric: 10, resetDay });
    }
    expect(worldQuestScoresPending()).toBe(0);
    expect(worldQuestScoresShedCount()).toBe(0);
    await worldQuestScoresIdle();
    expect(db.upsert).not.toHaveBeenCalled();
  });
});

describe('Fire and Fly ladder reads', () => {
  it('reads the daily board for the realm day, the lifetime board for all time, in table order', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T12:00:00Z'));
    db.rows.mockResolvedValue([
      { characterId: 1, name: 'Gold', medal: 'gold', metric: 19_000 },
      { characterId: 2, name: 'Silver', medal: 'silver', metric: 30_000 },
      { characterId: 3, name: 'Bronze', medal: 'bronze', metric: 40_000 },
    ]);
    const daily = await worldQuestLeaderboardPage(worldQuestScoreboard(DAILY)!, 0, 50, 'silver');
    expect(db.rows.mock.calls[0][2]).toBe(DAILY);
    expect(db.rows.mock.calls[0][3]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(daily.leaders.map((row) => [row.rank, row.name, row.medal])).toEqual([
      [1, 'Gold', 'gold'],
      [2, 'Silver', 'silver'],
      [3, 'Bronze', 'bronze'],
    ]);
    expect(daily.self).toMatchObject({ rank: 2, name: 'Silver' });
    await worldQuestLeaderboardPage(worldQuestScoreboard(LIFETIME)!, 0, 50);
    expect(db.rows.mock.calls[1][2]).toBe(LIFETIME);
    expect(db.rows.mock.calls[1][3]).toBe('');
  });

  it('replaces the daily cache when the realm day turns', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T12:00:00Z'));
    db.rows.mockResolvedValue([]);
    const board = worldQuestScoreboard(DAILY)!;
    await worldQuestLeaderboardPage(board, 0, 50);
    await worldQuestLeaderboardPage(board, 0, 50);
    expect(db.rows).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
    await worldQuestLeaderboardPage(board, 0, 50);
    expect(db.rows).toHaveBeenCalledTimes(2);
    expect(db.rows.mock.calls[1][3]).not.toBe(db.rows.mock.calls[0][3]);
  });
});
