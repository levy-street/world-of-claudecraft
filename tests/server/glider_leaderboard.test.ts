import { afterEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ rows: vi.fn(), upsert: vi.fn() }));
vi.mock('../../server/db', () => ({
  pool: {},
  ELIGIBLE_ACCOUNT_SQL: 'true',
  runWithStatementTimeout: async (_ms: number, fn: (query: unknown) => unknown) => fn(vi.fn()),
}));
vi.mock('../../server/glider_scores_db', () => ({
  GLIDER_SCORES_SCHEMA: '',
  gliderScoreRows: db.rows,
  upsertGliderScore: db.upsert,
}));

import {
  bustWorldQuestLeaderboardCaches,
  configureWorldQuestScoreDbForTests,
  recordWorldQuestScore,
  worldQuestLeaderboardPage,
  worldQuestScoresIdle,
} from '../../server/world_quest_leaderboard';
import { worldQuestScoreboard } from '../../src/sim/world_quest_scoreboards';

afterEach(async () => {
  await worldQuestScoresIdle();
  configureWorldQuestScoreDbForTests(null);
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('glider leaderboard cadence and rollover', () => {
  it('shares concurrent reads and keeps score improvements inside the refresh cadence', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T12:00:00Z'));
    db.rows.mockResolvedValue([]);
    db.upsert.mockResolvedValue(true);
    const board = worldQuestScoreboard('glider_downs_v2_lifetime')!;
    await Promise.all(Array.from({ length: 100 }, () => worldQuestLeaderboardPage(board, 0, 50)));
    expect(db.rows).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 50; i++)
      recordWorldQuestScore(
        { characterId: 1, accountId: 1 },
        { board: board.id, metric: 100 - i, medal: 'gold', resetDay: '2026-09-23' },
      );
    await worldQuestScoresIdle();
    expect(db.upsert).toHaveBeenCalledTimes(50);
    await worldQuestLeaderboardPage(board, 0, 50);
    expect(db.rows).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30001);
    await worldQuestLeaderboardPage(board, 0, 50);
    expect(db.rows).toHaveBeenCalledTimes(2);
    bustWorldQuestLeaderboardCaches();
    await worldQuestLeaderboardPage(board, 0, 50);
    expect(db.rows).toHaveBeenCalledTimes(3);
  });

  it('backs off cold database failures and retries after five seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T12:00:00Z'));
    db.rows.mockRejectedValue(new Error('timeout'));
    const board = worldQuestScoreboard('glider_downs_v2_daily')!;
    await expect(worldQuestLeaderboardPage(board, 0, 50)).rejects.toThrow('timeout');
    for (let i = 0; i < 10; i++) {
      await expect(worldQuestLeaderboardPage(board, 0, 50)).rejects.toThrow(
        'temporarily unavailable',
      );
    }
    expect(db.rows).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5001);
    db.rows.mockResolvedValue([]);
    await worldQuestLeaderboardPage(board, 0, 50);
    expect(db.rows).toHaveBeenCalledTimes(2);
  });

  it('replaces the daily cache at reset and captures the completion day before queued writes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T12:00:00Z'));
    db.rows.mockResolvedValue([]);
    db.upsert.mockResolvedValue(true);
    const board = worldQuestScoreboard('glider_downs_v2_daily')!;
    await worldQuestLeaderboardPage(board, 0, 50);
    const oldDay = db.rows.mock.calls[0][3];
    recordWorldQuestScore(
      { characterId: 1, accountId: 1 },
      { board: 'glider_downs_v2_lifetime', metric: 60, medal: 'gold', resetDay: '2026-09-23' },
    );
    vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
    await worldQuestScoresIdle();
    expect(db.upsert.mock.calls[0][1].resetDay).toBe('2026-09-23');
    await worldQuestLeaderboardPage(board, 0, 50);
    expect(db.rows).toHaveBeenCalledTimes(2);
    expect(db.rows.mock.calls[1][3]).not.toBe(oldDay);
  });
});
