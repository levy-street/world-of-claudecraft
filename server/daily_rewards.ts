import { timingSafeEqual } from 'node:crypto';
import type * as http from 'node:http';
import { DELVES } from '../src/sim/data';
import type { LootTier } from '../src/sim/lockpick';
import type {
  DailyRewardHistory,
  DailyRewardLeaderboardEntry,
  DailyRewardLeaderboardPage,
  DailyRewardSpinResult,
  DailyRewardStatus,
} from '../src/world_api';
import { DailyRewardScheduleCache } from './daily_reward_schedule';
import { DAILY_REWARD_BOARD_TTL_MS, DailyRewardBoardCache } from './daily_rewards_board_cache';
import {
  type DailyRewardDb,
  type DailyRewardInternalPayoutRow,
  type DailyRewardPayoutActor,
  type DailyRewardPayoutAttemptRow,
  type DailyRewardScoreRow,
  type DailyRewardTaskSeed,
  PgDailyRewardDb,
  REWARD_DAY_SHAPE,
} from './daily_rewards_db';
import { buildSeedKey, runSeedOnce } from './daily_rewards_seed_gate';
import { accountAndScopeForToken, moderationStatusForAccount, walletForAccount } from './db';
import { ctxAccountId } from './http/context';
import { type BearerActiveGuardDb, createActiveGuard } from './http/middleware/bearer_active_guard';
import {
  DAILY_REWARD_SECRET_ENV,
  DAILY_REWARD_SECRET_HEADER,
  requireInternalSecretFailClosed,
} from './http/middleware/require_internal_secret';
import type { Ctx, RouteDef } from './http/types';
import { json, readBody } from './http_util';
import { REALM } from './realm';
import { cachedWocBalance } from './woc_balance';

const DEFAULT_MIN_USD = 20;
const DEFAULT_POOL_USD = 150;
const DEFAULT_ACTIVE_SECONDS = 120;
const DEFAULT_DAY_START_UTC_MINUTES = 22 * 60;
const MAX_DAILY_REWARD_TASKS = 100;
const DEFAULT_CONFIG_TTL_MS = 5 * 60_000;
const DAILY_REWARD_CONFIG_TTL_MS = Number(
  process.env.WOC_DAILY_REWARD_CONFIG_TTL_MS ?? DEFAULT_CONFIG_TTL_MS,
);

// Lenient coerce-and-clamp decode defaults for the daily-rewards paginated reads
// (Number(param) || DEFAULT). These are the fallback page/limit when a query param
// is absent or non-numeric; the coercion shape is UNCHANGED, only the literal is
// named. Exported so their values are pinned by tests/server/tunables.test.ts.
export const DAILY_DEFAULT_PAGE = 0; // page index (count, zero-based)
export const DAILY_PLAYER_LEADERBOARD_PAGE_SIZE = 20; // rows per player leaderboard page (count)
export const DAILY_HISTORY_LIMIT = 30; // player payout-history rows (count)
export const DAILY_OPS_PENDING_PAYOUTS_LIMIT = 20; // ops pending-payouts rows (count)
export const DAILY_OPS_PAYOUT_HISTORY_LIMIT = 100; // ops payout-history rows (count)
export const DAILY_OPS_LEADERBOARD_PAGE_SIZE = 50; // rows per ops leaderboard page (count)

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
  reason: 'eligible' | 'no_wallet' | 'under_minimum' | 'price_unavailable' | 'banned';
  banReason: string | null;
  banExpiresAt: string | null;
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
const dailyRewardScheduleCache = new DailyRewardScheduleCache(fetchDailyRewardSchedule, {
  ttlMs: DAILY_REWARD_CONFIG_TTL_MS,
});

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

function isRewardDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
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
  dailyRewardScheduleCache.reset();
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
    .slice(0, MAX_DAILY_REWARD_TASKS)
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

function featuredDailyRewardTaskName(config: DailyRewardRuntimeConfig): string {
  const [task] = config.tasks
    .filter((candidate) => candidate.active !== false)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  return task?.title ?? DEFAULT_TASKS[0].title;
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

function parseStrictRuntimeConfigPayload(
  payload: unknown,
  expectedDay: string,
): DailyRewardRuntimeConfig {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('config response must be an object');
  }
  const record = payload as Record<string, unknown>;
  if (record.day !== expectedDay) throw new Error('config response day did not match request');

  const minUsd = finitePositive(record.minUsd);
  const prizePoolUsd = finitePositive(record.prizePoolUsd);
  const activeSeconds = finitePositive(record.activeSeconds);
  const dayStartUtcMinutes = finiteDayStartUtcMinutes(record.dayStartUtcMinutes);
  if (
    minUsd === null ||
    prizePoolUsd === null ||
    activeSeconds === null ||
    dayStartUtcMinutes === null
  ) {
    throw new Error('config response contained invalid required fields');
  }
  if (!Array.isArray(record.tasks) || record.tasks.length === 0) {
    throw new Error('config response contained no task definitions');
  }
  if (record.tasks.length > MAX_DAILY_REWARD_TASKS) {
    throw new Error('config response contained too many task definitions');
  }
  const tasks = record.tasks.map((task, index) => sanitizeTaskDefinition(task, index));
  if (tasks.some((task) => task === null)) {
    throw new Error('config response contained an invalid task definition');
  }

  return {
    minUsd,
    prizePoolUsd,
    prizePoolSol: finitePositive(record.prizePoolSol),
    wocUsdPrice: finitePositive(record.wocUsdPrice),
    solUsdPrice: finitePositive(record.solUsdPrice),
    activeSeconds,
    dayStartUtcMinutes,
    tasks: tasks as DailyRewardTaskSeed[],
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

function dailyRewardServiceHeaders(): Record<string, string> {
  const secret = dailyRewardServiceSecret();
  return secret ? { 'x-woc-daily-reward-secret': secret } : {};
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

async function fetchDailyRewardSchedule(): Promise<number> {
  const serviceUrl = dailyRewardServiceUrl();
  if (!serviceUrl) return DEFAULT_DAY_START_UTC_MINUTES;
  const url = new URL('/daily-schedule', serviceUrl.endsWith('/') ? serviceUrl : `${serviceUrl}/`);
  const res = await fetch(url, {
    headers: dailyRewardServiceHeaders(),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`schedule request failed: ${res.status}`);
  const payload = (await res.json()) as Record<string, unknown>;
  const minutes = finiteDayStartUtcMinutes(payload.dayStartUtcMinutes);
  if (minutes === null) throw new Error('schedule response contained an invalid day start');
  return minutes;
}

async function fetchDailyRewardRuntimeConfig(
  day: string,
  strict = false,
): Promise<DailyRewardRuntimeConfig> {
  const serviceUrl = dailyRewardServiceUrl();
  if (!serviceUrl) return fallbackRuntimeConfig();
  const url = new URL('/daily-config', serviceUrl.endsWith('/') ? serviceUrl : `${serviceUrl}/`);
  url.searchParams.set('day', day);
  const res = await fetch(url, {
    headers: dailyRewardServiceHeaders(),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`config request failed: ${res.status}`);
  const payload = await res.json();
  return strict
    ? parseStrictRuntimeConfigPayload(payload, day)
    : parseRuntimeConfigPayload(payload);
}

export async function dailyRewardRuntimeConfig(
  day = utcRewardDay(),
  requireFresh = false,
): Promise<DailyRewardRuntimeConfig> {
  const now = Date.now();
  if (
    !requireFresh &&
    runtimeConfigCache &&
    runtimeConfigCache.day === day &&
    now - runtimeConfigCache.at < DAILY_REWARD_CONFIG_TTL_MS
  ) {
    return runtimeConfigCache.config;
  }
  try {
    const config = await fetchDailyRewardRuntimeConfig(day, requireFresh);
    runtimeConfigCache = { day, config, at: now };
    return config;
  } catch (err) {
    if (requireFresh) throw err;
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
  const dayStartUtcMinutes = await dailyRewardScheduleCache.read();
  const day = rewardDayForDate(now, dayStartUtcMinutes);
  const config = await dailyRewardRuntimeConfig(day);
  return { day, config: { ...config, dayStartUtcMinutes } };
}

export async function currentDailyRewardDay(now = new Date()): Promise<string> {
  return (await dailyRewardClock(now)).day;
}

// Single-slot memo for dailyRewardEventsCutoffDay, keyed on (UTC day, clamped
// retention). Resolving the current reward day can require schedule and config
// requests, so a catch-up sweep must not repeat that work for every batch. The
// key uses the plain UTC day, never the reward day: resolving the reward day is
// exactly the work being avoided.
let cutoffMemo: { utcDay: string; days: number; cutoff: string } | null = null;

export function resetDailyRewardEventsCutoffMemoForTests(): void {
  cutoffMemo = null;
}

// The pure cutoff derivation, split out so the fail-closed arm is directly
// testable. FAIL CLOSED on a malformed anchor day: addRewardDays' fallback for
// an unparseable day string is TODAY, which passes the prune's own
// REWARD_DAY_SHAPE guard and would turn a parse failure into a cutoff that
// deletes the entire ledger before today. currentDailyRewardDay cannot emit
// such a value today (its days are toISOString-derived), so this is
// defense-in-depth on an irreversible delete path, not a live-bug fix.
export function dailyRewardEventsCutoffFromAnchor(anchorDay: string, days: number): string | null {
  if (!REWARD_DAY_SHAPE.test(anchorDay)) return null;
  return addRewardDays(anchorDay, -days);
}

// The retention cutoff for the daily_reward_events ledger, as a reward-clock day
// string, or null when retention is off (0 or negative = keep forever). Fractional
// values clamp to at least one day: 0.5 must never floor to a cutoff of "today",
// which would delete the entire ledger before today. The cutoff must come from the
// reward clock (the day boundary sits at a configured UTC offset, not midnight),
// which is why this lives here and not in the sweep wiring.
export async function dailyRewardEventsCutoffDay(
  retentionDays: number,
  now = new Date(),
): Promise<string | null> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return null;
  const days = Math.max(1, Math.floor(retentionDays));
  const utcDay = utcRewardDay(now);
  if (cutoffMemo && cutoffMemo.utcDay === utcDay && cutoffMemo.days === days) {
    return cutoffMemo.cutoff;
  }
  const cutoff = dailyRewardEventsCutoffFromAnchor(await currentDailyRewardDay(now), days);
  if (cutoff === null) return null; // malformed anchor: keep the ledger, cache nothing
  cutoffMemo = { utcDay, days, cutoff };
  return cutoff;
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
      banReason: null,
      banExpiresAt: null,
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
      banReason: null,
      banExpiresAt: null,
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
    banReason: null,
    banExpiresAt: null,
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
  rows: DailyRewardScoreRow[],
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

function delveClearPoints(
  task: { points: number; basePoints: number; config: Record<string, unknown> },
  delveId: string,
  tierId: string,
  onlineMinutes: number,
): {
  points: number;
  multiplier: number;
  baseClearPoints: number;
  levelBonus: number;
  tierMultiplier: number;
  preOnlinePoints: number;
} | null {
  const delve = DELVES[delveId];
  if (!delve?.tiers.some((tier) => tier.id === tierId)) return null;
  const taskConfig = task.config ?? {};
  const baseClearPoints = numberConfig(
    taskConfig,
    'baseClearPoints',
    task.basePoints ?? task.points,
  );
  const levelBaseline = numberConfig(taskConfig, 'levelBaseline', 7);
  const pointsPerLevel = numberConfig(taskConfig, 'pointsPerLevel', 1);
  const normalTierMultiplier = numberConfig(taskConfig, 'normalTierMultiplier', 1);
  const heroicTierMultiplier = numberConfig(taskConfig, 'heroicTierMultiplier', 1.5);
  const tierMultiplier = tierId === 'heroic' ? heroicTierMultiplier : normalTierMultiplier;
  const levelBonus = Math.max(0, delve.minLevel - levelBaseline) * pointsPerLevel;
  const preOnlinePoints = Math.max(0, Math.floor((baseClearPoints + levelBonus) * tierMultiplier));
  const { points, multiplier } = onlineMultiplierPoints(preOnlinePoints, taskConfig, onlineMinutes);
  return {
    points,
    multiplier,
    baseClearPoints,
    levelBonus,
    tierMultiplier,
    preOnlinePoints,
  };
}

function delveChestOpenPoints(
  task: { config: Record<string, unknown> },
  chestTier: LootTier,
  bountiful: boolean,
  onlineMinutes: number,
): {
  points: number;
  multiplier: number;
  chestBasePoints: number;
  chestTier: LootTier;
  bountifulMultiplier: number;
  preOnlinePoints: number;
} | null {
  const taskConfig = task.config ?? {};
  const chestBasePoints =
    chestTier === 'premium'
      ? numberConfig(taskConfig, 'premiumChestPoints', 20)
      : chestTier === 'medium'
        ? numberConfig(taskConfig, 'mediumChestPoints', 10)
        : chestTier === 'low'
          ? numberConfig(taskConfig, 'lowChestPoints', 5)
          : null;
  if (chestBasePoints === null) return null;
  const bountifulMultiplier = bountiful
    ? numberConfig(taskConfig, 'bountifulChestMultiplier', 1.5)
    : 1;
  const preOnlinePoints = Math.max(0, Math.floor(chestBasePoints * bountifulMultiplier));
  const { points, multiplier } = onlineMultiplierPoints(preOnlinePoints, taskConfig, onlineMinutes);
  return {
    points,
    multiplier,
    chestBasePoints,
    chestTier,
    bountifulMultiplier,
    preOnlinePoints,
  };
}

function currentTaskMultiplier(
  task: { type: string; points: number; basePoints: number; config: Record<string, unknown> },
  onlineMinutes: number,
): number | null {
  if (task.type === 'quest_completion')
    return questCompletionPoints(task, onlineMinutes).multiplier;
  if (task.type === 'arena_result' || task.type === 'vale_cup_result')
    return onlineMultiplierPoints(task.basePoints ?? task.points, task.config ?? {}, onlineMinutes)
      .multiplier;
  if (task.type === 'delve_clear')
    return onlineMultiplierPoints(task.basePoints ?? task.points, task.config ?? {}, onlineMinutes)
      .multiplier;
  return null;
}

export class DailyRewardService {
  constructor(private readonly db: DailyRewardDb = new PgDailyRewardDb()) {}

  // One ranked snapshot per TTL window serves the four board reads status()
  // assembles; every board-changing write below busts it (see recordPoints
  // and spin), and main.ts busts it from the moderation hook.
  private readonly boardCache = new DailyRewardBoardCache(
    (day) => this.db.leaderboardSnapshot(day),
    { ttlMs: DAILY_REWARD_BOARD_TTL_MS },
  );

  private async eligibility(
    accountId: number,
    config: DailyRewardRuntimeConfig,
  ): Promise<Eligibility> {
    const ban = await this.db.banForAccount(accountId);
    if (ban) {
      return {
        eligible: false,
        reason: 'banned',
        banReason: ban.reason,
        banExpiresAt: ban.expiresAt,
        walletPubkey: null,
        wocBalance: null,
        wocUsdPrice: config.wocUsdPrice,
        usdValue: null,
        minUsd: config.minUsd,
      };
    }
    return dailyRewardEligibility(accountId, config);
  }

  async activeSeconds(day?: string): Promise<number> {
    if (day) return (await dailyRewardRuntimeConfig(day)).activeSeconds;
    return (await dailyRewardClock()).config.activeSeconds;
  }

  // The single seed path every method funnels through. The seed gate runs the
  // ensureDay + seedTasks write pair at most once per (day, realm, config) key,
  // so status, spin, recordOnlineMinute, the five gameplay recorders, and the
  // finalize path (via ensureActiveDay) all share one gate per day instead of
  // each re-issuing the pair on every call.
  private async ensureSeeded(day: string, config: DailyRewardRuntimeConfig): Promise<void> {
    await runSeedOnce(buildSeedKey(day, REALM, config), async () => {
      await this.db.ensureDay(day, config.prizePoolUsd, config.wocUsdPrice);
      await this.db.seedTasks(day, config.tasks);
    });
  }

  async ensureActiveDay(day = utcRewardDay()): Promise<DailyRewardRuntimeConfig> {
    const config = await dailyRewardRuntimeConfig(day);
    await this.ensureSeeded(day, config);
    return config;
  }

  async status(accountId: number): Promise<DailyRewardStatus> {
    const { day, config } = await dailyRewardClock();
    await this.ensureSeeded(day, config);
    const eligibility = await this.eligibility(accountId, config);
    // The four ranked reads come from the board cache (one snapshot per TTL
    // window); the per-account reads stay live on the db.
    const [score, rank, spin, tasks, leaders, leaderboardTotal, onlineMinutes] = await Promise.all([
      this.db.scoreForAccount(day, accountId),
      this.boardCache.rankForAccount(day, accountId),
      this.db.spinForAccount(day, accountId),
      this.db.tasksForAccount(day, accountId),
      this.boardCache.leaderboard(day, 10),
      this.boardCache.leaderboardTotal(day),
      this.db.onlineMinutesForAccount(day, accountId),
    ]);
    const leaderboardRows = [...leaders];
    if (rank !== null && rank > 10) {
      const viewerRow = await this.boardCache.leaderboardRowForAccount(day, accountId);
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

  // Deliberately a live db read, never the board cache: both the player and
  // ops arms page beyond the cached top slice and tolerate no cache-page drift.
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
    await this.ensureSeeded(day, config);
    const eligibility = await this.eligibility(accountId, config);
    if (!eligibility.eligible)
      return { error: 'daily rewards are locked for this wallet', status: 403 };
    const existing = await this.db.spinForAccount(day, accountId);
    if (existing) return { error: 'daily spin already claimed', status: 409 };
    const outcome = pickSpinOutcome();
    const recorded = await this.db.recordSpin(day, accountId, outcome.key, outcome.points);
    if (!recorded) return { error: 'daily spin already claimed', status: 409 };
    // recordSpin atomically records both the claim and its score while holding
    // the open-day lock, so finalization can never land between those writes.
    this.boardCache.bust();
    const status = await this.status(accountId);
    return { ...status, awardedPoints: outcome.points, outcomeKey: outcome.key };
  }

  // The one point-event write path: every recorder funnels through here so
  // the board cache is busted exactly when the ranked board could have
  // changed. The two guards: a duplicate event (recorded false) wrote
  // nothing, and a non-positive event (recordOnlineMinute's zero-point
  // per-minute marker) never changes the ranked board (every ranked read
  // filters points > 0). If a negative-point clawback is ever added it could
  // lower a still-ranked row, so widen the guard to points !== 0 with it.
  private async recordPoints(
    day: string,
    accountId: number,
    kind: string,
    points: number,
    idempotencyKey: string,
    meta?: Record<string, unknown>,
  ): Promise<boolean> {
    const recorded = await this.db.addPoints(day, accountId, kind, points, idempotencyKey, meta);
    if (recorded && points > 0) this.boardCache.bust();
    return recorded;
  }

  /** Drop the in-process board snapshot so the next ranked read refreshes. */
  bustBoardCache(): void {
    this.boardCache.bust();
  }

  /** Board-cache refresh telemetry for the metrics surface (unwired for now). */
  boardCacheStats(): { refreshes: number; lastRefreshMs: number | null } {
    return this.boardCache.stats();
  }

  async recordOnlineMinute(accountId: number, activeAt: Date = new Date()): Promise<void> {
    const { day, config } = await dailyRewardClock(activeAt);
    await this.ensureSeeded(day, config);
    const minute = activeAt.toISOString().slice(0, 16);
    await this.recordPoints(day, accountId, 'online', 0, `online:${minute}`, {
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
    await this.ensureSeeded(day, config);
    const eligibility = await this.eligibility(accountId, config);
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
      const recorded = await this.recordPoints(
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
    // One-player teams are too easy to coordinate for daily-reward scoring.
    // Protect Yumi (yumi3/yumi5) is also an unranked objective mode. Fiesta
    // keeps its historical counting behavior.
    if (result.format === '1v1' || result.format === 'yumi3' || result.format === 'yumi5') return 0;
    const completedAt = result.completedAt ?? new Date();
    const { day, config } = await dailyRewardClock(completedAt);
    await this.ensureSeeded(day, config);
    const eligibility = await this.eligibility(accountId, config);
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
      const recorded = await this.recordPoints(
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

  async recordDelveClear(
    accountId: number,
    characterId: number | null,
    delveId: string,
    tierId: string,
    completedAt: Date = new Date(),
  ): Promise<number> {
    if (!DELVES[delveId]) return 0;
    const { day, config } = await dailyRewardClock(completedAt);
    await this.ensureSeeded(day, config);
    const eligibility = await this.eligibility(accountId, config);
    if (!eligibility.eligible) return 0;
    const tasks = await this.db.tasksForType(day, 'delve_clear');
    if (tasks.length === 0) return 0;
    const onlineMinutes = await this.db.onlineMinutesForAccount(day, accountId);
    let awardedPoints = 0;
    for (const task of tasks) {
      const clearPoints = delveClearPoints(task, delveId, tierId, onlineMinutes);
      if (!clearPoints || clearPoints.points <= 0) continue;
      const recorded = await this.recordPoints(
        day,
        accountId,
        'task',
        clearPoints.points,
        `task:${task.taskId}:delve:${delveId}:${tierId}:character:${characterId ?? 'account'}:${completedAt.toISOString()}`,
        {
          taskId: task.taskId,
          taskType: task.type,
          delveId,
          tierId,
          characterId,
          onlineMinutes,
          multiplier: clearPoints.multiplier,
          baseClearPoints: clearPoints.baseClearPoints,
          levelBonus: clearPoints.levelBonus,
          tierMultiplier: clearPoints.tierMultiplier,
          preOnlinePoints: clearPoints.preOnlinePoints,
        },
      );
      if (recorded) awardedPoints += clearPoints.points;
    }
    return awardedPoints;
  }

  async recordDelveChestOpen(
    accountId: number,
    characterId: number | null,
    delveId: string,
    tierId: string,
    chestTier: LootTier,
    bountiful: boolean,
    openedAt: Date = new Date(),
  ): Promise<number> {
    if (!DELVES[delveId]) return 0;
    const { day, config } = await dailyRewardClock(openedAt);
    await this.ensureSeeded(day, config);
    const eligibility = await this.eligibility(accountId, config);
    if (!eligibility.eligible) return 0;
    const tasks = await this.db.tasksForType(day, 'delve_clear');
    if (tasks.length === 0) return 0;
    const onlineMinutes = await this.db.onlineMinutesForAccount(day, accountId);
    let awardedPoints = 0;
    for (const task of tasks) {
      const chestPoints = delveChestOpenPoints(task, chestTier, bountiful, onlineMinutes);
      if (!chestPoints || chestPoints.points <= 0) continue;
      const recorded = await this.recordPoints(
        day,
        accountId,
        'task',
        chestPoints.points,
        `task:${task.taskId}:delve_chest:${delveId}:${tierId}:${chestTier}:${bountiful ? 'bountiful' : 'standard'}:character:${characterId ?? 'account'}:${openedAt.toISOString()}`,
        {
          taskId: task.taskId,
          taskType: task.type,
          bonusType: 'delve_chest',
          delveId,
          tierId,
          characterId,
          chestTier: chestPoints.chestTier,
          bountiful,
          onlineMinutes,
          multiplier: chestPoints.multiplier,
          chestBasePoints: chestPoints.chestBasePoints,
          bountifulMultiplier: chestPoints.bountifulMultiplier,
          preOnlinePoints: chestPoints.preOnlinePoints,
        },
      );
      if (recorded) awardedPoints += chestPoints.points;
    }
    return awardedPoints;
  }

  // Vale Cup daily task: wins only. Rated wins use the full task value; bot-filled
  // and practice wins use a much smaller base so they can contribute without competing
  // with real ranked match rewards. The GameServer supplies one UUID and completion time
  // per live match object, so every winner and retry shares an identity while a restarted
  // server gets a fresh identity even when the sim reuses its in-memory numeric match id.
  async recordValeCupResult(
    accountId: number,
    result: {
      won: boolean;
      bracket: number;
      matchId: number;
      rated?: boolean;
      hasBots?: boolean;
      practice?: boolean;
      completionId?: string;
      completedAt: Date;
    },
  ): Promise<number> {
    if (result.bracket === 1) return 0;
    if (!result.won) return 0;
    if (result.rated === false && result.hasBots !== true && result.practice !== true) return 0;
    const completedAt = result.completedAt;
    const completedAtIso = completedAt.toISOString();
    const completionId = result.completionId?.trim() || null;
    const { day, config } = await dailyRewardClock(completedAt);
    await this.ensureSeeded(day, config);
    const eligibility = await this.eligibility(accountId, config);
    if (!eligibility.eligible) return 0;
    const tasks = await this.db.tasksForType(day, 'vale_cup_result');
    if (tasks.length === 0) return 0;
    const onlineMinutes = await this.db.onlineMinutesForAccount(day, accountId);
    let awardedPoints = 0;
    for (const task of tasks) {
      const taskConfig = task.config ?? {};
      const rankedBasePoints = numberConfig(
        taskConfig,
        'winBasePoints',
        task.basePoints ?? task.points,
      );
      const botFallbackPoints = Math.max(1, Math.floor(rankedBasePoints * 0.2));
      const reducedMatch = result.hasBots === true || result.practice === true;
      const basePoints = reducedMatch
        ? numberConfig(taskConfig, 'botWinBasePoints', botFallbackPoints)
        : rankedBasePoints;
      const { points, multiplier } = onlineMultiplierPoints(basePoints, taskConfig, onlineMinutes);
      if (points <= 0) continue;
      const outcomeKey =
        result.practice === true ? 'practice_win' : reducedMatch ? 'bot_win' : 'win';
      const recorded = await this.recordPoints(
        day,
        accountId,
        'task',
        points,
        `task:${task.taskId}:vale_cup:${result.matchId}:${outcomeKey}:${completionId ?? completedAtIso}`,
        {
          taskId: task.taskId,
          taskType: task.type,
          bracket: result.bracket,
          matchId: result.matchId,
          completionId,
          completedAt: completedAtIso,
          won: true,
          matchType: result.practice === true ? 'practice' : reducedMatch ? 'bot' : 'ranked',
          rated: result.rated !== false,
          hasBots: result.hasBots === true,
          practice: result.practice === true,
          onlineMinutes,
          multiplier,
          basePoints,
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
    const days = await this.db.unannouncedWinnerDays(limit);
    const rewardDays = [...new Set(days.flatMap((day) => [day.day, addRewardDays(day.day, 1)]))];
    const taskNames = new Map(
      await Promise.all(
        rewardDays.map(
          async (day) =>
            [day, featuredDailyRewardTaskName(await dailyRewardRuntimeConfig(day))] as const,
        ),
      ),
    );
    return {
      days: days.map((day) => ({
        ...day,
        taskName: taskNames.get(day.day) ?? DEFAULT_TASKS[0].title,
        nextTaskName: taskNames.get(addRewardDays(day.day, 1)) ?? DEFAULT_TASKS[0].title,
      })),
    };
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

  async finalizeRewardDay(
    body: unknown,
    now = new Date(),
  ): Promise<
    | { ok: true; day: string; outcome: 'finalized' | 'already_finalized' }
    | { error: string; status: number }
  > {
    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const day = typeof record.day === 'string' ? record.day : '';
    if (!isRewardDay(day)) return { error: 'invalid reward day', status: 400 };
    if (!dailyRewardServiceUrl()) {
      return { error: 'daily reward config unavailable', status: 503 };
    }

    let config: DailyRewardRuntimeConfig;
    try {
      // Money-moving actions consume one fresh, strictly decoded snapshot. Its
      // boundary, pool, tasks, and requested day therefore cannot come from
      // different dashboard revisions.
      config = await dailyRewardRuntimeConfig(day, true);
    } catch (error) {
      console.error(
        '[daily-rewards] finalization blocked: authoritative config unavailable',
        error,
      );
      return { error: 'daily reward config unavailable', status: 503 };
    }
    const currentDay = rewardDayForDate(now, config.dayStartUtcMinutes);
    if (day >= currentDay) return { error: 'reward day has not closed', status: 409 };

    // This read is only an optimization for retrying an already-completed day.
    // It deliberately follows closure validation, so even inconsistent legacy
    // rows cannot bypass the authoritative cutoff. A miss is never trusted for
    // exclusivity; finalizeDay's conditional UPDATE remains authoritative.
    if (await this.db.dayFinalized(day, REALM)) {
      return { ok: true, day, outcome: 'already_finalized' };
    }
    await this.ensureSeeded(day, config);
    const startedAt = Date.now();
    const outcome = await this.db.finalizeDay(day, config.prizePoolUsd, DAILY_REWARD_SPLITS);
    console.info(
      `[daily-rewards] finalize day=${day} realm=${REALM} outcome=${outcome} durationMs=${Date.now() - startedAt}`,
    );
    return { ok: true, day, outcome };
  }

  async pendingPayouts(limit = 20, day?: string): Promise<unknown> {
    return { payouts: await this.db.pendingPayouts(limit, day) };
  }

  async markPayout(body: unknown): Promise<
    | {
        ok: true;
        payout?: DailyRewardInternalPayoutRow;
        attempt?: DailyRewardPayoutAttemptRow;
      }
    | { error: string; status: number }
  > {
    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const day = typeof record.day === 'string' ? record.day : '';
    const rank = Number(record.rank);
    const status = typeof record.status === 'string' ? record.status : '';
    const txSignature = typeof record.txSignature === 'string' ? record.txSignature : null;
    const error = typeof record.error === 'string' ? record.error.slice(0, 1000) : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(rank) || rank < 1 || rank > 10) {
      return { error: 'invalid payout target', status: 400 };
    }
    if (
      !['processing', 'paid', 'failed', 'resend_processing', 'resent', 'resend_failed'].includes(
        status,
      )
    )
      return { error: 'invalid payout status', status: 400 };
    if (
      ['processing', 'paid', 'resend_processing', 'resent', 'resend_failed'].includes(status) &&
      !txSignature
    ) {
      return { error: 'transaction signature is required', status: 400 };
    }
    const signedTransaction =
      typeof record.signedTransaction === 'string' ? record.signedTransaction : null;
    if (signedTransaction && signedTransaction.length > 5000) {
      return { error: 'signed transaction is too large', status: 400 };
    }
    const operationId = typeof record.operationId === 'string' ? record.operationId.trim() : '';
    if (status.startsWith('resend') || status === 'resent') {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(operationId)) {
        return { error: 'valid resend operation id is required', status: 400 };
      }
    }
    if (status === 'processing') {
      const result = await this.db.claimPayout(day, rank, txSignature as string, signedTransaction);
      if (result.outcome === 'not_found') return { error: 'payout not found', status: 404 };
      if (result.outcome === 'invalid_status') {
        return { error: 'payout cannot be claimed', status: 409 };
      }
      return { ok: true, payout: result.payout };
    }
    if (status === 'resend_processing') {
      const result = await this.db.claimPayoutResend(
        day,
        rank,
        operationId,
        txSignature as string,
        signedTransaction,
      );
      if (result.outcome === 'not_found') return { error: 'paid payout not found', status: 404 };
      if (result.outcome === 'invalid_status') {
        return { error: 'only paid payouts can be resent', status: 409 };
      }
      return { ok: true, attempt: result.attempt };
    }
    if (status === 'resent' || status === 'resend_failed') {
      const ok = await this.db.markPayoutResend(
        day,
        rank,
        operationId,
        status === 'resent' ? 'paid' : 'failed',
        txSignature as string,
        error,
      );
      return ok ? { ok: true } : { error: 'resend attempt not found', status: 404 };
    }
    const ok = await this.db.markPayout(day, rank, status, txSignature, error);
    return ok ? { ok: true } : { error: 'payout not found', status: 404 };
  }

  async voidPayout(
    body: unknown,
  ): Promise<
    { ok: true; payout: DailyRewardInternalPayoutRow } | { error: string; status: number }
  > {
    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const target = payoutModerationTarget(record);
    if ('error' in target) return target;
    const reason = typeof record.reason === 'string' ? record.reason.trim() : '';
    if (reason.length < 3 || reason.length > 500) {
      return { error: 'invalid void reason', status: 400 };
    }
    const actor = payoutModerationActor(record);
    if (!actor) return { error: 'invalid payout actor', status: 400 };
    const result = await this.db.voidPayout(target.day, target.rank, reason, actor);
    if (result.outcome === 'not_found') return { error: 'payout not found', status: 404 };
    if (result.outcome === 'invalid_status') {
      return { error: 'payout cannot be voided', status: 409 };
    }
    return { ok: true, payout: result.payout };
  }

  async restorePayout(
    body: unknown,
  ): Promise<
    { ok: true; payout: DailyRewardInternalPayoutRow } | { error: string; status: number }
  > {
    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const target = payoutModerationTarget(record);
    if ('error' in target) return target;
    const actor = payoutModerationActor(record);
    if (!actor) return { error: 'invalid payout actor', status: 400 };
    const result = await this.db.restorePayout(target.day, target.rank, actor);
    if (result.outcome === 'not_found') return { error: 'payout not found', status: 404 };
    if (result.outcome === 'invalid_status') {
      return { error: 'payout cannot be restored', status: 409 };
    }
    return { ok: true, payout: result.payout };
  }
}

function payoutModerationTarget(
  record: Record<string, unknown>,
): { day: string; rank: number } | { error: string; status: 400 } {
  const day = typeof record.day === 'string' ? record.day : '';
  const rank = Number(record.rank);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(rank) || rank < 1 || rank > 10) {
    return { error: 'invalid payout target', status: 400 };
  }
  return { day, rank };
}

function payoutModerationActor(record: Record<string, unknown>): DailyRewardPayoutActor | null {
  const id = typeof record.actorId === 'string' ? record.actorId.trim() : '';
  const username = typeof record.actorUsername === 'string' ? record.actorUsername.trim() : '';
  if (!id || id.length > 200 || !username || username.length > 100) return null;
  return { id, username };
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

// main.ts wires this into bustBoardCaches: the board cache is instance-scoped
// on the module singleton above, so a bust exported from the cache module
// itself would hold no handle to the live instance.
export function bustDailyRewardBoardCache(): void {
  dailyRewardService.bustBoardCache();
}

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
        Number(url.searchParams.get('page')) || DAILY_DEFAULT_PAGE,
        Number(url.searchParams.get('pageSize')) || DAILY_PLAYER_LEADERBOARD_PAGE_SIZE,
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
      await dailyRewardService.history(
        Number(url.searchParams.get('limit')) || DAILY_HISTORY_LIMIT,
      ),
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
  if (req.method === 'POST' && url.pathname === '/internal/daily-rewards/finalize') {
    const result = await dailyRewardService.finalizeRewardDay(await readBody(req));
    if ('error' in result) {
      json(res, result.status, { success: false, data: null, error: result.error });
    } else {
      json(res, 200, { success: true, data: result, error: null });
    }
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/internal/daily-rewards/pending-payouts') {
    const requestedDay = url.searchParams.get('day');
    if (requestedDay !== null && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDay)) {
      json(res, 400, { success: false, data: null, error: 'invalid reward day' });
      return true;
    }
    const data = await dailyRewardService.pendingPayouts(
      Number(url.searchParams.get('limit')) || DAILY_OPS_PENDING_PAYOUTS_LIMIT,
      requestedDay ?? undefined,
    );
    json(res, 200, { success: true, data, error: null });
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/internal/daily-rewards/payout-history') {
    const data = await dailyRewardService.payoutHistory(
      Number(url.searchParams.get('limit')) || DAILY_OPS_PAYOUT_HISTORY_LIMIT,
    );
    json(res, 200, { success: true, data, error: null });
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/internal/daily-rewards/leaderboard') {
    const requestedDay = url.searchParams.get('day') || '';
    const { day } = requestedDay ? { day: requestedDay } : await dailyRewardClock();
    const data = await dailyRewardService.leaderboardPage(
      day,
      Number(url.searchParams.get('page')) || DAILY_DEFAULT_PAGE,
      Number(url.searchParams.get('pageSize')) || DAILY_OPS_LEADERBOARD_PAGE_SIZE,
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
  if (req.method === 'POST' && url.pathname === '/internal/daily-rewards/void-payout') {
    const result = await dailyRewardService.voidPayout(await readBody(req));
    if ('error' in result) {
      json(res, result.status, { success: false, data: null, error: result.error });
    } else {
      json(res, 200, { success: true, data: result, error: null });
    }
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/internal/daily-rewards/restore-payout') {
    const result = await dailyRewardService.restorePayout(await readBody(req));
    if ('error' in result) {
      json(res, result.status, { success: false, data: null, error: result.error });
    } else {
      json(res, 200, { success: true, data: result, error: null });
    }
    return true;
  }
  json(res, 404, { success: false, data: null, error: 'unknown endpoint' });
  return true;
}

// ── Route layer ────────────────────────────
// Both daily-rewards families as RouteDefs for the shared dispatcher:
//   GET  /api/daily-rewards                        player status (JSON)
//   GET  /api/daily-rewards/leaderboard            paginated daily leaderboard (JSON)
//   POST /api/daily-rewards/spin                   player spin (JSON)
//   GET  /api/daily-rewards/history                payout history (JSON)
//   POST /internal/daily-rewards/finalize          close one explicit reward day
//   POST /internal/daily-rewards/pending-payouts   payout service ops
//   POST /internal/daily-rewards/payout-history    payout service ops
//   POST /internal/daily-rewards/leaderboard       payout service ops
//   POST /internal/daily-rewards/mark-payout       payout service ops
//   POST /internal/daily-rewards/void-payout       payout moderation ops
//   POST /internal/daily-rewards/restore-payout    payout moderation ops
// The legacy dispatch stays as the flag-off rollback path until the ladder-deletion PR: the
// main.ts prefix arm (startsWith('/api/daily-rewards'), bearerActiveAccount
// BEFORE delegating) for the player family, and the /internal composite
// delegate (handleDailyRewardInternalApi tried FIRST, ordering load-bearing)
// for the ops family.
//
// PARITY-FIRST BY CONSTRUCTION: each thin handler calls the SAME sub-dispatcher
// the ladder serves (handleDailyRewardApi / handleDailyRewardInternalApi)
// UNCHANGED, so every body, the in-family 404 'unknown endpoint', the lenient
// Number(...)|| limit decodes, and mark-payout's validation prose are
// byte-identical with zero dual-edit drift. No withBody anywhere: spin reads no
// body (a body reader would invent 400/413 behavior legacy does not have) and
// mark-payout SELF-READS via the core's un-caught readBody (the
// dailyRewardsOpsBodyValidationRemap deviation). Off-table shapes (wrong
// method, unknown subpath, the no-slash '/api/daily-rewardsX' sibling, HEAD)
// resolve unmatched and delegate to the ladder unchanged. v0.20.0 grew each
// family by its paginated leaderboard read (four player + seven ops routes).
//
// The player guard is the shared legacy-body createActiveGuard (mirrors the
// prefix arm's bearerActiveAccount byte-for-byte). The ops gate is the
// FAIL-CLOSED requireInternalSecretFailClosed variant: env-unset AND mismatch
// both answer the legacy 401 { success: false, data: null, error: 'not
// authenticated' } (never the other internal gates' feature-off 404, never a
// RESTART_COUNTDOWN_SECRET fallback). The gated core re-runs its own
// internalAuthorized check (same env + header, per request), which passes
// whenever the gate passed; keeping the core's check intact is what keeps the
// composite delegate's legacy behavior frozen. NO rate limiter on any of the
// eleven (legacy has none; spin's only guards are the one-spin-per-day 409 and
// the wallet-eligibility 403, and adding a throttle is a maintainer fork, not
// a silent add).
// dailyRewardService stays module-owned and importable by game.ts regardless of
// route-table state; no boot injection is needed.

// The bearer + moderation reads the player guard needs. Built LAZILY (a
// function, not a module-scope object literal): game.ts imports this module, so
// an eager literal would break every test that partial-mocks server/db and
// loads the game (the lazy-db-bundle rule).
function makeRealDailyRewardDb() {
  return { accountAndScopeForToken, moderationStatusForAccount };
}
type DailyRewardGuardDb = ReturnType<typeof makeRealDailyRewardDb>;
let realDailyRewardDb: DailyRewardGuardDb | undefined;
let dailyRewardDbOverride: DailyRewardGuardDb | undefined;
function dailyRewardGuardDb(): BearerActiveGuardDb {
  if (dailyRewardDbOverride) return dailyRewardDbOverride;
  realDailyRewardDb ??= makeRealDailyRewardDb();
  return realDailyRewardDb;
}

/** Override the guard db with a fake (test-only; merges over the real reads). */
export function setDailyRewardDbForTests(overrides: Partial<DailyRewardGuardDb>): void {
  realDailyRewardDb ??= makeRealDailyRewardDb();
  dailyRewardDbOverride = { ...realDailyRewardDb, ...overrides };
}

/** Restore the real guard db after a setDailyRewardDbForTests override (test-only). */
export function resetDailyRewardDbForTests(): void {
  dailyRewardDbOverride = undefined;
}

/** Full active session gate (mirrors the prefix arm's bearerActiveAccount). */
const activeGuard = createActiveGuard(() => dailyRewardGuardDb());

/** The fail-closed payout-service gate, one instance shared by the seven ops routes. */
const dailyRewardOpsGate = requireInternalSecretFailClosed({
  header: DAILY_REWARD_SECRET_HEADER,
  envVar: DAILY_REWARD_SECRET_ENV,
});

/** A player route: the guard resolved the account; the shared core dispatches. */
async function dailyRewardPlayerHandler(ctx: Ctx): Promise<void> {
  return handleDailyRewardApi(ctx.req, ctx.res, ctxAccountId(ctx));
}

/**
 * An ops route: the gate passed; the shared core re-checks the same secret and
 * dispatches. It always handles a request whose path the router matched (the
 * boolean is its prefix check, true for every registered ops path).
 */
async function dailyRewardOpsHandler(ctx: Ctx): Promise<void> {
  await handleDailyRewardInternalApi(ctx.req, ctx.res);
}

// The route table. registry.ts spreads this into apiRoutes; the ops rows carry
// surface 'internal' + meta.envelope 'admin' (the internal fail() envelope IS
// the admin { success, data, error } shape; EnvelopeKind is a frozen
// server/http/types.ts contract with no separate internal member).
export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/daily-rewards',
    surface: 'api',
    middleware: [activeGuard],
    handler: dailyRewardPlayerHandler,
  },
  {
    method: 'GET',
    path: '/api/daily-rewards/leaderboard',
    surface: 'api',
    middleware: [activeGuard],
    handler: dailyRewardPlayerHandler,
  },
  {
    method: 'POST',
    path: '/api/daily-rewards/spin',
    surface: 'api',
    middleware: [activeGuard],
    handler: dailyRewardPlayerHandler,
  },
  {
    method: 'GET',
    path: '/api/daily-rewards/history',
    surface: 'api',
    middleware: [activeGuard],
    handler: dailyRewardPlayerHandler,
  },
  {
    method: 'POST',
    path: '/internal/daily-rewards/finalize',
    surface: 'internal',
    meta: { envelope: 'admin' },
    middleware: [dailyRewardOpsGate],
    handler: dailyRewardOpsHandler,
  },
  {
    method: 'POST',
    path: '/internal/daily-rewards/pending-payouts',
    surface: 'internal',
    meta: { envelope: 'admin' },
    middleware: [dailyRewardOpsGate],
    handler: dailyRewardOpsHandler,
  },
  {
    method: 'POST',
    path: '/internal/daily-rewards/payout-history',
    surface: 'internal',
    meta: { envelope: 'admin' },
    middleware: [dailyRewardOpsGate],
    handler: dailyRewardOpsHandler,
  },
  {
    method: 'POST',
    path: '/internal/daily-rewards/leaderboard',
    surface: 'internal',
    meta: { envelope: 'admin' },
    middleware: [dailyRewardOpsGate],
    handler: dailyRewardOpsHandler,
  },
  {
    method: 'POST',
    path: '/internal/daily-rewards/mark-payout',
    surface: 'internal',
    meta: { envelope: 'admin' },
    middleware: [dailyRewardOpsGate],
    handler: dailyRewardOpsHandler,
  },
  {
    method: 'POST',
    path: '/internal/daily-rewards/void-payout',
    surface: 'internal',
    meta: { envelope: 'admin' },
    middleware: [dailyRewardOpsGate],
    handler: dailyRewardOpsHandler,
  },
  {
    method: 'POST',
    path: '/internal/daily-rewards/restore-payout',
    surface: 'internal',
    meta: { envelope: 'admin' },
    middleware: [dailyRewardOpsGate],
    handler: dailyRewardOpsHandler,
  },
];
