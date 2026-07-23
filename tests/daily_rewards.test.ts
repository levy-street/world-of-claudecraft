import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DailyRewardDb,
  DailyRewardInternalPayoutRow,
  DailyRewardPayoutActor,
  DailyRewardPayoutAttemptClaimResult,
  DailyRewardPayoutClaimResult,
  DailyRewardPayoutModerationResult,
  DailyRewardPayoutRow,
  DailyRewardScoreRow,
  DailyRewardSpinRow,
  DailyRewardTaskRow,
  DailyRewardTaskSeed,
  DailyRewardWinnerAnnouncement,
} from '../server/daily_rewards_db';

const walletMock = vi.hoisted(() => ({
  row: { account_id: 1, pubkey: 'Wallet1111111111111111111111111111111111111', linked_at: 'now' },
}));
const balanceMock = vi.hoisted(() => ({ value: 50 as number | null }));

vi.mock('../server/db', () => ({
  walletForAccount: vi.fn(async () => walletMock.row),
}));

vi.mock('../server/woc_balance', () => ({
  cachedWocBalance: vi.fn(async () => balanceMock.value),
}));

import {
  addRewardDays,
  currentDailyRewardDay,
  type DailyRewardRuntimeConfig,
  DailyRewardService,
  dailyRewardEligibility,
  dailyRewardPayoutSplits,
  dailyRewardRuntimeConfig,
  nextUtcResetIso,
  resetDailyRewardPriceCacheForTests,
  rewardDayForDate,
} from '../server/daily_rewards';
import { resetDailyRewardSeedGateForTests } from '../server/daily_rewards_seed_gate';
import { REALM } from '../server/realm';
import { buildDailyRewardsView, dailyRewardTaskDescription } from '../src/ui/daily_rewards_view';

class FakeDailyRewardDb implements DailyRewardDb {
  banReason: string | null = null;
  banExpiresAt: string | null = null;
  winnerAnnouncements: DailyRewardWinnerAnnouncement[] = [];
  score = 0;
  spin: { outcomeKey: string; points: number; createdAt: string } | null = null;
  tasks: DailyRewardTaskSeed[] = [];
  events: {
    accountId: number;
    kind: string;
    points: number;
    key: string;
    meta: Record<string, unknown>;
  }[] = [];
  ensureDayCalls = 0;
  seedTasksCalls = 0;
  finalizeDayCalls = 0;
  dayFinalizedCalls = 0;
  scoreForAccountCalls = 0;
  leaderboardSnapshotCalls = 0;
  finalizedDays = new Set<string>();
  // When > 0, the next seedTasks call throws (and decrements), simulating the
  // seed transaction rolling back so the seed-gate retry path can be exercised.
  failSeedTasksTimes = 0;
  // Same hook for the ensureDay arm of the gated pair.
  failEnsureDayTimes = 0;

  async ensureDay(): Promise<void> {
    this.ensureDayCalls++;
    if (this.failEnsureDayTimes > 0) {
      this.failEnsureDayTimes--;
      throw new Error('ensureDay upsert failed');
    }
  }
  async banForAccount(): Promise<{ reason: string; expiresAt: string | null } | null> {
    return this.banReason === null
      ? null
      : { reason: this.banReason, expiresAt: this.banExpiresAt };
  }
  async seedTasks(_day: string, tasks: DailyRewardTaskSeed[]): Promise<void> {
    this.seedTasksCalls++;
    if (this.failSeedTasksTimes > 0) {
      this.failSeedTasksTimes--;
      throw new Error('seedTasks transaction rolled back');
    }
    this.tasks = tasks;
  }
  async tasksForAccount(_day: string, accountId: number): Promise<DailyRewardTaskRow[]> {
    return this.tasks.map((task) => ({
      taskId: task.id,
      type: task.type,
      title: task.title,
      description: task.description,
      points: task.points,
      basePoints: task.basePoints ?? task.points,
      config: task.config ?? {},
      completed: this.events.some(
        (event) => event.accountId === accountId && event.meta.taskId === task.id,
      ),
    }));
  }
  async scoreForAccount(): Promise<number> {
    this.scoreForAccountCalls++;
    return this.score;
  }
  async tasksForType(_day: string, type: string): Promise<DailyRewardTaskRow[]> {
    return this.tasks
      .filter((task) => task.type === type && task.active !== false)
      .map((task) => ({
        taskId: task.id,
        type: task.type,
        title: task.title,
        description: task.description,
        points: task.points,
        basePoints: task.basePoints ?? task.points,
        config: task.config ?? {},
        completed: false,
      }));
  }
  async onlineMinutesForAccount(_day: string, accountId: number): Promise<number> {
    return this.events.filter((event) => event.accountId === accountId && event.kind === 'online')
      .length;
  }
  async questTaskCompletionCount(
    _day: string,
    accountId: number,
    taskId: string,
    questId: string,
  ): Promise<number> {
    return this.events.filter(
      (event) =>
        event.accountId === accountId &&
        event.kind === 'task' &&
        event.meta.taskId === taskId &&
        event.meta.questId === questId,
    ).length;
  }
  async leaderboardTotal(): Promise<number> {
    return this.score > 0 ? 1 : 0;
  }
  // When set, leaderboardSnapshot serves this list instead of the one-account
  // derivation, letting a test exercise the rank > 10 viewer-row branch.
  snapshotRows: DailyRewardScoreRow[] | null = null;
  async leaderboardSnapshot(_day: string): Promise<DailyRewardScoreRow[]> {
    this.leaderboardSnapshotCalls++;
    if (this.snapshotRows !== null) return this.snapshotRows;
    return this.score > 0 ? [{ accountId: 1, username: 'alice', points: this.score, rank: 1 }] : [];
  }
  async leaderboardPage(): Promise<{
    rows: DailyRewardScoreRow[];
    page: number;
    pageSize: number;
    pageCount: number;
    total: number;
  }> {
    const rows: DailyRewardScoreRow[] =
      this.score > 0 ? [{ accountId: 1, username: 'alice', points: this.score, rank: 1 }] : [];
    return {
      rows,
      page: 0,
      pageSize: 20,
      pageCount: 1,
      total: rows.length,
    };
  }
  async spinForAccount(): Promise<DailyRewardSpinRow | null> {
    return this.spin;
  }
  async recordSpin(
    _day: string,
    _accountId: number,
    outcomeKey: string,
    points: number,
  ): Promise<boolean> {
    if (this.spin) return false;
    this.spin = { outcomeKey, points, createdAt: '2026-06-30T00:00:00.000Z' };
    this.events.push({
      accountId: _accountId,
      kind: 'spin',
      points,
      key: 'spin',
      meta: { outcome: outcomeKey },
    });
    this.score += points;
    return true;
  }
  async addPoints(
    _day: string,
    accountId: number,
    kind: string,
    points: number,
    idempotencyKey: string,
    meta: Record<string, unknown> = {},
  ): Promise<boolean> {
    if (this.events.some((event) => event.accountId === accountId && event.key === idempotencyKey))
      return false;
    this.events.push({ accountId, kind, points, key: idempotencyKey, meta });
    this.score += points;
    return true;
  }
  async recentPayouts(): Promise<DailyRewardPayoutRow[]> {
    return [];
  }
  async finalizeDay(day: string): Promise<'finalized' | 'already_finalized'> {
    this.finalizeDayCalls++;
    // The real finalizeDay stamps the module-realm row, so the fake keys its
    // finalized set by (day, realm) the same way dayFinalized reads it: a
    // service that passed the wrong realm to dayFinalized would miss here.
    const key = JSON.stringify([day, REALM]);
    if (this.finalizedDays.has(key)) return 'already_finalized';
    this.finalizedDays.add(key);
    return 'finalized';
  }
  async dayFinalized(day: string, realm: string): Promise<boolean> {
    this.dayFinalizedCalls++;
    return this.finalizedDays.has(JSON.stringify([day, realm]));
  }
  async pendingPayouts(): Promise<DailyRewardInternalPayoutRow[]> {
    return [];
  }
  async unannouncedWinnerDays(): Promise<DailyRewardWinnerAnnouncement[]> {
    return this.winnerAnnouncements;
  }
  async markWinnersAnnounced(): Promise<boolean> {
    return true;
  }
  async markPayout(): Promise<boolean> {
    return true;
  }
  async claimPayout(): Promise<DailyRewardPayoutClaimResult> {
    return { outcome: 'not_found' };
  }
  async claimPayoutResend(): Promise<DailyRewardPayoutAttemptClaimResult> {
    return { outcome: 'not_found' };
  }
  async markPayoutResend(): Promise<boolean> {
    return true;
  }
  async voidPayout(
    _day: string,
    _rank: number,
    _reason: string,
    _actor: DailyRewardPayoutActor,
  ): Promise<DailyRewardPayoutModerationResult> {
    return { outcome: 'not_found' };
  }
  async restorePayout(
    _day: string,
    _rank: number,
    _actor: DailyRewardPayoutActor,
  ): Promise<DailyRewardPayoutModerationResult> {
    return { outcome: 'not_found' };
  }
}

function rewardConfig(overrides: Partial<DailyRewardRuntimeConfig> = {}): DailyRewardRuntimeConfig {
  return {
    minUsd: 20,
    prizePoolUsd: 150,
    prizePoolSol: 0.75,
    wocUsdPrice: 0.5,
    solUsdPrice: 200,
    activeSeconds: 120,
    dayStartUtcMinutes: 22 * 60,
    tasks: [
      {
        id: 'quest_completion',
        type: 'quest_completion',
        title: 'Complete quests',
        description: 'Complete quests today. Points increase with time spent online.',
        points: 10,
        basePoints: 10,
        sortOrder: 1,
        active: true,
        config: {
          minMultiplier: 1,
          maxMultiplier: 3,
          minutesPerMultiplier: 30,
        },
      },
    ],
    ...overrides,
  };
}

function stubRewardConfig(config: Partial<DailyRewardRuntimeConfig> = {}) {
  process.env.WOC_DAILY_REWARD_SERVICE_URL = 'https://payout.test';
  process.env.WOC_DAILY_REWARD_SERVICE_SECRET = 'secret';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers['x-woc-daily-reward-secret']).toBe('secret');
      if (url.pathname === '/daily-schedule') {
        return new Response(JSON.stringify({ dayStartUtcMinutes: 22 * 60 }), { status: 200 });
      }
      expect(url.pathname).toBe('/daily-config');
      return new Response(
        JSON.stringify({ day: url.searchParams.get('day'), ...rewardConfig(config) }),
        { status: 200 },
      );
    }),
  );
}

describe('daily rewards', () => {
  beforeEach(() => {
    delete process.env.WOC_DAILY_REWARD_SERVICE_URL;
    delete process.env.WOC_DAILY_REWARD_SERVICE_SECRET;
    resetDailyRewardPriceCacheForTests();
    // Both memos live at module scope, so without a per-test reset the several
    // blocks that ensureActiveDay the SAME day/config would collide on one gate
    // key and silently stop calling db.ensureDay/db.seedTasks on a fresh FakeDb.
    resetDailyRewardSeedGateForTests();
    stubRewardConfig();
    walletMock.row = {
      account_id: 1,
      pubkey: 'Wallet1111111111111111111111111111111111111',
      linked_at: 'now',
    };
    balanceMock.value = 50;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('qualifies a linked wallet by USD value', async () => {
    const eligibility = await dailyRewardEligibility(1);
    expect(eligibility).toMatchObject({
      eligible: true,
      reason: 'eligible',
      wocBalance: 50,
      wocUsdPrice: 0.5,
      usdValue: 25,
    });
  });

  it('locks banned accounts with the admin reason and prevents point awards', async () => {
    const db = new FakeDailyRewardDb();
    db.banReason = 'Automated play was detected.';
    const service = new DailyRewardService(db);

    const status = await service.status(1);
    expect(status.eligibility).toMatchObject({
      eligible: false,
      reason: 'banned',
      banReason: 'Automated play was detected.',
    });

    const spin = await service.spin(1);
    expect(spin).toMatchObject({ status: 403 });
    const awarded = await service.recordQuestCompletion(
      1,
      101,
      'wolf_hunt',
      new Date('2026-06-30T13:00:00.000Z'),
    );
    expect(awarded).toBe(0);
    expect(db.events).toEqual([]);
  });

  it('includes the exact timed-ban expiry in player eligibility', async () => {
    const db = new FakeDailyRewardDb();
    db.banReason = 'Automated play was detected.';
    db.banExpiresAt = '2026-07-16T06:00:00.000Z';

    const status = await new DailyRewardService(db).status(1);

    expect(status.eligibility).toMatchObject({
      eligible: false,
      reason: 'banned',
      banReason: 'Automated play was detected.',
      banExpiresAt: '2026-07-16T06:00:00.000Z',
    });
  });

  it('uses live WOC and SOL prices from the payout service config', async () => {
    resetDailyRewardPriceCacheForTests();
    stubRewardConfig({ wocUsdPrice: 0.5, solUsdPrice: 200, prizePoolSol: 0.75 });

    const eligibility = await dailyRewardEligibility(1);
    expect(eligibility).toMatchObject({ wocUsdPrice: 0.5, usdValue: 25 });
    const status = await new DailyRewardService(new FakeDailyRewardDb()).status(1);
    expect(status.prizePoolSol).toBeCloseTo(0.75);
  });

  it('records one daily spin and awards its points', async () => {
    const db = new FakeDailyRewardDb();
    const service = new DailyRewardService(db);
    vi.spyOn(Math, 'random').mockReturnValueOnce(0);
    const result = await service.spin(1);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.awardedPoints).toBe(20);
    expect(result.score).toBe(20);
    expect(db.events).toEqual([
      { accountId: 1, kind: 'spin', points: 20, key: 'spin', meta: { outcome: 's20' } },
    ]);
    const second = await service.spin(1);
    expect(second).toMatchObject({ status: 409 });
  });

  it('records online minutes without adding daily leaderboard points', async () => {
    const db = new FakeDailyRewardDb();
    const service = new DailyRewardService(db);
    await service.recordOnlineMinute(1, new Date('2026-06-30T12:34:00.000Z'));
    await service.recordOnlineMinute(1, new Date('2026-06-30T12:34:30.000Z'));
    expect(db.events).toHaveLength(1);
    expect(db.events[0]).toMatchObject({
      kind: 'online',
      points: 0,
      key: 'online:2026-06-30T12:34',
    });
    expect(db.score).toBe(0);
  });

  it('loads dynamic tasks from the payout service', async () => {
    const db = new FakeDailyRewardDb();
    resetDailyRewardPriceCacheForTests();
    stubRewardConfig({
      tasks: [
        {
          id: 'quests_today',
          type: 'quest_completion',
          title: 'Quest push',
          description: 'Complete quests.',
          points: 12,
          basePoints: 12,
          sortOrder: 1,
          active: true,
          config: { maxMultiplier: 4 },
        },
      ],
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/daily-config');
      expect(url.searchParams.get('day')).toBe('2026-06-30');
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers['x-woc-daily-reward-secret']).toBe('secret');
      return new Response(
        JSON.stringify(
          rewardConfig({
            tasks: [
              {
                id: 'quests_today',
                type: 'quest_completion',
                title: 'Quest push',
                description: 'Complete quests.',
                points: 12,
                basePoints: 12,
                sortOrder: 1,
                active: true,
                config: { maxMultiplier: 4 },
              },
            ],
          }),
        ),
        { status: 200 },
      );
    });
    await new DailyRewardService(db).ensureActiveDay('2026-06-30');
    expect(db.tasks).toMatchObject([
      { id: 'quests_today', type: 'quest_completion', title: 'Quest push', basePoints: 12 },
    ]);
  });

  it('bounds remote task definitions before the sequential seed transaction', async () => {
    const tasks = Array.from({ length: 120 }, (_, index) => ({
      id: `task_${index}`,
      type: 'quest_completion',
      title: `Task ${index}`,
      description: '',
      points: 1,
      basePoints: 1,
      sortOrder: index,
      active: true,
      config: {},
    }));
    stubRewardConfig({ tasks });
    const db = new FakeDailyRewardDb();

    await new DailyRewardService(db).ensureActiveDay('2026-07-01');

    expect(db.tasks).toHaveLength(100);
    expect(db.tasks.at(-1)?.id).toBe('task_99');
  });

  it('adds the current and next task names to Discord winner announcements', async () => {
    const db = new FakeDailyRewardDb();
    db.winnerAnnouncements = [
      {
        day: '2026-06-30',
        realm: 'Claudemoon',
        prizePoolUsd: 150,
        finalizedAt: '2026-07-01T00:00:00.000Z',
        payouts: [],
      },
    ];
    resetDailyRewardPriceCacheForTests();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const day = new URL(String(input)).searchParams.get('day');
      const tasks: DailyRewardTaskSeed[] =
        day === '2026-07-01'
          ? [
              {
                id: 'arena_today',
                type: 'arena_result',
                title: 'Win an arena match',
                description: 'Win an arena match.',
                points: 10,
                basePoints: 10,
                sortOrder: 1,
                active: true,
                config: {},
              },
            ]
          : [
              {
                id: 'inactive_task',
                type: 'quest_completion',
                title: 'Inactive task',
                description: 'Inactive task.',
                points: 10,
                basePoints: 10,
                sortOrder: 0,
                active: false,
                config: {},
              },
              {
                id: 'later_task',
                type: 'quest_completion',
                title: 'Complete later task',
                description: 'Complete later task.',
                points: 10,
                basePoints: 10,
                sortOrder: 2,
                active: true,
                config: {},
              },
              {
                id: 'quests_today',
                type: 'quest_completion',
                title: 'Complete quests',
                description: 'Complete quests.',
                points: 10,
                basePoints: 10,
                sortOrder: 1,
                active: true,
                config: {},
              },
            ];
      return new Response(JSON.stringify(rewardConfig({ tasks })), { status: 200 });
    });
    const service = new DailyRewardService(db);

    const result = (await service.discordWinnerAnnouncements(1)) as {
      days: Array<{ day: string; taskName: string; nextTaskName: string }>;
    };

    expect(result.days).toEqual([
      expect.objectContaining({
        day: '2026-06-30',
        taskName: 'Complete quests',
        nextTaskName: 'Win an arena match',
      }),
    ]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('awards quest task points using the online-time multiplier', async () => {
    const db = new FakeDailyRewardDb();
    const service = new DailyRewardService(db);
    await service.ensureActiveDay('2026-06-30');
    for (let minute = 0; minute < 60; minute += 1) {
      await service.recordOnlineMinute(
        1,
        new Date(`2026-06-30T12:${String(minute).padStart(2, '0')}:00.000Z`),
      );
    }
    await service.recordQuestCompletion(1, 101, 'wolf_hunt', new Date('2026-06-30T13:00:00.000Z'));
    await service.recordQuestCompletion(1, 102, 'wolf_hunt', new Date('2026-06-30T13:01:00.000Z'));
    const taskEvents = db.events.filter((event) => event.kind === 'task');
    expect(taskEvents).toHaveLength(2);
    expect(taskEvents[0]).toMatchObject({
      points: 30,
      key: 'task:quest_completion:quest:wolf_hunt:character:101',
      meta: {
        questId: 'wolf_hunt',
        characterId: 101,
        onlineMinutes: 60,
        multiplier: 3,
        basePoints: 10,
        undiscountedPoints: 30,
        repeatIndex: 0,
      },
    });
    expect(taskEvents[1]).toMatchObject({
      points: 15,
      key: 'task:quest_completion:quest:wolf_hunt:character:102',
      meta: {
        questId: 'wolf_hunt',
        characterId: 102,
        onlineMinutes: 60,
        multiplier: 3,
        basePoints: 10,
        undiscountedPoints: 30,
        repeatIndex: 1,
      },
    });
    expect(db.score).toBe(45);
  });

  it('halves repeated quest task points per account down to one point', async () => {
    const db = new FakeDailyRewardDb();
    const service = new DailyRewardService(db);
    await service.ensureActiveDay('2026-06-30');

    await service.recordQuestCompletion(1, 101, 'wolf_hunt', new Date('2026-06-30T13:00:00.000Z'));
    await service.recordQuestCompletion(1, 102, 'wolf_hunt', new Date('2026-06-30T13:01:00.000Z'));
    await service.recordQuestCompletion(1, 103, 'wolf_hunt', new Date('2026-06-30T13:02:00.000Z'));
    await service.recordQuestCompletion(1, 104, 'wolf_hunt', new Date('2026-06-30T13:03:00.000Z'));
    await service.recordQuestCompletion(1, 105, 'wolf_hunt', new Date('2026-06-30T13:04:00.000Z'));

    const points = db.events.filter((event) => event.kind === 'task').map((event) => event.points);
    expect(points).toEqual([10, 5, 2, 1, 1]);
    expect(db.score).toBe(19);
  });

  it('awards arena task points using win/loss base points and the online-time multiplier', async () => {
    const db = new FakeDailyRewardDb();
    const service = new DailyRewardService(db);
    resetDailyRewardPriceCacheForTests();
    stubRewardConfig({
      tasks: [
        {
          id: 'arena_results',
          type: 'arena_result',
          title: 'Arena wins and losses',
          description: 'Win or complete arena matches today.',
          points: 20,
          basePoints: 20,
          sortOrder: 1,
          active: true,
          config: {
            winBasePoints: 20,
            lossBasePoints: 10,
            minMultiplier: 1,
            maxMultiplier: 3,
            minutesPerMultiplier: 30,
          },
        },
      ],
    });
    for (let minute = 0; minute < 60; minute += 1) {
      await service.recordOnlineMinute(
        1,
        new Date(`2026-06-30T12:${String(minute).padStart(2, '0')}:00.000Z`),
      );
    }
    const excluded = await service.recordArenaResult(1, {
      won: true,
      format: '1v1',
      ratingBefore: 1500,
      ratingAfter: 1516,
      completedAt: new Date('2026-06-30T13:00:00.000Z'),
    });
    expect(excluded).toBe(0);
    expect(db.events.filter((event) => event.kind === 'task')).toHaveLength(0);

    await service.recordArenaResult(1, {
      won: true,
      format: '2v2',
      ratingBefore: 1500,
      ratingAfter: 1516,
      completedAt: new Date('2026-06-30T13:01:00.000Z'),
    });
    await service.recordArenaResult(1, {
      won: false,
      format: '2v2',
      ratingBefore: 1516,
      ratingAfter: 1500,
      completedAt: new Date('2026-06-30T13:02:00.000Z'),
    });
    const taskEvents = db.events.filter((event) => event.kind === 'task');
    expect(taskEvents).toHaveLength(2);
    expect(taskEvents[0]).toMatchObject({
      points: 60,
      meta: { format: '2v2', won: true, onlineMinutes: 60, multiplier: 3, basePoints: 20 },
    });
    expect(taskEvents[1]).toMatchObject({
      points: 30,
      meta: { format: '2v2', won: false, onlineMinutes: 60, multiplier: 3, basePoints: 10 },
    });
    expect(db.score).toBe(90);
  });

  it('records nothing for Protect Yumi results (yumi3/yumi5 excluded from the arena task)', async () => {
    const db = new FakeDailyRewardDb();
    const service = new DailyRewardService(db);
    resetDailyRewardPriceCacheForTests();
    stubRewardConfig({
      tasks: [
        {
          id: 'arena_results',
          type: 'arena_result',
          title: 'Arena wins and losses',
          description: 'Win or complete arena matches today.',
          points: 20,
          basePoints: 20,
          sortOrder: 1,
          active: true,
          config: { winBasePoints: 20, lossBasePoints: 10 },
        },
      ],
    });

    for (const format of ['yumi3', 'yumi5']) {
      for (const won of [true, false]) {
        const awarded = await service.recordArenaResult(1, {
          won,
          format,
          ratingBefore: 1500,
          ratingAfter: 1500,
          completedAt: new Date('2026-06-30T13:00:00.000Z'),
        });
        expect(awarded).toBe(0);
      }
    }
    expect(db.events.filter((event) => event.kind === 'task')).toHaveLength(0);
    expect(db.score).toBe(0);
    // The ranked path still records, so the exclusion is the format, not a stub.
    await service.recordArenaResult(1, {
      won: true,
      format: '2v2',
      ratingBefore: 1500,
      ratingAfter: 1516,
      completedAt: new Date('2026-06-30T13:02:00.000Z'),
    });
    expect(db.events.filter((event) => event.kind === 'task')).toHaveLength(1);
  });

  it('awards Vale Cup task points for ranked wins and reduced bot-match wins', async () => {
    const db = new FakeDailyRewardDb();
    const service = new DailyRewardService(db);
    resetDailyRewardPriceCacheForTests();
    stubRewardConfig({
      tasks: [
        {
          id: 'vale_cup_ranked_wins',
          type: 'vale_cup_result',
          title: 'Win Vale Cup matches',
          description:
            'Win Vale Cup football matches today. Bot-filled and practice wins award fewer points.',
          points: 25,
          basePoints: 25,
          sortOrder: 1,
          active: true,
          config: {
            winBasePoints: 25,
            botWinBasePoints: 5,
            minMultiplier: 1,
            maxMultiplier: 3,
            minutesPerMultiplier: 30,
          },
        },
      ],
    });
    for (let minute = 0; minute < 60; minute += 1) {
      await service.recordOnlineMinute(
        1,
        new Date(`2026-06-30T12:${String(minute).padStart(2, '0')}:00.000Z`),
      );
    }

    await service.recordValeCupResult(1, {
      won: false,
      bracket: 1,
      matchId: 41,
      completedAt: new Date('2026-06-30T13:00:00.000Z'),
    });
    expect(db.events.filter((event) => event.kind === 'task')).toHaveLength(0);
    expect(db.score).toBe(0);

    await service.recordValeCupResult(1, {
      won: true,
      bracket: 1,
      matchId: 41,
      rated: false,
      hasBots: false,
      completedAt: new Date('2026-06-30T13:00:30.000Z'),
    });
    expect(db.events.filter((event) => event.kind === 'task')).toHaveLength(0);
    expect(db.score).toBe(0);

    await service.recordValeCupResult(1, {
      won: true,
      bracket: 1,
      matchId: 42,
      completedAt: new Date('2026-06-30T13:01:00.000Z'),
    });
    expect(db.events.filter((event) => event.kind === 'task')).toHaveLength(0);
    expect(db.score).toBe(0);

    await service.recordValeCupResult(1, {
      won: true,
      bracket: 2,
      matchId: 45,
      completedAt: new Date('2026-06-30T13:01:30.000Z'),
    });

    const taskEvents = db.events.filter((event) => event.kind === 'task');
    expect(taskEvents).toHaveLength(1);
    expect(taskEvents[0]).toMatchObject({
      points: 75,
      key: 'task:vale_cup_ranked_wins:vale_cup:45:win:2026-06-30T13:01:30.000Z',
      meta: {
        taskId: 'vale_cup_ranked_wins',
        taskType: 'vale_cup_result',
        bracket: 2,
        matchId: 45,
        completionId: null,
        completedAt: '2026-06-30T13:01:30.000Z',
        won: true,
        matchType: 'ranked',
        rated: true,
        hasBots: false,
        onlineMinutes: 60,
        multiplier: 3,
        basePoints: 25,
      },
    });
    expect(db.score).toBe(75);

    await service.recordValeCupResult(1, {
      won: true,
      bracket: 2,
      matchId: 43,
      rated: false,
      hasBots: true,
      completedAt: new Date('2026-06-30T13:02:00.000Z'),
    });

    const botEvent = db.events.filter((event) => event.kind === 'task')[1];
    expect(botEvent).toMatchObject({
      points: 15,
      key: 'task:vale_cup_ranked_wins:vale_cup:43:bot_win:2026-06-30T13:02:00.000Z',
      meta: {
        taskId: 'vale_cup_ranked_wins',
        taskType: 'vale_cup_result',
        bracket: 2,
        matchId: 43,
        completionId: null,
        completedAt: '2026-06-30T13:02:00.000Z',
        won: true,
        matchType: 'bot',
        rated: false,
        hasBots: true,
        practice: false,
        onlineMinutes: 60,
        multiplier: 3,
        basePoints: 5,
      },
    });
    expect(db.score).toBe(90);

    await service.recordValeCupResult(1, {
      won: true,
      bracket: 2,
      matchId: 44,
      rated: false,
      hasBots: true,
      practice: true,
      completedAt: new Date('2026-06-30T13:03:00.000Z'),
    });

    const practiceEvent = db.events.filter((event) => event.kind === 'task')[2];
    expect(practiceEvent).toMatchObject({
      points: 15,
      key: 'task:vale_cup_ranked_wins:vale_cup:44:practice_win:2026-06-30T13:03:00.000Z',
      meta: {
        taskId: 'vale_cup_ranked_wins',
        taskType: 'vale_cup_result',
        bracket: 2,
        matchId: 44,
        completionId: null,
        completedAt: '2026-06-30T13:03:00.000Z',
        won: true,
        matchType: 'practice',
        rated: false,
        hasBots: true,
        practice: true,
        onlineMinutes: 60,
        multiplier: 3,
        basePoints: 5,
      },
    });
    expect(db.score).toBe(105);
  });

  it('credits Vale Cup wins after a server restart resets the match id counter', async () => {
    // Regression for issue 1831: Vale Cup match ids come from in-memory sim state
    // (VcState.nextMatchId) that createVcState resets to 1 on every server boot. Keying
    // the daily-reward dedupe row on the raw match id let a mid-day restart collide with
    // an id the account was already credited for that day, so the ON CONFLICT DO NOTHING
    // silently swallowed the win. GameServer now gives each live match object a UUID
    // and stable completion time, preserving both restart safety and replay rejection.
    vi.useFakeTimers();
    try {
      const db = new FakeDailyRewardDb();
      resetDailyRewardPriceCacheForTests();
      stubRewardConfig({
        tasks: [
          {
            id: 'vale_cup_ranked_wins',
            type: 'vale_cup_result',
            title: 'Win Vale Cup matches',
            description:
              'Win Vale Cup football matches today. Bot-filled and practice wins award fewer points.',
            points: 25,
            basePoints: 25,
            sortOrder: 1,
            active: true,
            config: {
              winBasePoints: 25,
              botWinBasePoints: 5,
              minMultiplier: 1,
              maxMultiplier: 3,
              minutesPerMultiplier: 30,
            },
          },
        ],
      });
      const completedAt = new Date('2026-06-30T20:59:00.000Z');
      const beforeRestartResult = {
        won: true,
        bracket: 2,
        matchId: 7,
        completionId: 'before-restart-match-7',
        completedAt,
      };
      const afterRestartResult = {
        won: true,
        bracket: 2,
        matchId: 7,
        completionId: 'after-restart-match-7',
        completedAt,
      };

      // Keep the clock identical across the synthetic restart. A fresh process identity,
      // rather than timestamp luck, must distinguish the reused in-memory match id.
      vi.setSystemTime(new Date('2026-06-30T20:59:00.000Z'));
      const beforeRestartService = new DailyRewardService(db);
      const beforeRestart = await beforeRestartService.recordValeCupResult(1, beforeRestartResult);
      expect(beforeRestart).toBe(25);

      const afterRestartService = new DailyRewardService(db);
      const afterRestart = await afterRestartService.recordValeCupResult(1, afterRestartResult);
      expect(afterRestart).toBe(25);
      expect(db.events.filter((event) => event.kind === 'task')).toHaveLength(2);
      expect(db.score).toBe(50);

      // A delayed replay arrives after the 22:00 UTC reward-day boundary. The match's
      // first completion time must remain stable, keeping the replay on the original day.
      vi.setSystemTime(new Date('2026-06-30T21:01:00.000Z'));
      const replay = await afterRestartService.recordValeCupResult(1, afterRestartResult);
      expect(replay).toBe(0);
      expect(db.events.filter((event) => event.kind === 'task')).toHaveLength(2);
      expect(db.score).toBe(50);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves explicit Vale Cup completion times as a compatibility fallback', async () => {
    const db = new FakeDailyRewardDb();
    const service = new DailyRewardService(db);
    resetDailyRewardPriceCacheForTests();
    stubRewardConfig({
      tasks: [
        {
          id: 'vale_cup_ranked_wins',
          type: 'vale_cup_result',
          title: 'Win Vale Cup matches',
          description: 'Win Vale Cup football matches today.',
          points: 25,
          basePoints: 25,
          sortOrder: 1,
          active: true,
          config: { winBasePoints: 25 },
        },
      ],
    });
    const result = { won: true, bracket: 2, matchId: 7 };
    const firstCompletedAt = new Date('2026-06-30T13:20:00.000Z');
    const secondCompletedAt = new Date('2026-06-30T13:21:00.000Z');

    const first = await service.recordValeCupResult(1, {
      ...result,
      completedAt: firstCompletedAt,
    });
    const second = await service.recordValeCupResult(1, {
      ...result,
      completedAt: secondCompletedAt,
    });
    const secondReplay = await service.recordValeCupResult(1, {
      ...result,
      completedAt: secondCompletedAt,
    });

    expect(first).toBe(25);
    expect(second).toBe(25);
    expect(secondReplay).toBe(0);
    expect(db.events.filter((event) => event.kind === 'task')).toHaveLength(2);
    expect(db.score).toBe(50);
  });

  it('shares one Vale Cup completion identity across every winning account', async () => {
    vi.useFakeTimers();
    try {
      const db = new FakeDailyRewardDb();
      const service = new DailyRewardService(db);
      resetDailyRewardPriceCacheForTests();
      stubRewardConfig({
        tasks: [
          {
            id: 'vale_cup_ranked_wins',
            type: 'vale_cup_result',
            title: 'Win Vale Cup matches',
            description: 'Win Vale Cup football matches today.',
            points: 25,
            basePoints: 25,
            sortOrder: 1,
            active: true,
            config: { winBasePoints: 25 },
          },
        ],
      });
      const result = {
        won: true,
        bracket: 2,
        matchId: 12,
        rated: true,
        hasBots: false,
        practice: false,
        completionId: 'shared-match-12',
        completedAt: new Date('2026-06-30T13:20:00.000Z'),
      };

      vi.setSystemTime(new Date('2026-06-30T13:20:00.000Z'));
      const firstWinner = await service.recordValeCupResult(1, result);
      vi.setSystemTime(new Date('2026-06-30T13:20:30.000Z'));
      const secondWinner = await service.recordValeCupResult(2, result);
      const firstWinnerReplay = await service.recordValeCupResult(1, result);

      expect(firstWinner).toBe(25);
      expect(secondWinner).toBe(25);
      expect(firstWinnerReplay).toBe(0);
      const taskEvents = db.events.filter((event) => event.kind === 'task');
      expect(taskEvents).toHaveLength(2);
      expect(taskEvents.map((event) => event.accountId)).toEqual([1, 2]);
      expect(taskEvents[1].key).toBe(taskEvents[0].key);
      expect(taskEvents[1].meta.completionId).toBe(taskEvents[0].meta.completionId);
      expect(taskEvents[1].meta.completedAt).toBe('2026-06-30T13:20:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('awards delve clear task points with level, tier, and online-time scaling', async () => {
    const db = new FakeDailyRewardDb();
    const service = new DailyRewardService(db);
    resetDailyRewardPriceCacheForTests();
    stubRewardConfig({
      tasks: [
        {
          id: 'delve_clears',
          type: 'delve_clear',
          title: 'Clear delves',
          description: 'Complete delves today.',
          points: 15,
          basePoints: 15,
          sortOrder: 1,
          active: true,
          config: {
            baseClearPoints: 15,
            levelBaseline: 7,
            pointsPerLevel: 1,
            normalTierMultiplier: 1,
            heroicTierMultiplier: 1.5,
            lowChestPoints: 5,
            mediumChestPoints: 10,
            premiumChestPoints: 20,
            bountifulChestMultiplier: 1.5,
            minMultiplier: 1,
            maxMultiplier: 3,
            minutesPerMultiplier: 30,
          },
        },
      ],
    });
    for (let minute = 0; minute < 60; minute += 1) {
      await service.recordOnlineMinute(
        1,
        new Date(`2026-06-30T12:${String(minute).padStart(2, '0')}:00.000Z`),
      );
    }

    await service.recordDelveClear(
      1,
      101,
      'collapsed_reliquary',
      'normal',
      new Date('2026-06-30T13:00:00.000Z'),
    );
    await service.recordDelveClear(
      1,
      101,
      'collapsed_reliquary',
      'heroic',
      new Date('2026-06-30T13:01:00.000Z'),
    );
    await service.recordDelveClear(
      1,
      101,
      'drowned_litany',
      'normal',
      new Date('2026-06-30T13:02:00.000Z'),
    );
    await service.recordDelveClear(
      1,
      101,
      'drowned_litany',
      'heroic',
      new Date('2026-06-30T13:03:00.000Z'),
    );

    const taskEvents = db.events.filter((event) => event.kind === 'task');
    expect(taskEvents).toHaveLength(4);
    expect(taskEvents[0]).toMatchObject({
      points: 45,
      key: 'task:delve_clears:delve:collapsed_reliquary:normal:character:101:2026-06-30T13:00:00.000Z',
      meta: {
        delveId: 'collapsed_reliquary',
        tierId: 'normal',
        onlineMinutes: 60,
        multiplier: 3,
        baseClearPoints: 15,
        levelBonus: 0,
        tierMultiplier: 1,
        preOnlinePoints: 15,
      },
    });
    expect(taskEvents[1]).toMatchObject({
      points: 66,
      meta: {
        delveId: 'collapsed_reliquary',
        tierId: 'heroic',
        tierMultiplier: 1.5,
        preOnlinePoints: 22,
      },
    });
    expect(taskEvents[2]).toMatchObject({
      points: 60,
      meta: {
        delveId: 'drowned_litany',
        tierId: 'normal',
        levelBonus: 5,
        preOnlinePoints: 20,
      },
    });
    expect(taskEvents[3]).toMatchObject({
      points: 90,
      meta: {
        delveId: 'drowned_litany',
        tierId: 'heroic',
        tierMultiplier: 1.5,
        preOnlinePoints: 30,
      },
    });
    expect(db.score).toBe(261);
  });

  it('awards delve chest bonus points by chest tier with online-time scaling', async () => {
    const db = new FakeDailyRewardDb();
    const service = new DailyRewardService(db);
    resetDailyRewardPriceCacheForTests();
    stubRewardConfig({
      tasks: [
        {
          id: 'delve_clears',
          type: 'delve_clear',
          title: 'Clear delves',
          description: 'Complete delves today.',
          points: 15,
          basePoints: 15,
          sortOrder: 1,
          active: true,
          config: {
            lowChestPoints: 5,
            mediumChestPoints: 10,
            premiumChestPoints: 20,
            bountifulChestMultiplier: 1.5,
            minMultiplier: 1,
            maxMultiplier: 3,
            minutesPerMultiplier: 30,
          },
        },
      ],
    });
    for (let minute = 0; minute < 30; minute += 1) {
      await service.recordOnlineMinute(
        1,
        new Date(`2026-06-30T12:${String(minute).padStart(2, '0')}:00.000Z`),
      );
    }

    await service.recordDelveChestOpen(
      1,
      101,
      'collapsed_reliquary',
      'normal',
      'low',
      false,
      new Date('2026-06-30T13:00:00.000Z'),
    );
    await service.recordDelveChestOpen(
      1,
      101,
      'collapsed_reliquary',
      'normal',
      'medium',
      false,
      new Date('2026-06-30T13:01:00.000Z'),
    );
    await service.recordDelveChestOpen(
      1,
      101,
      'collapsed_reliquary',
      'normal',
      'premium',
      true,
      new Date('2026-06-30T13:02:00.000Z'),
    );

    const taskEvents = db.events.filter((event) => event.kind === 'task');
    expect(taskEvents).toHaveLength(3);
    expect(taskEvents[0]).toMatchObject({
      points: 10,
      meta: {
        bonusType: 'delve_chest',
        delveId: 'collapsed_reliquary',
        tierId: 'normal',
        chestTier: 'low',
        bountiful: false,
        onlineMinutes: 30,
        multiplier: 2,
        chestBasePoints: 5,
        bountifulMultiplier: 1,
        preOnlinePoints: 5,
      },
    });
    expect(taskEvents[1]).toMatchObject({
      points: 20,
      meta: {
        chestTier: 'medium',
        chestBasePoints: 10,
        preOnlinePoints: 10,
      },
    });
    expect(taskEvents[2]).toMatchObject({
      points: 60,
      meta: {
        chestTier: 'premium',
        bountiful: true,
        chestBasePoints: 20,
        bountifulMultiplier: 1.5,
        preOnlinePoints: 30,
      },
    });
    expect(db.score).toBe(90);
  });

  it('does not award delve clear task points when locked or unconfigured', async () => {
    const db = new FakeDailyRewardDb();
    const service = new DailyRewardService(db);
    resetDailyRewardPriceCacheForTests();
    stubRewardConfig({
      tasks: [
        {
          id: 'delve_clears',
          type: 'delve_clear',
          title: 'Clear delves',
          description: 'Complete delves today.',
          points: 15,
          basePoints: 15,
          sortOrder: 1,
          active: true,
          config: {},
        },
      ],
    });

    balanceMock.value = 0;
    await service.recordDelveClear(
      1,
      101,
      'collapsed_reliquary',
      'normal',
      new Date('2026-06-30T13:00:00.000Z'),
    );
    expect(db.events.filter((event) => event.kind === 'task')).toHaveLength(0);

    balanceMock.value = 50;
    resetDailyRewardPriceCacheForTests();
    stubRewardConfig({ tasks: [] });
    await service.recordDelveClear(
      1,
      101,
      'collapsed_reliquary',
      'normal',
      new Date('2026-06-30T13:01:00.000Z'),
    );
    expect(db.events.filter((event) => event.kind === 'task')).toHaveLength(0);
  });

  it('uses a non-linear top-heavy payout split that sums to all prizes', () => {
    const splits = dailyRewardPayoutSplits();
    expect(splits).toEqual([0.2, 0.15, 0.12, 0.1, 0.09, 0.08, 0.075, 0.07, 0.065, 0.05]);
    expect(splits.reduce((sum, split) => sum + split, 0)).toBeCloseTo(1);
  });

  it('maps reward days to the configured UTC cycle boundary', () => {
    expect(rewardDayForDate(new Date('2026-07-02T21:59:00.000Z'), 22 * 60)).toBe('2026-07-01');
    expect(rewardDayForDate(new Date('2026-07-02T22:00:00.000Z'), 22 * 60)).toBe('2026-07-02');
    expect(nextUtcResetIso('2026-07-02', 22 * 60)).toBe('2026-07-03T22:00:00.000Z');
  });

  it('uses 22:00 UTC as the local default when no payout service is configured', async () => {
    delete process.env.WOC_DAILY_REWARD_SERVICE_URL;
    resetDailyRewardPriceCacheForTests();
    await expect(currentDailyRewardDay(new Date('2026-07-02T21:59:59.000Z'))).resolves.toBe(
      '2026-07-01',
    );
    await expect(currentDailyRewardDay(new Date('2026-07-02T22:00:00.000Z'))).resolves.toBe(
      '2026-07-02',
    );
  });

  it('selects the reward day from the schedule before requesting that exact day config', async () => {
    const requestedConfigDays: string[] = [];
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/daily-schedule') {
        return new Response(JSON.stringify({ dayStartUtcMinutes: 22 * 60 }), { status: 200 });
      }
      requestedConfigDays.push(url.searchParams.get('day') ?? '');
      return new Response(
        JSON.stringify({
          day: url.searchParams.get('day'),
          ...rewardConfig({ dayStartUtcMinutes: 21 * 60 }),
        }),
        { status: 200 },
      );
    });

    await expect(currentDailyRewardDay(new Date('2026-07-02T21:22:00.000Z'))).resolves.toBe(
      '2026-07-01',
    );
    expect(requestedConfigDays).toEqual(['2026-07-01']);
  });

  it('builds a locked view for non-eligible status', () => {
    const view = buildDailyRewardsView({
      kind: 'status',
      history: { payouts: [] },
      status: {
        day: '2026-06-30',
        resetAt: '2026-07-01T00:00:00.000Z',
        prizePoolUsd: 150,
        prizePoolSol: 1,
        eligibility: {
          eligible: false,
          reason: 'under_minimum',
          walletPubkey: 'Wallet',
          wocBalance: 1,
          wocUsdPrice: 1,
          usdValue: 1,
          minUsd: 20,
        },
        score: 0,
        rank: null,
        spin: { claimed: false, points: null, outcomeKey: null, claimedAt: null },
        tasks: [],
        leaderboard: [],
        leaderboardTotal: 0,
      },
    });
    expect(view).toMatchObject({ kind: 'ready', locked: true, lockReason: 'under_minimum' });
  });

  describe('explicit finalization and ensure/seed gating', () => {
    it('finalizes only an explicitly requested closed day and leaves idempotency to the DB', async () => {
      const db = new FakeDailyRewardDb();
      const service = new DailyRewardService(db);
      const now = new Date('2026-07-02T22:00:00.000Z');

      await expect(service.finalizeRewardDay({ day: '2026-07-01' }, now)).resolves.toEqual({
        ok: true,
        day: '2026-07-01',
        outcome: 'finalized',
      });
      await expect(service.finalizeRewardDay({ day: '2026-07-01' }, now)).resolves.toEqual({
        ok: true,
        day: '2026-07-01',
        outcome: 'already_finalized',
      });
      expect(db.finalizeDayCalls).toBe(1);
      expect(db.ensureDayCalls).toBe(1);
      expect(db.seedTasksCalls).toBe(1);
      expect(db.dayFinalizedCalls).toBe(2);
    });

    it.each(['2026-02-30', '2026-7-01', 'not-a-day'])(
      'rejects invalid reward days without touching the database: %s',
      async (day) => {
        const db = new FakeDailyRewardDb();
        const service = new DailyRewardService(db);
        await expect(service.finalizeRewardDay({ day })).resolves.toEqual({
          error: 'invalid reward day',
          status: 400,
        });
        expect(db.ensureDayCalls).toBe(0);
        expect(db.finalizeDayCalls).toBe(0);
      },
    );

    it('rejects an active reward day before any database write, even if marked finalized', async () => {
      const db = new FakeDailyRewardDb();
      db.finalizedDays.add(JSON.stringify(['2026-07-01', REALM]));
      const service = new DailyRewardService(db);
      const now = new Date('2026-07-02T21:59:59.000Z');
      await expect(service.finalizeRewardDay({ day: '2026-07-01' }, now)).resolves.toEqual({
        error: 'reward day has not closed',
        status: 409,
      });
      expect(db.ensureDayCalls).toBe(0);
      expect(db.finalizeDayCalls).toBe(0);
      expect(db.dayFinalizedCalls).toBe(0);
    });

    it('rejects a future reward day before consulting finalized state', async () => {
      const db = new FakeDailyRewardDb();
      db.finalizedDays.add(JSON.stringify(['2026-07-03', REALM]));
      const service = new DailyRewardService(db);
      await expect(
        service.finalizeRewardDay({ day: '2026-07-03' }, new Date('2026-07-02T22:00:00.000Z')),
      ).resolves.toEqual({ error: 'reward day has not closed', status: 409 });
      expect(db.dayFinalizedCalls).toBe(0);
      expect(db.finalizeDayCalls).toBe(0);
    });

    it('fails closed when the authoritative config cannot be refreshed', async () => {
      const db = new FakeDailyRewardDb();
      const service = new DailyRewardService(db);
      vi.mocked(fetch).mockRejectedValue(new Error('offline'));
      await expect(
        service.finalizeRewardDay({ day: '2026-07-01' }, new Date('2026-07-02T22:00:00.000Z')),
      ).resolves.toEqual({ error: 'daily reward config unavailable', status: 503 });
      expect(db.ensureDayCalls).toBe(0);
      expect(db.finalizeDayCalls).toBe(0);
    });

    it('bypasses a warm gameplay config cache when finalizing', async () => {
      const targetDay = '2026-07-01';
      await expect(dailyRewardRuntimeConfig(targetDay)).resolves.toMatchObject({
        prizePoolUsd: 150,
        dayStartUtcMinutes: 22 * 60,
      });
      const db = new FakeDailyRewardDb();
      const service = new DailyRewardService(db);
      vi.mocked(fetch).mockRejectedValue(new Error('authoritative source offline'));

      await expect(
        service.finalizeRewardDay({ day: targetDay }, new Date('2026-07-02T22:00:00.000Z')),
      ).resolves.toEqual({ error: 'daily reward config unavailable', status: 503 });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(db.dayFinalizedCalls).toBe(0);
      expect(db.finalizeDayCalls).toBe(0);
    });

    it.each([
      ['missing fields', { day: '2026-07-01', prizePoolUsd: 150 }],
      ['wrong day', { day: '2026-06-30', ...rewardConfig() }],
      ['invalid tasks', { day: '2026-07-01', ...rewardConfig(), tasks: [{}] }],
    ])('fails closed for a successful but %s config response', async (_label, payload) => {
      const db = new FakeDailyRewardDb();
      const service = new DailyRewardService(db);
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
      await expect(
        service.finalizeRewardDay({ day: '2026-07-01' }, new Date('2026-07-02T22:00:00.000Z')),
      ).resolves.toEqual({ error: 'daily reward config unavailable', status: 503 });
      expect(db.dayFinalizedCalls).toBe(0);
      expect(db.ensureDayCalls).toBe(0);
      expect(db.finalizeDayCalls).toBe(0);
    });

    it('seeds once across many recordOnlineMinute calls for the same day', async () => {
      const db = new FakeDailyRewardDb();
      const service = new DailyRewardService(db);
      const base = new Date('2026-07-01T12:00:00.000Z').getTime();
      for (let i = 0; i < 5; i++) {
        await service.recordOnlineMinute(1, new Date(base + i * 60_000));
      }
      // Five online-minute recorders for one day issue the ensure/seed pair once,
      // not five times. Removing the seed-gate consult makes this five.
      expect(db.ensureDayCalls).toBe(1);
      expect(db.seedTasksCalls).toBe(1);
    });

    it('shares one seed gate across status and the gameplay recorders', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));
      try {
        const db = new FakeDailyRewardDb();
        const service = new DailyRewardService(db);
        await service.status(1);
        await service.recordQuestCompletion(1, null, 'quest_completion');
        await service.recordArenaResult(1, {
          won: true,
          format: '2v2',
          ratingBefore: 1500,
          ratingAfter: 1520,
        });
        await service.recordValeCupResult(1, {
          won: true,
          bracket: 1,
          matchId: 42,
          completedAt: new Date('2026-07-01T12:01:00.000Z'),
        });
        // status plus three gameplay recorders for one day share one seed gate.
        expect(db.ensureDayCalls).toBe(1);
        expect(db.seedTasksCalls).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('reseeds when the config tasks change for the same day', async () => {
      const db = new FakeDailyRewardDb();
      const service = new DailyRewardService(db);
      await service.ensureActiveDay('2026-06-30');
      expect(db.seedTasksCalls).toBe(1);
      // A genuine config change (new tasks) must force a reseed for the same day.
      resetDailyRewardPriceCacheForTests();
      stubRewardConfig({
        tasks: [
          {
            id: 'quest_push',
            type: 'quest_completion',
            title: 'Quest push',
            description: 'Complete quests.',
            points: 25,
            sortOrder: 1,
          },
        ],
      });
      await service.ensureActiveDay('2026-06-30');
      expect(db.seedTasksCalls).toBe(2);
    });

    it('reseeds when only the prize pool changes for the same day', async () => {
      const db = new FakeDailyRewardDb();
      const service = new DailyRewardService(db);
      await service.ensureActiveDay('2026-06-30');
      expect(db.ensureDayCalls).toBe(1);
      // Change ONLY prizePoolUsd (a config field ensureDay persists): the same day
      // must reseed so the new prize pool is written, proving the gate key covers
      // the day-config fields, not just the tasks signature.
      resetDailyRewardPriceCacheForTests();
      stubRewardConfig({ prizePoolUsd: 500 });
      await service.ensureActiveDay('2026-06-30');
      expect(db.ensureDayCalls).toBe(2);
      expect(db.seedTasksCalls).toBe(2);
    });

    it('reseeds when only the WOC price changes for the same day', async () => {
      const db = new FakeDailyRewardDb();
      const service = new DailyRewardService(db);
      await service.ensureActiveDay('2026-06-30');
      expect(db.ensureDayCalls).toBe(1);
      // Change ONLY wocUsdPrice (a config field ensureDay persists): the same
      // day must reseed. This pins the SERVICE passing the price through to the
      // gate key; an ensureSeeded that stripped it (the unit key tests cannot
      // see that seam) would silently skip persisting a genuine price change.
      resetDailyRewardPriceCacheForTests();
      stubRewardConfig({ wocUsdPrice: 0.75 });
      await service.ensureActiveDay('2026-06-30');
      expect(db.ensureDayCalls).toBe(2);
      expect(db.seedTasksCalls).toBe(2);
    });

    it('retries the seed on the next call when the seed transaction fails', async () => {
      const db = new FakeDailyRewardDb();
      db.failSeedTasksTimes = 1;
      const service = new DailyRewardService(db);
      await expect(service.ensureActiveDay('2026-06-30')).rejects.toThrow(
        'seedTasks transaction rolled back',
      );
      expect(db.tasks).toEqual([]);
      // The gate did not cache the failure: the next call re-issues the write, so
      // a transient seed failure never strands the day with unwritten tasks.
      await service.ensureActiveDay('2026-06-30');
      expect(db.seedTasksCalls).toBe(2);
      expect(db.tasks.length).toBeGreaterThan(0);
    });

    it('retries the seed when the day upsert fails, not just the task write', async () => {
      const db = new FakeDailyRewardDb();
      db.failEnsureDayTimes = 1;
      const service = new DailyRewardService(db);
      await expect(service.ensureActiveDay('2026-06-30')).rejects.toThrow(
        'ensureDay upsert failed',
      );
      expect(db.tasks).toEqual([]);
      // The ensureDay arm of the gated pair fails the same way the seedTasks arm
      // does: the key is never cached, and the next call re-issues both writes.
      await service.ensureActiveDay('2026-06-30');
      expect(db.ensureDayCalls).toBe(2);
      expect(db.tasks.length).toBeGreaterThan(0);
    });
  });

  describe('board cache and busts', () => {
    // Passive expiry is deliberately NOT a bust trigger: a timed daily-reward
    // ban lapsing via expires_at flips eligibility inside the excluded view
    // (a read-side change with no write anywhere to hook), so it is accepted
    // as TTL-bounded staleness, the same tradeoff as cross-process writes.
    // The pins below are therefore complete over WRITES only.

    it('serves repeated status reads from one board snapshot while per-account reads stay live', async () => {
      const db = new FakeDailyRewardDb();
      const service = new DailyRewardService(db);
      await service.status(1);
      expect(db.leaderboardSnapshotCalls).toBe(1);
      await service.status(1);
      // The second status inside the TTL window reuses the snapshot...
      expect(db.leaderboardSnapshotCalls).toBe(1);
      // ...while the per-account reads ran again (they are never cached).
      expect(db.scoreForAccountCalls).toBe(2);
    });

    it('does not bust the board for a zero-point online-minute event', async () => {
      const db = new FakeDailyRewardDb();
      const service = new DailyRewardService(db);
      await service.status(1);
      await service.recordOnlineMinute(1);
      await service.status(1);
      // A zero-point event never changes the ranked board (every ranked read
      // filters points > 0): dropping the points > 0 guard reds here.
      expect(db.leaderboardSnapshotCalls).toBe(1);
    });

    it('does not bust the board when a duplicate event records nothing', async () => {
      const db = new FakeDailyRewardDb();
      const service = new DailyRewardService(db);
      await service.status(1);
      expect(db.leaderboardSnapshotCalls).toBe(1);
      const first = await service.recordQuestCompletion(1, 101, 'wolf_hunt');
      expect(first).toBe(10);
      await service.status(1);
      expect(db.leaderboardSnapshotCalls).toBe(2);
      // Identical inputs dedupe in addPoints (recorded false): no new event
      // row landed, so nothing on the board changed.
      const second = await service.recordQuestCompletion(1, 101, 'wolf_hunt');
      expect(second).toBe(0);
      await service.status(1);
      // 2, not 3: dropping the recorded === true guard reds here.
      expect(db.leaderboardSnapshotCalls).toBe(2);
    });

    it('busts the board when a gameplay recorder lands new points', async () => {
      const db = new FakeDailyRewardDb();
      const service = new DailyRewardService(db);
      const before = await service.status(1);
      expect(before.rank).toBeNull();
      expect(db.leaderboardSnapshotCalls).toBe(1);
      await service.recordQuestCompletion(1, 101, 'wolf_hunt');
      const after = await service.status(1);
      // The recorder busted the snapshot, so the next status refetched and the
      // new points are visible immediately, never TTL-delayed.
      expect(db.leaderboardSnapshotCalls).toBe(2);
      expect(after.rank).toBe(1);
      expect(after.leaderboardTotal).toBe(1);
    });

    it('serves the rank > 10 viewer row from the same snapshot, never a second query', async () => {
      const db = new FakeDailyRewardDb();
      const service = new DailyRewardService(db);
      // Ten scorers ahead of alice: her rank is 11, so status() takes the
      // conditional viewer-row branch beyond the top-10 slice.
      const ahead = Array.from({ length: 10 }, (_, i) => ({
        accountId: 101 + i,
        username: `scorer${i + 1}`,
        points: 1_000 - i,
        rank: i + 1,
      }));
      db.snapshotRows = [...ahead, { accountId: 1, username: 'alice', points: 5, rank: 11 }];
      const status = await service.status(1);
      // The viewer row must be a derivation of the ONE snapshot. The direct
      // per-status ranked reads were deleted from DailyRewardDb outright, so
      // reverting the service to this.db.leaderboardRowForAccount no longer
      // even compiles; the snapshot-call and length pins below guard the
      // derivation itself.
      expect(db.leaderboardSnapshotCalls).toBe(1);
      expect(status.rank).toBe(11);
      expect(status.leaderboardTotal).toBe(11);
      expect(status.leaderboard).toHaveLength(11);
      const viewer = status.leaderboard[10];
      expect(viewer).toEqual({ rank: 11, name: 'alice', points: 5, me: true });
    });

    it('routes every point write through the one busting wrapper', () => {
      // Source pin: exactly ONE this.db.addPoints call site exists in the
      // service, inside recordPoints. A recorder reverting to a direct
      // this.db.addPoints call would skip the bust and leave its event class
      // TTL-stale on the board; this catches all seven current recorder
      // sites and any future one without per-site tests.
      const src = readFileSync(resolve(__dirname, '../server/daily_rewards.ts'), 'utf8');
      expect(src.match(/this\.db\.addPoints\(/g) ?? []).toHaveLength(1);
      const start = src.indexOf('private async recordPoints(');
      expect(start).toBeGreaterThan(-1);
      const body = src.slice(start, src.indexOf('\n  }', start));
      expect(body).toContain('this.db.addPoints(');
    });

    it('constructs the board cache with the shared 30s TTL constant', () => {
      // Source pin: the service must pass DAILY_REWARD_BOARD_TTL_MS itself.
      // The constructor defaults to the same constant, so every behavioral
      // suite stays green under a divergent literal here (bust-driven tests
      // ignore TTL; reuse tests pass under any longer one), yet the 30s
      // ceiling is the cross-process delisting bound the bust doctrine
      // leans on. Wrap-tolerant: the argument may sit on either line.
      const src = readFileSync(resolve(__dirname, '../server/daily_rewards.ts'), 'utf8');
      const start = src.indexOf('new DailyRewardBoardCache(');
      expect(start).toBeGreaterThan(-1);
      const construction = src.slice(start, src.indexOf(');', start));
      expect(construction).toMatch(/ttlMs:\s*DAILY_REWARD_BOARD_TTL_MS/);
    });

    it('scopes the cache per service instance, never at module level', async () => {
      // Two services over two fakes: each must refresh its OWN snapshot and
      // serve its own board. A regression to a module-scoped cache would
      // serve db1's board to service2 (and skip db2's refresh entirely);
      // this pins the isolation directly instead of leaning on in-file test
      // order and wall-clock TTL luck.
      const db1 = new FakeDailyRewardDb();
      const db2 = new FakeDailyRewardDb();
      db1.score = 40;
      db2.score = 0;
      const service1 = new DailyRewardService(db1);
      const service2 = new DailyRewardService(db2);
      const status1 = await service1.status(1);
      const status2 = await service2.status(1);
      expect(db1.leaderboardSnapshotCalls).toBe(1);
      expect(db2.leaderboardSnapshotCalls).toBe(1);
      expect(status1.rank).toBe(1);
      expect(status2.rank).toBeNull();
      expect(status1.leaderboard).toHaveLength(1);
      expect(status2.leaderboard).toHaveLength(0);
    });

    it('busts the board when a spin is recorded even if its point event dedupes', async () => {
      const db = new FakeDailyRewardDb();
      const service = new DailyRewardService(db);
      await service.status(1);
      expect(db.leaderboardSnapshotCalls).toBe(1);
      // Pre-plant the spin's idempotency key so addPoints records nothing:
      // the only bust left on the spin path is the recordSpin one.
      db.events.push({ accountId: 1, kind: 'spin', points: 0, key: 'spin', meta: {} });
      const result = await service.spin(1);
      expect('error' in result).toBe(false);
      // The internal status refetched: dropping the recordSpin bust reds here.
      expect(db.leaderboardSnapshotCalls).toBe(2);
    });

    it('returns post-spin board state from the spin call itself', async () => {
      const db = new FakeDailyRewardDb();
      const service = new DailyRewardService(db);
      // Cache a rank-null, empty-board snapshot first.
      const before = await service.status(1);
      expect(before.rank).toBeNull();
      vi.spyOn(Math, 'random').mockReturnValueOnce(0); // outcome s20, 20 points
      const result = await service.spin(1);
      expect('error' in result).toBe(false);
      if ('error' in result) return;
      // Both busts land before the internal status read, so the spin response
      // reflects the just-recorded points; a bust moved after (or racing) the
      // internal status would serve the stale rank-null board here.
      expect(result.rank).toBe(1);
      expect(result.leaderboard).toEqual([
        expect.objectContaining({ rank: 1, name: 'alice', points: 20, me: true }),
      ]);
      expect(result.leaderboardTotal).toBe(1);
    });
  });

  it('marks Arena and Vale Cup task descriptions with the 1v1 restriction', () => {
    const restriction = '1v1 matches do not grant daily reward points.';
    expect(dailyRewardTaskDescription('arena_result', 'Complete arena matches.', restriction)).toBe(
      `Complete arena matches. ${restriction}`,
    );
    expect(
      dailyRewardTaskDescription('vale_cup_result', 'Win Vale Cup matches.', restriction),
    ).toBe(`Win Vale Cup matches. ${restriction}`);
    expect(dailyRewardTaskDescription('quest_completion', 'Complete quests.', restriction)).toBe(
      'Complete quests.',
    );
    expect(dailyRewardTaskDescription('delve_clear', 'Complete delves.', restriction)).toBe(
      'Complete delves.',
    );
  });
});
