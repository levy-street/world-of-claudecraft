// Fire and Fly's ladders through the world quest scoreboard observer and read
// (server/world_quest_leaderboard.ts): the validation arm, the one run onto both
// periods (a mission's onto its lifetime row alone), the Gunner's Mastery row and its
// own validation, the daily read keyed by the realm day, and the ladder order the
// tables return, cached per board and busted by moderation.
import { afterEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ rows: vi.fn(), upsert: vi.fn() }));
const mastery = vi.hoisted(() => ({ rows: vi.fn(), upsert: vi.fn() }));
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
vi.mock('../../server/fire_and_fly_mastery_db', () => ({
  FIRE_AND_FLY_MASTERY_SCHEMA: '',
  fireAndFlyMasteryRows: mastery.rows,
  upsertFireAndFlyMastery: mastery.upsert,
}));

import {
  bustWorldQuestLeaderboardCaches,
  configureWorldQuestScoreDbForTests,
  recordFireAndFlyMastery,
  recordWorldQuestScore,
  recordWorldQuestScoreEvent,
  worldQuestLeaderboardPage,
  worldQuestScoresIdle,
  worldQuestScoresPending,
  worldQuestScoresShedCount,
} from '../../server/world_quest_leaderboard';
import {
  FIRE_AND_FLY_MASTERY_MAX_POINTS,
  FIRE_AND_FLY_MAX_POINTS,
} from '../../src/sim/fire_and_fly_personal_records';
import { FIRE_AND_FLY_MASTERY_BOARD_ID } from '../../src/sim/fire_and_fly_scoreboards';
import { worldQuestScoreboard } from '../../src/sim/world_quest_scoreboards';

const LIFETIME = 'fire_and_fly_hard_v2_lifetime';
const DAILY = 'fire_and_fly_hard_v2_daily';
const MISSION = 'fire_and_fly_powder_v1_lifetime';
const MASTERY = FIRE_AND_FLY_MASTERY_BOARD_ID;
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

describe('Fire and Fly mission scores', () => {
  it('queues a mission win onto its lifetime board, carrying its realm day', async () => {
    db.upsert.mockResolvedValue(true);
    recordWorldQuestScore(who, {
      board: MISSION,
      medal: 'gold',
      metric: 21_000,
      resetDay: '2026-09-23',
    });
    await worldQuestScoresIdle();
    expect(db.upsert).toHaveBeenCalledTimes(1);
    expect(db.upsert.mock.calls[0][1]).toMatchObject({
      board: MISSION,
      medal: 'gold',
      metric: 21_000,
      resetDay: '2026-09-23',
    });
  });

  it.each([
    ['a daily mission board', 'fire_and_fly_powder_v1_daily'],
    ['an older mission version', 'fire_and_fly_powder_v0_lifetime'],
    ['the Mastery board', MASTERY],
  ])('drops a run score on %s', async (_label, board) => {
    recordWorldQuestScore(who, { board, medal: 'gold', metric: 10, resetDay: '2026-09-23' });
    expect(worldQuestScoresPending()).toBe(0);
    await worldQuestScoresIdle();
    expect(db.upsert).not.toHaveBeenCalled();
    expect(mastery.upsert).not.toHaveBeenCalled();
  });
});

describe("the Gunner's Mastery row", () => {
  it('queues a valid row for its connected scorer through the event hook', async () => {
    mastery.upsert.mockResolvedValue(true);
    const clients = new Map([[9, who]]);
    const ev = { type: 'worldQuestMastery', board: MASTERY, stars: 8, points: 95_000, missions: 4 };
    recordWorldQuestScoreEvent(clients, { ...ev, pid: 9 });
    recordWorldQuestScoreEvent(clients, { ...ev, pid: 10 });
    recordWorldQuestScoreEvent(clients, ev);
    await worldQuestScoresIdle();
    expect(mastery.upsert).toHaveBeenCalledTimes(1);
    expect(mastery.upsert.mock.calls[0][1]).toEqual({
      realm: expect.any(String),
      board: MASTERY,
      characterId: 7,
      accountId: 3,
      stars: 8,
      points: 95_000,
    });
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ['a bad board', { board: 'fire_and_fly_mastery_v0_lifetime', stars: 3, points: 10 }],
    ['a mission board', { board: MISSION, stars: 3, points: 10 }],
    ['fractional stars', { board: MASTERY, stars: 2.5, points: 10 }],
    ['negative stars', { board: MASTERY, stars: -1, points: 10 }],
    ['too many stars', { board: MASTERY, stars: 16, points: 10 }],
    ['non-numeric stars', { board: MASTERY, stars: '3', points: 10 }],
    ['non-finite points', { board: MASTERY, stars: 3, points: Number.NaN }],
    ['infinite points', { board: MASTERY, stars: 3, points: Number.POSITIVE_INFINITY }],
    ['negative points', { board: MASTERY, stars: 3, points: -1 }],
    ['fractional points', { board: MASTERY, stars: 3, points: 10.5 }],
    [
      'points past the bound',
      { board: MASTERY, stars: 3, points: FIRE_AND_FLY_MASTERY_MAX_POINTS + 1 },
    ],
  ] as const)('drops %s', async (_label, ev) => {
    recordFireAndFlyMastery(who, ev as never);
    expect(worldQuestScoresPending()).toBe(0);
    expect(worldQuestScoresShedCount()).toBe(0);
    await worldQuestScoresIdle();
    expect(mastery.upsert).not.toHaveBeenCalled();
  });

  it('sheds past the shared FIFO bound like the runs do', async () => {
    let release: () => void = () => {};
    mastery.upsert.mockImplementation(() => new Promise<boolean>((r) => (release = () => r(true))));
    for (let i = 0; i < 300; i++)
      recordFireAndFlyMastery(who, { board: MASTERY, stars: 3, points: i });
    expect(worldQuestScoresPending()).toBe(256);
    expect(worldQuestScoresShedCount()).toBe(44);
    mastery.upsert.mockResolvedValue(true);
    release();
    await worldQuestScoresIdle();
    expect(worldQuestScoresPending()).toBe(0);
  });
});

describe('mission and Mastery ladder reads', () => {
  it('reads a mission board for all time, in table order', async () => {
    db.rows.mockResolvedValue([
      { characterId: 1, name: 'Gold', medal: 'gold', metric: 19_000 },
      { characterId: 2, name: 'Silver', medal: 'silver', metric: 30_000 },
    ]);
    const page = await worldQuestLeaderboardPage(worldQuestScoreboard(MISSION)!, 0, 50);
    expect(db.rows.mock.calls[0][2]).toBe(MISSION);
    expect(db.rows.mock.calls[0][3]).toBe('');
    expect(page.leaders.map((row) => [row.rank, row.name, row.medal])).toEqual([
      [1, 'Gold', 'gold'],
      [2, 'Silver', 'silver'],
    ]);
  });

  it('reads the Mastery from its own table, stars riding each row and the self', async () => {
    mastery.rows.mockResolvedValue([
      { characterId: 1, name: 'Ace', medal: null, metric: 120_000, stars: 13 },
      { characterId: 2, name: 'Bea', medal: null, metric: 150_000, stars: 12 },
    ]);
    const board = worldQuestScoreboard(MASTERY)!;
    const page = await worldQuestLeaderboardPage(board, 0, 50, 'bea');
    expect(mastery.rows.mock.calls[0][2]).toBe(MASTERY);
    expect(db.rows).not.toHaveBeenCalled();
    expect(page.leaders).toEqual([
      { rank: 1, name: 'Ace', medal: null, metric: 120_000, stars: 13 },
      { rank: 2, name: 'Bea', medal: null, metric: 150_000, stars: 12 },
    ]);
    expect(page.self).toEqual(page.leaders[1]);
    await worldQuestLeaderboardPage(board, 0, 50);
    expect(mastery.rows).toHaveBeenCalledTimes(1);
    bustWorldQuestLeaderboardCaches();
    await worldQuestLeaderboardPage(board, 0, 50);
    expect(mastery.rows).toHaveBeenCalledTimes(2);
  });
});
