import { timingSafeEqual } from 'node:crypto';
import type * as http from 'node:http';
import type {
  DailyRewardHistory,
  DailyRewardLeaderboardEntry,
  DailyRewardLeaderboardPage,
  DailyRewardSpinResult,
  DailyRewardStatus,
} from '../src/world_api';
import { type DailyRewardDb, type DailyRewardTaskSeed, PgDailyRewardDb } from './daily_rewards_db';
import { walletForAccount } from './db';
import { json, readBody } from './http_util';
import { cachedWocBalance } from './woc_balance';

const DEFAULT_MIN_USD = 20;
const DEFAULT_POOL_USD = 150;
const DEFAULT_ACTIVE_SECONDS = 120;
const DEFAULT_DAY_START_UTC_MINUTES = 21 * 60;
const DEFAULT_CONFIG_TTL_MS = 5 * 60_000;
const DAILY_REWARD_CONFIG_TTL_MS = Number(
  process.env.WOC_DAILY_REWARD_CONFIG_TTL_MS ?? DEFAULT_CONFIG_TTL_MS,
);

export const DAILY_REWARD_SPLITS = [
  0.2, 0.15, 0.12, 0.1, 0.09, 0.08, 0.075, 0.07, 0.065, 0.05,
] as const;

const SPIN_OUTCOMES = [
  { key: 's20', points: 20, weight: 25 },
  { key: 's30', points: 30, weight: 22 },
  { key: 's40', points: 40, weight: 18 },
  { key: 's50', points: 50, weight: 14 },
  { key: 's75', points: 75, weight: 9 },
  { key: 's100', points: 100, weight: 6 },
  { key: 's150', points: 150, weight: 4 },
  { key: 's250', points: 250, weight: 2 },
] as const;

const DEFAULT_TASKS: DailyRewardTaskSeed[] = [
  {
    id: 'quest_completion',
    type: 'quest_completion',
    title: 'Complete quests',
    description: 'Complete quests today. Points increase with time spent online.',
    points: 10,
    basePoints: 10,
    sortOrder: 1,
    config: {
      minMultiplier: 1,
      maxMultiplier: 3,
      minutesPerMultiplier: 30,
    },
  },
];

interface RuntimeConfigCache {
  day: string;
  config: DailyRewardRuntimeConfig;
  at: number;
}

interface Eligibility {
  eligible: boolean;
  reason: 'eligible' | 'no_wallet' | 'under_minimum' | 'price_unavailable';
  walletPubkey: string | null;
  wocBalance: number | null;
  wocUsdPrice: number | null;
  usdValue: number | null;
  minUsd: number;
}

export interface DailyRewardRuntimeConfig {
  minUsd: number;
  prizePoolUsd: number;
  prizePoolSol: number | null;
  wocUsdPrice: number | null;
  solUsdPrice: number | null;
  activeSeconds: number;
  dayStartUtcMinutes: number;
  tasks: DailyRewardTaskSeed[];
}

let runtimeConfigCache: RuntimeConfigCache | null = null;
let runtimeConfigFailureLog: { key: string; at: number } | null = null;

export function utcRewardDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function rewardDayForDate(
  now = new Date(),
  dayStartUtcMinutes = DEFAULT_DAY_START_UTC_MINUTES,
): string {
  return new Date(now.getTime() - dayStartUtcMinutes * 60_000).toISOString().slice(0, 10);
}

export function addRewardDays(day: string, offset: number): string {
  const start = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(start)) return utcRewardDay();
  return new Date(start + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function nextUtcResetIso(
  day: string,
  dayStartUtcMinutes = DEFAULT_DAY_START_UTC_MINUTES,
): string {
  const start = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(start)
    ? new Date(start + (dayStartUtcMinutes + 24 * 60) * 60_000).toISOString()
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

export function dailyRewardPayoutSplits(): readonly number[] {
  return DAILY_REWARD_SPLITS;
}

export function resetDailyRewardPriceCacheForTests(): void {
  runtimeConfigCache = null;
}

function finitePositive(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function finiteNonNegativeInteger(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function finiteDayStartUtcMinutes(value: unknown): number | null {
  const minutes = finiteNonNegativeInteger(value);
  return minutes !== null && minutes < 24 * 60 ? minutes : null;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function objectField(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sanitizeTaskDefinition(value: unknown, index: number): DailyRewardTaskSeed | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = stringField(record, 'id');
  const type = stringField(record, 'type');
  const title = stringField(record, 'title');
  if (!id || !type || !title || !/^[a-z0-9_:-]{1,64}$/.test(id)) return null;
  const points =
    finiteNonNegativeInteger(record.points) ??
    finiteNonNegativeInteger(record.basePoints) ??
    finiteNonNegativeInteger(record.base_points) ??
    0;
  return {
    id,
    type,
    title,
    description: stringField(record, 'description') ?? '',
    points,
    basePoints:
      finiteNonNegativeInteger(record.basePoints) ??
      finiteNonNegativeInteger(record.base_points) ??
      points,
    sortOrder:
      finiteNonNegativeInteger(record.sortOrder) ??
      finiteNonNegativeInteger(record.sort_order) ??
      index + 1,
    active: record.active !== false,
    config: objectField(record, 'config'),
  };
}

function parseTaskPayload(payload: unknown): DailyRewardTaskSeed[] {
  const rawTasks = Array.isArray(payload)
    ? payload
    : payload &&
        typeof payload === 'object' &&
        Array.isArray((payload as { tasks?: unknown }).tasks)
      ? (payload as { tasks: unknown[] }).tasks
      : [];
  const tasks = rawTasks
    .map((task, index) => sanitizeTaskDefinition(task, index))
    .filter((task): task is DailyRewardTaskSeed => task !== null);
  return tasks.length > 0 ? tasks : DEFAULT_TASKS;
}

function fallbackRuntimeConfig(): DailyRewardRuntimeConfig {
  return {
    minUsd: DEFAULT_MIN_USD,
    prizePoolUsd: DEFAULT_POOL_USD,
    prizePoolSol: null,
    wocUsdPrice: null,
    solUsdPrice: null,
    activeSeconds: DEFAULT_ACTIVE_SECONDS,
    dayStartUtcMinutes: DEFAULT_DAY_START_UTC_MINUTES,
    tasks: DEFAULT_TASKS,
  };
}

function parseRuntimeConfigPayload(payload: unknown): DailyRewardRuntimeConfig {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const fallback = fallbackRuntimeConfig();
  return {
    minUsd: finitePositive(record.minUsd) ?? finitePositive(record.min_usd) ?? fallback.minUsd,
    prizePoolUsd:
      finitePositive(record.prizePoolUsd) ??
      finitePositive(record.prize_pool_usd) ??
      fallback.prizePoolUsd,
    prizePoolSol: finitePositive(record.prizePoolSol) ?? finitePositive(record.prize_pool_sol),
    wocUsdPrice: finitePositive(record.wocUsdPrice) ?? finitePositive(record.woc_usd_price),
    solUsdPrice: finitePositive(record.solUsdPrice) ?? finitePositive(record.sol_usd_price),
    activeSeconds:
      finitePositive(record.activeSeconds) ??
      finitePositive(record.active_seconds) ??
      fallback.activeSeconds,
    dayStartUtcMinutes:
      finiteDayStartUtcMinutes(record.dayStartUtcMinutes) ??
      finiteDayStartUtcMinutes(record.day_start_utc_minutes) ??
      fallback.dayStartUtcMinutes,
    tasks: parseTaskPayload(record.tasks),
  };
}

function dailyRewardServiceSecret(): string {
  // Dedicated secret only: never fall back to RESTART_COUNTDOWN_SECRET. That is an
  // unrelated ops secret, and reusing it would let its holder call the daily-rewards
  // internal payout endpoints (pending-payouts/mark-payout). internalAuthorized fails
  // closed when this is unset, so the internal surface stays locked until it is set.
  return process.env.WOC_DAILY_REWARD_SERVICE_SECRET ?? '';
}

function dailyRewardServiceUrl(): string {
  return (process.env.WOC_DAILY_REWARD_SERVICE_URL ?? '').trim();
}

function runtimeConfigFailureMessage(err: unknown): string {
  if (err instanceof Error && 'cause' in err) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause && typeof cause === 'object' && 'code' in cause) {
      const code = String((cause as { code?: unknown }).code ?? '');
      if (code === 'ECONNREFUSED') {
        return 'payout service is not reachable, start or restart the local payout service';
      }
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('401')) {
    return 'payout service rejected the shared secret, check WOC_DAILY_REWARD_SERVICE_SECRET and DAILY_REWARD_INTERNAL_SECRET';
  }
  if (message.includes('405')) {
    return 'payout service does not expose GET /daily-config, restart it with the latest service code';
  }
  return message;
}

function logRuntimeConfigFailure(err: unknown): void {
  const message = runtimeConfigFailureMessage(err);
  const now = Date.now();
  if (
    runtimeConfigFailureLog &&
    runtimeConfigFailureLog.key === message &&
    now - runtimeConfigFailureLog.at < 60_000
  ) {
    return;
  }
  runtimeConfigFailureLog = { key: message, at: now };
  console.warn(`[daily-rewards] using fallback config: ${message}`);
}

export async function dailyRewardRuntimeConfig(
  day = utcRewardDay(),
): Promise<DailyRewardRuntimeConfig> {
  const now = Date.now();
  if (
    runtimeConfigCache &&
    runtimeConfigCache.day === day &&
    now - runtimeConfigCache.at < DAILY_REWARD_CONFIG_TTL_MS
  ) {
    return runtimeConfigCache.config;
  }
  const serviceUrl = dailyRewardServiceUrl();
  if (!serviceUrl) {
    const config = fallbackRuntimeConfig();
    runtimeConfigCache = { day, config, at: now };
    return config;
  }
  try {
    const url = new URL('/daily-config', serviceUrl.endsWith('/') ? serviceUrl : `${serviceUrl}/`);
    url.searchParams.set('day', day);
    const secret = dailyRewardServiceSecret();
    const headers: Record<string, string> = secret ? { 'x-woc-daily-reward-secret': secret } : {};
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`config request failed: ${res.status}`);
    const config = parseRuntimeConfigPayload(await res.json());
    runtimeConfigCache = { day, config, at: now };
    return config;
  } catch (err) {
    logRuntimeConfigFailure(err);
    return runtimeConfigCache?.day === day ? runtimeConfigCache.config : fallbackRuntimeConfig();
  }
}

export async function wocUsdPrice(day = utcRewardDay()): Promise<number | null> {
  return (await dailyRewardRuntimeConfig(day)).wocUsdPrice;
}

export async function solUsdPrice(day = utcRewardDay()): Promise<number | null> {
  return (await dailyRewardRuntimeConfig(day)).solUsdPrice;
}

async function dailyRewardClock(now = new Date()): Promise<{
  day: string;
  config: DailyRewardRuntimeConfig;
}> {
  const provisionalDay = utcRewardDay(now);
  const provisionalConfig = await dailyRewardRuntimeConfig(provisionalDay);
  const day = rewardDayForDate(now, provisionalConfig.dayStartUtcMinutes);
  if (day === provisionalDay) return { day, config: provisionalConfig };
  return { day, config: await dailyRewardRuntimeConfig(day) };
}

async function prizePoolSol(config: DailyRewardRuntimeConfig): Promise<number | null> {
  if (config.prizePoolSol !== null) return config.prizePoolSol;
  if (config.solUsdPrice === null) return null;
  return config.prizePoolUsd / config.solUsdPrice;
}

export async function dailyRewardEligibility(
  accountId: number,
  config?: DailyRewardRuntimeConfig,
): Promise<Eligibility> {
  const runtimeConfig = config ?? (await dailyRewardRuntimeConfig());
  const wallet = await walletForAccount(accountId);
  if (!wallet) {
    return {
      eligible: false,
      reason: 'no_wallet',
      walletPubkey: null,
      wocBalance: null,
      wocUsdPrice: runtimeConfig.wocUsdPrice,
      usdValue: null,
      minUsd: runtimeConfig.minUsd,
    };
  }
  const [balance, price] = await Promise.all([
    cachedWocBalance(wallet.pubkey),
    Promise.resolve(runtimeConfig.wocUsdPrice),
  ]);
  if (balance === null || price === null) {
    return {
      eligible: false,
      reason: 'price_unavailable',
      walletPubkey: wallet.pubkey,
      wocBalance: balance,
      wocUsdPrice: price,
      usdValue: null,
      minUsd: runtimeConfig.minUsd,
    };
  }
  const usdValue = balance * price;
  return {
    eligible: usdValue >= runtimeConfig.minUsd,
    reason: usdValue >= runtimeConfig.minUsd ? 'eligible' : 'under_minimum',
    walletPubkey: wallet.pubkey,
    wocBalance: balance,
    wocUsdPrice: price,
    usdValue,
    minUsd: runtimeConfig.minUsd,
  };
}

function pickSpinOutcome(seed = Math.random()): (typeof SPIN_OUTCOMES)[number] {
  const total = SPIN_OUTCOMES.reduce((sum, outcome) => sum + outcome.weight, 0);
  let roll = Math.max(0, Math.min(0.999999, seed)) * total;
  for (const outcome of SPIN_OUTCOMES) {
    roll -= outcome.weight;
    if (roll <= 0) return outcome;
  }
  return SPIN_OUTCOMES[SPIN_OUTCOMES.length - 1];
}

function leaderboardView(
  rows: Awaited<ReturnType<DailyRewardDb['leaderboard']>>,
  accountId: number | null,
): DailyRewardLeaderboardEntry[] {
  return rows.map((row) => ({
    rank: row.rank,
    name: row.username,
    points: row.points,
    me: accountId !== null && row.accountId === accountId,
  }));
}

function numberConfig(config: Record<string, unknown>, key: string, fallback: number): number {
  const value = finitePositive(config[key]);
  return value ?? fallback;
}

function questCompletionPoints(
  task:
    | DailyRewardTaskSeed
    | { points: number; basePoints: number; config: Record<string, unknown> },
  onlineMinutes: number,
): {
  points: number;
  multiplier: number;
} {
  const basePoints = task.basePoints ?? task.points;
  const minMultiplier = numberConfig(task.config ?? {}, 'minMultiplier', 1);
  const maxMultiplier = Math.max(
    minMultiplier,
    numberConfig(task.config ?? {}, 'maxMultiplier', 3),
  );
  const minutesPerMultiplier = numberConfig(task.config ?? {}, 'minutesPerMultiplier', 30);
  const multiplier = Math.min(
    maxMultiplier,
    minMultiplier + Math.floor(Math.max(0, onlineMinutes) / minutesPerMultiplier),
  );
  return { points: Math.max(0, Math.floor(basePoints * multiplier)), multiplier };
}

function repeatQuestPoints(points: number, priorCompletions: number): number {
  if (points <= 0) return 0;
  return Math.max(1, Math.floor(points / 2 ** Math.max(0, priorCompletions)));
}

function onlineMultiplierPoints(
  basePoints: number,
  config: Record<string, unknown>,
  onlineMinutes: number,
): {
  points: number;
  multiplier: number;
} {
  const minMultiplier = numberConfig(config, 'minMultiplier', 1);
  const maxMultiplier = Math.max(minMultiplier, numberConfig(config, 'maxMultiplier', 3));
  const minutesPerMultiplier = numberConfig(config, 'minutesPerMultiplier', 30);
  const multiplier = Math.min(
    maxMultiplier,
    minMultiplier + Math.floor(Math.max(0, onlineMinutes) / minutesPerMultiplier),
  );
  return { points: Math.max(0, Math.floor(basePoints * multiplier)), multiplier };
}

function currentTaskMultiplier(
  task: { type: string; points: number; basePoints: number; config: Record<string, unknown> },
  onlineMinutes: number,
): number | null {
  if (task.type === 'quest_completion')
    return questCompletionPoints(task, onlineMinutes).multiplier;
  if (task.type === 'arena_result')
    return onlineMultiplierPoints(task.basePoints ?? task.points, task.config ?? {}, onlineMinutes)
      .multiplier;
  return null;
}

export class DailyRewardService {
  constructor(private readonly db: DailyRewardDb = new PgDailyRewardDb()) {}

  async activeSeconds(day?: string): Promise<number> {
    if (day) return (await dailyRewardRuntimeConfig(day)).activeSeconds;
    return (await dailyRewardClock()).config.activeSeconds;
  }

  async ensureActiveDay(day = utcRewardDay()): Promise<DailyRewardRuntimeConfig> {
    const config = await dailyRewardRuntimeConfig(day);
    await this.db.ensureDay(day, config.prizePoolUsd, config.wocUsdPrice);
    await this.db.seedTasks(day, config.tasks);
    return config;
  }

  async status(accountId: number): Promise<DailyRewardStatus> {
    const { day, config } = await dailyRewardClock();
    await this.db.ensureDay(day, config.prizePoolUsd, config.wocUsdPrice);
    await this.db.seedTasks(day, config.tasks);
    const eligibility = await dailyRewardEligibility(accountId, config);
    const [score, rank, spin, tasks, leaders, leaderboardTotal, onlineMinutes] = await Promise.all([
      this.db.scoreForAccount(day, accountId),
      this.db.rankForAccount(day, accountId),
      this.db.spinForAccount(day, accountId),
      this.db.tasksForAccount(day, accountId),
      this.db.leaderboard(day, accountId, 10),
      this.db.leaderboardTotal(day),
      this.db.onlineMinutesForAccount(day, accountId),
    ]);
    const leaderboardRows = [...leaders];
    if (rank !== null && rank > 10) {
      const viewerRow = await this.db.leaderboardRowForAccount(day, accountId);
      if (viewerRow) leaderboardRows.push(viewerRow);
    }
    return {
      day,
      resetAt: nextUtcResetIso(day, config.dayStartUtcMinutes),
      prizePoolUsd: config.prizePoolUsd,
      prizePoolSol: await prizePoolSol(config),
      eligibility,
      score,
      rank,
      spin: spin
        ? {
            claimed: true,
            points: spin.points,
            outcomeKey: spin.outcomeKey,
            claimedAt: spin.createdAt,
          }
        : { claimed: false, points: null, outcomeKey: null, claimedAt: null },
      tasks: tasks.map((task) => ({
        ...task,
        id: task.taskId,
        multiplier: currentTaskMultiplier(task, onlineMinutes),
        locked: !eligibility.eligible,
      })),
      leaderboard: leaderboardView(leaderboardRows, accountId),
      leaderboardTotal,
    };
  }

  async leaderboardPage(
    day: string,
    page: number,
    pageSize: number,
    accountId: number | null = null,
  ): Promise<DailyRewardLeaderboardPage> {
    const pageData = await this.db.leaderboardPage(day, page, pageSize);
    return {
      day,
      leaders: leaderboardView(pageData.rows, accountId),
      page: pageData.page,
      pageSize: pageData.pageSize,
      pageCount: pageData.pageCount,
      total: pageData.total,
    };
  }

  async spin(
    accountId: number,
  ): Promise<DailyRewardSpinResult | { error: string; status: number }> {
    const { day, config } = await dailyRewardClock();
    await this.db.ensureDay(day, config.prizePoolUsd, config.wocUsdPrice);
    await this.db.seedTasks(day, config.tasks);
    const eligibility = await dailyRewardEligibility(accountId, config);
    if (!eligibility.eligible)
      return { error: 'daily rewards are locked for this wallet', status: 403 };
    const existing = await this.db.spinForAccount(day, accountId);
    if (existing) return { error: 'daily spin already claimed', status: 409 };
    const outcome = pickSpinOutcome();
    const recorded = await this.db.recordSpin(day, accountId, outcome.key, outcome.points);
    if (!recorded) return { error: 'daily spin already claimed', status: 409 };
    await this.db.addPoints(day, accountId, 'spin', outcome.points, 'spin', {
      outcome: outcome.key,
    });
    const status = await this.status(accountId);
    return { ...status, awardedPoints: outcome.points, outcomeKey: outcome.key };
  }

  async recordOnlineMinute(accountId: number, activeAt: Date = new Date()): Promise<void> {
    const { day, config } = await dailyRewardClock(activeAt);
    await this.db.ensureDay(day, config.prizePoolUsd, config.wocUsdPrice);
    await this.db.seedTasks(day, config.tasks);
    const minute = activeAt.toISOString().slice(0, 16);
    await this.db.addPoints(day, accountId, 'online', 0, `online:${minute}`, {
      minute,
    });
  }

  async recordQuestCompletion(
    accountId: number,
    characterId: number | null,
    questId: string,
    completedAt: Date = new Date(),
  ): Promise<number> {
    if (!questId) return 0;
    const { day, config } = await dailyRewardClock(completedAt);
    await this.db.ensureDay(day, config.prizePoolUsd, config.wocUsdPrice);
    await this.db.seedTasks(day, config.tasks);
    const eligibility = await dailyRewardEligibility(accountId, config);
    if (!eligibility.eligible) return 0;
    const tasks = await this.db.tasksForType(day, 'quest_completion');
    if (tasks.length === 0) return 0;
    const onlineMinutes = await this.db.onlineMinutesForAccount(day, accountId);
    let awardedPoints = 0;
    for (const task of tasks) {
      const { points, multiplier } = questCompletionPoints(task, onlineMinutes);
      if (points <= 0) continue;
      const priorCompletions = await this.db.questTaskCompletionCount(
        day,
        accountId,
        task.taskId,
        questId,
      );
      const awarded = repeatQuestPoints(points, priorCompletions);
      const recorded = await this.db.addPoints(
        day,
        accountId,
        'task',
        awarded,
        `task:${task.taskId}:quest:${questId}:character:${characterId ?? 'account'}`,
        {
          taskId: task.taskId,
          taskType: task.type,
          questId,
          characterId,
          onlineMinutes,
          multiplier,
          basePoints: task.basePoints,
          undiscountedPoints: points,
          repeatIndex: priorCompletions,
        },
      );
      if (recorded) awardedPoints += awarded;
    }
    return awardedPoints;
  }

  async recordArenaResult(
    accountId: number,
    result: {
      won: boolean;
      format: string;
      ratingBefore: number;
      ratingAfter: number;
      completedAt?: Date;
    },
  ): Promise<number> {
    const completedAt = result.completedAt ?? new Date();
    const { day, config } = await dailyRewardClock(completedAt);
    await this.db.ensureDay(day, config.prizePoolUsd, config.wocUsdPrice);
    await this.db.seedTasks(day, config.tasks);
    const eligibility = await dailyRewardEligibility(accountId, config);
    if (!eligibility.eligible) return 0;
    const tasks = await this.db.tasksForType(day, 'arena_result');
    if (tasks.length === 0) return 0;
    const onlineMinutes = await this.db.onlineMinutesForAccount(day, accountId);
    let awardedPoints = 0;
    for (const task of tasks) {
      const taskConfig = task.config ?? {};
      const basePoints = result.won
        ? numberConfig(taskConfig, 'winBasePoints', task.basePoints ?? task.points)
        : numberConfig(taskConfig, 'lossBasePoints', 10);
      const { points, multiplier } = onlineMultiplierPoints(basePoints, taskConfig, onlineMinutes);
      if (points <= 0) continue;
      const recorded = await this.db.addPoints(
        day,
        accountId,
        'task',
        points,
        `task:${task.taskId}:arena:${result.format}:${result.won ? 'win' : 'loss'}:${completedAt.toISOString()}:${result.ratingBefore}:${result.ratingAfter}`,
        {
          taskId: task.taskId,
          taskType: task.type,
          format: result.format,
          won: result.won,
          onlineMinutes,
          multiplier,
          basePoints,
          ratingBefore: result.ratingBefore,
          ratingAfter: result.ratingAfter,
        },
      );
      if (recorded) awardedPoints += points;
    }
    return awardedPoints;
  }

  async history(limit = 30): Promise<DailyRewardHistory> {
    const rows = await this.db.recentPayouts(limit);
    return {
      payouts: rows.map((row) => ({
        day: row.day,
        rank: row.rank,
        name: row.username,
        points: row.points,
        prizePercent: row.prizePercent,
        prizeUsd: row.prizeUsd,
        status: row.status,
        txSignature: row.txSignature,
        paidAt: row.paidAt,
      })),
    };
  }

  async payoutHistory(limit = 100): Promise<unknown> {
    return { payouts: await this.db.recentPayouts(limit) };
  }

  async discordWinnerAnnouncements(limit = 1): Promise<unknown> {
    await this.finalizePreviousDay();
    return { days: await this.db.unannouncedWinnerDays(limit) };
  }

  async markDiscordWinnersAnnounced(
    body: unknown,
  ): Promise<{ ok: true } | { error: string; status: number }> {
    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const day = typeof record.day === 'string' ? record.day : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return { error: 'invalid reward day', status: 400 };
    }
    const ok = await this.db.markWinnersAnnounced(day);
    return ok ? { ok: true } : { error: 'reward day not found', status: 404 };
  }

  async finalizePreviousDay(now = new Date()): Promise<void> {
    const { day } = await dailyRewardClock(now);
    const previous = addRewardDays(day, -1);
    const config = await this.ensureActiveDay(previous);
    await this.db.finalizeDay(previous, config.prizePoolUsd, DAILY_REWARD_SPLITS);
  }

  async pendingPayouts(limit = 20): Promise<unknown> {
    await this.finalizePreviousDay();
    return { payouts: await this.db.pendingPayouts(limit) };
  }

  async markPayout(body: unknown): Promise<{ ok: true } | { error: string; status: number }> {
    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const day = typeof record.day === 'string' ? record.day : '';
    const rank = Number(record.rank);
    const status = typeof record.status === 'string' ? record.status : '';
    const txSignature = typeof record.txSignature === 'string' ? record.txSignature : null;
    const error = typeof record.error === 'string' ? record.error.slice(0, 1000) : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(rank) || rank < 1 || rank > 10) {
      return { error: 'invalid payout target', status: 400 };
    }
    if (status !== 'paid' && status !== 'failed')
      return { error: 'invalid payout status', status: 400 };
    const ok = await this.db.markPayout(day, rank, status, txSignature, error);
    return ok ? { ok: true } : { error: 'payout not found', status: 404 };
  }
}

function secretsMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function internalAuthorized(req: http.IncomingMessage): boolean {
  const expected = dailyRewardServiceSecret();
  if (!expected) return false;
  return secretsMatch(String(req.headers['x-woc-daily-reward-secret'] ?? ''), expected);
}

export const dailyRewardService = new DailyRewardService();

export async function handleDailyRewardApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/api/daily-rewards') {
    return json(res, 200, await dailyRewardService.status(accountId));
  }
  if (req.method === 'GET' && url.pathname === '/api/daily-rewards/leaderboard') {
    const { day } = await dailyRewardClock();
    return json(
      res,
      200,
      await dailyRewardService.leaderboardPage(
        day,
        Number(url.searchParams.get('page')) || 0,
        Number(url.searchParams.get('pageSize')) || 20,
        accountId,
      ),
    );
  }
  if (req.method === 'POST' && url.pathname === '/api/daily-rewards/spin') {
    const result = await dailyRewardService.spin(accountId);
    if ('error' in result) return json(res, result.status, { error: result.error });
    return json(res, 200, result);
  }
  if (req.method === 'GET' && url.pathname === '/api/daily-rewards/history') {
    return json(
      res,
      200,
      await dailyRewardService.history(Number(url.searchParams.get('limit')) || 30),
    );
  }
  return json(res, 404, { error: 'unknown endpoint' });
}

export async function handleDailyRewardInternalApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/internal/daily-rewards/')) return false;
  if (!internalAuthorized(req)) {
    json(res, 401, { success: false, data: null, error: 'not authenticated' });
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/internal/daily-rewards/pending-payouts') {
    const data = await dailyRewardService.pendingPayouts(
      Number(url.searchParams.get('limit')) || 20,
    );
    json(res, 200, { success: true, data, error: null });
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/internal/daily-rewards/payout-history') {
    const data = await dailyRewardService.payoutHistory(
      Number(url.searchParams.get('limit')) || 100,
    );
    json(res, 200, { success: true, data, error: null });
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/internal/daily-rewards/leaderboard') {
    const requestedDay = url.searchParams.get('day') || '';
    const { day } = requestedDay ? { day: requestedDay } : await dailyRewardClock();
    const data = await dailyRewardService.leaderboardPage(
      day,
      Number(url.searchParams.get('page')) || 0,
      Number(url.searchParams.get('pageSize')) || 50,
    );
    json(res, 200, { success: true, data, error: null });
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/internal/daily-rewards/mark-payout') {
    const result = await dailyRewardService.markPayout(await readBody(req));
    if ('error' in result)
      json(res, result.status, { success: false, data: null, error: result.error });
    else json(res, 200, { success: true, data: result, error: null });
    return true;
  }
  json(res, 404, { success: false, data: null, error: 'unknown endpoint' });
  return true;
}
