// Honor currency and deterministic initial reward rules. Every grant routes
// through grantHonor so spendable and lifetime earnings update together.

import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { ArenaFormat, HonorArenaDailyState, HonorReason } from '../types';

export const RANKED_ARENA_WIN_HONOR = {
  '1v1': 25,
  '2v2': 50,
} as const;

export const FIESTA_KILL_HONOR = 20;
export const FIESTA_COMPLETION_HONOR = 20;
export const FIESTA_WIN_BONUS_HONOR = 40;
// Thornhollow Fields 5v5 capture-the-flag. A win pays more than a 2v2 win because a
// full match is a 10-player, ~10-13 minute commitment; the loss award is a
// completion consolation (a draw pays the loss amount to both sides). Both
// decay per repeated opposing-team via HONOR_REPEAT_DR (the Fiesta rule for
// longer multi-player modes); forfeits pay nothing (social/battleground.ts).
// 60/20 are DELIBERATE owner tuning, not a documented classic-era curve (the
// one deliberate exception to the real-formulas rule, flagged in review):
// sized against the arena payouts so a played-out battleground beats queue
// value without dwarfing it. Revisit against live match data.
export const BATTLEGROUND_WIN_HONOR = 60;
export const BATTLEGROUND_LOSS_HONOR = 20;
// Per-kill honor, the classic battleground drip: a small, immediate "+N honor"
// on every killing blow, so fighting away from the flag is still worth doing.
// Deliberately small next to the result award (a 15-kill match pays about a
// win) and decayed per REPEATED VICTIM on the same curve as everything else,
// so farming one player in a graveyard pays out four times and then nothing.
// An assist pays less than the blow, on its own separate victim counter.
export const BATTLEGROUND_KILL_HONOR = 5;
export const BATTLEGROUND_ASSIST_HONOR = 2;

// Arena is especially easy to coordinate in 1v1, so only the first win against
// the same opponent/team pays each UTC day. Fiesta uses softer decay because its
// takedown and completion rewards come from a longer, multi-kill match.
export const ARENA_REPEAT_DR = [1, 0] as const;
export const HONOR_REPEAT_DR = [1, 0.5, 0.25, 0] as const;
export const ARENA_DAILY_TAPER_START = 10;
export const ARENA_DAILY_TAPER_FLOOR_START = 15;

function safeHonorAmount(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.floor(amount));
}

export function normalizeHonorCounter(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value)));
}

function normalizeCountRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    const normalized = normalizeHonorCounter(count);
    if (normalized > 0) out[key] = normalized;
  }
  return out;
}

export function normalizeHonorDailyState(value: unknown): HonorArenaDailyState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const bgResults = normalizeCountRecord(record.bgResultsByOpponent);
  return {
    date: typeof record.date === 'string' ? record.date : '',
    winsByOpponent: normalizeCountRecord(record.winsByOpponent),
    fiestaCompletionsByOpponent: normalizeCountRecord(record.fiestaCompletionsByOpponent),
    // Optional: absent (not empty) when there are no results, so pre-Thornhollow Fields
    // saves round-trip byte-identical.
    ...(Object.keys(bgResults).length > 0 ? { bgResultsByOpponent: bgResults } : {}),
    totalWins: normalizeHonorCounter(record.totalWins),
  };
}

export function grantHonor(
  ctx: SimContext,
  meta: PlayerMeta,
  amount: number,
  reason: HonorReason,
): number {
  const requested = safeHonorAmount(amount);
  if (requested === 0) return 0;
  const honorBefore = meta.honor;
  const lifetimeBefore = meta.lifetimeHonor;
  meta.honor = Math.min(Number.MAX_SAFE_INTEGER, honorBefore + requested);
  meta.lifetimeHonor = Math.min(Number.MAX_SAFE_INTEGER, lifetimeBefore + requested);
  const credited = meta.honor - honorBefore;
  const earned = meta.lifetimeHonor - lifetimeBefore;
  const eventAmount = Math.max(credited, earned);
  if (eventAmount === 0) return 0;
  ctx.emit({ type: 'honor', pid: meta.entityId, amount: eventAmount, reason });
  return credited;
}

export function repeatHonorMultiplier(previousAwards: number): number {
  return HONOR_REPEAT_DR[Math.min(previousAwards, HONOR_REPEAT_DR.length - 1)];
}

export function arenaRepeatHonorMultiplier(previousAwards: number): number {
  return ARENA_REPEAT_DR[Math.min(previousAwards, ARENA_REPEAT_DR.length - 1)];
}

function arenaDailyMultiplier(totalWins: number): number {
  if (totalWins < ARENA_DAILY_TAPER_START) return 1;
  if (totalWins < ARENA_DAILY_TAPER_FLOOR_START) return 0.5;
  return 0.25;
}

function dailyWindow(ctx: SimContext, meta: PlayerMeta) {
  let daily = meta.honorArenaDaily;
  if (!daily) {
    daily = {
      date: ctx.utcDay,
      winsByOpponent: {},
      fiestaCompletionsByOpponent: {},
      totalWins: 0,
    };
    meta.honorArenaDaily = daily;
  }
  if (ctx.utcDay && daily.date !== ctx.utcDay) {
    daily.date = ctx.utcDay;
    daily.winsByOpponent = {};
    daily.fiestaCompletionsByOpponent = {};
    // Back to `undefined` (not `{}`) so an untouched day stays byte-equal in
    // the save blob (the absent-until-first-result rule).
    daily.bgResultsByOpponent = undefined;
    daily.totalWins = 0;
  }
  return daily;
}

// Snapshotted at match start. Database character ids are rename-proof online;
// offline players use their stable character name rather than transient pids.
export function honorTeamIdentity(ctx: SimContext, pids: number[]): string {
  const members = pids.map((pid) => {
    const meta = ctx.players.get(pid);
    if (meta?.characterId !== undefined) return `character:${meta.characterId}`;
    if (meta) return `name:${meta.name.trim().toLowerCase()}`;
    return `missing:${pid}`;
  });
  members.sort();
  return JSON.stringify(members);
}

export function awardRankedArenaWinHonor(
  ctx: SimContext,
  meta: PlayerMeta,
  format: ArenaFormat,
  opponentTeamKey: string,
): number {
  if (format !== '1v1' && format !== '2v2') return 0;
  const daily = dailyWindow(ctx, meta);
  const key = `${format}:${opponentTeamKey}`;
  const repeats = daily.winsByOpponent[key] ?? 0;
  const amount = Math.floor(
    RANKED_ARENA_WIN_HONOR[format] *
      arenaRepeatHonorMultiplier(repeats) *
      arenaDailyMultiplier(daily.totalWins),
  );
  daily.winsByOpponent[key] = repeats + 1;
  daily.totalWins++;
  return grantHonor(ctx, meta, amount, 'arena_win');
}

// Thornhollow Fields result honor: one award per played-out match, decayed per repeated
// opposing-team identity in the same UTC day (HONOR_REPEAT_DR, the softer
// Fiesta curve; a 5v5 match is long enough that the arena's first-win-only rule
// would be needlessly punishing). Draws pay the loss amount to both sides.
// Forfeits never reach this function (the caller pays nothing on forfeit).
export function awardBattlegroundHonor(
  ctx: SimContext,
  meta: PlayerMeta,
  opponentTeamKey: string,
  outcome: 'win' | 'loss' | 'draw',
): number {
  const daily = dailyWindow(ctx, meta);
  const key = `bg:${opponentTeamKey}`;
  if (!daily.bgResultsByOpponent) daily.bgResultsByOpponent = {};
  const results = daily.bgResultsByOpponent;
  const repeats = results[key] ?? 0;
  results[key] = repeats + 1;
  const base = outcome === 'win' ? BATTLEGROUND_WIN_HONOR : BATTLEGROUND_LOSS_HONOR;
  const reason: HonorReason = outcome === 'win' ? 'battleground_win' : 'battleground_complete';
  return grantHonor(ctx, meta, Math.floor(base * repeatHonorMultiplier(repeats)), reason);
}

/**
 * A killing blow in the battleground. Decayed per repeated victim within the
 * match (the counter lives on the match, not the daily window: a per-match
 * counter is what stops graveyard farming without punishing a long session).
 */
export function awardBattlegroundKillHonor(
  ctx: SimContext,
  meta: PlayerMeta,
  victimPid: number,
  killsByPair: Map<string, number>,
): number {
  const key = `${meta.entityId}:${victimPid}`;
  const repeats = killsByPair.get(key) ?? 0;
  killsByPair.set(key, repeats + 1);
  return grantHonor(
    ctx,
    meta,
    BATTLEGROUND_KILL_HONOR * repeatHonorMultiplier(repeats),
    'battleground_kill',
  );
}

/** An assist on someone else's killing blow: the same shape, its own counter. */
export function awardBattlegroundAssistHonor(
  ctx: SimContext,
  meta: PlayerMeta,
  victimPid: number,
  assistsByPair: Map<string, number>,
): number {
  const key = `${meta.entityId}:${victimPid}`;
  const repeats = assistsByPair.get(key) ?? 0;
  assistsByPair.set(key, repeats + 1);
  return grantHonor(
    ctx,
    meta,
    BATTLEGROUND_ASSIST_HONOR * repeatHonorMultiplier(repeats),
    'battleground_assist',
  );
}

export function awardFiestaKillHonor(
  ctx: SimContext,
  meta: PlayerMeta,
  victimPid: number,
  killsByPair: Map<string, number>,
): number {
  const key = `${meta.entityId}:${victimPid}`;
  const repeats = killsByPair.get(key) ?? 0;
  killsByPair.set(key, repeats + 1);
  return grantHonor(ctx, meta, FIESTA_KILL_HONOR * repeatHonorMultiplier(repeats), 'fiesta_kill');
}

export function awardFiestaCompletionHonor(
  ctx: SimContext,
  meta: PlayerMeta,
  opponentTeamKey: string,
  won: boolean,
): number {
  const daily = dailyWindow(ctx, meta);
  const key = `fiesta:${opponentTeamKey}`;
  const repeats = daily.fiestaCompletionsByOpponent[key] ?? 0;
  daily.fiestaCompletionsByOpponent[key] = repeats + 1;
  const mult = repeatHonorMultiplier(repeats);
  let total = grantHonor(ctx, meta, FIESTA_COMPLETION_HONOR * mult, 'fiesta_complete');
  if (won) total += grantHonor(ctx, meta, FIESTA_WIN_BONUS_HONOR * mult, 'fiesta_win');
  return total;
}
