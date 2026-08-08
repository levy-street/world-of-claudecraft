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
// decay per repeated opposing-team via BATTLEGROUND_RESULT_DR, the battleground's
// OWN curve; forfeits pay nothing (social/battleground.ts).
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
// The first Thornhollow Fields WIN of each UTC day pays a bonus on top of the
// ordinary win award: the classic-era daily-battleground quest convention, where
// the day's first win is the thing that gets a player to queue at all.
//
// A FLAT authored 20, not a multiple of the win award. The earlier shape derived
// it (win x 2 = 120, so the day's first win paid 180, three times a routine one),
// which measured as paying "log in, win once, log off" far better than it paid
// playing a session: the opposite of what a battleground queue needs. On a day
// spent against one stable premade the bonus was 53% of all result honor, so it
// was quietly doing two jobs and only one was intentional (the other, propping up
// a thin realm's income, is BATTLEGROUND_RESULT_DR's floor below).
//
// Flat because the number is a judgment about what a daily hook is worth, not a
// function of what a win is worth: reaching 20 through the old shape would need a
// "bonus multiplier" of about 0.33, which reads as nonsense for something with
// that name. The day's first win now pays 80 against a 60 repeat, a 1.33x ratio,
// in line with the delve daily (`meta.delveDaily.firstClearXp`,
// src/sim/delves/runs.ts grantDelveClearTo), the one in-repo precedent, which
// SWAPS one authored reward for another for a first/repeat ratio near 1.6x.
export const BATTLEGROUND_FIRST_WIN_BONUS_HONOR = 20;

// Arena is especially easy to coordinate in 1v1, so only the first win against
// the same opponent/team pays each UTC day. Fiesta uses softer decay because its
// takedown and completion rewards come from a longer, multi-kill match.
export const ARENA_REPEAT_DR = [1, 0] as const;
export const HONOR_REPEAT_DR = [1, 0.5, 0.25, 0] as const;
// Thornhollow Fields RESULT honor only: its own curve, floored at 0.25 instead of
// reaching 0. Deliberately NOT an edit to HONOR_REPEAT_DR above, which
// repeatHonorMultiplier shares with battleground kills, battleground assists,
// Fiesta kills, and Fiesta completions: retuning the shared array to fix a
// battleground problem would silently retune Fiesta too.
//
// The zero floor is correct where it came from. In arena, meeting the same team
// over and over is evidence of win-trading, so paying nothing is the point. In a
// 5v5 battleground on a low-population realm it is simply what the queue
// produces, and the code cannot tell the two apart: against one stable premade
// the whole day's result ceiling was 60 + 30 + 15 = 105, making grind length swing
// 1.7x on queue variety rather than on effort or skill.
//
// A 0.25 floor pays 15 per repeated win against the same team, indefinitely.
// Farming one premade stays heavily penalised (15 against 60); honest repeat play
// stops paying literally nothing. Kills and assists keep the shared curve: their
// counters live on the match and reset every match, so they never had this
// problem. Revisit against live match data, like the 60/20 tuning above; the
// thing to watch is the distribution of distinct opposing team identities faced
// per player per day, bucketed by realm population.
export const BATTLEGROUND_RESULT_DR = [1, 0.5, 0.25, 0.25] as const;
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
    // Same absent-until-set rule: only a claimed day carries the flag, so a save
    // written before the bonus existed (or on a day that has not paid it) is
    // byte-equal to what it was. Any truthy stored value normalizes to `true`.
    ...(record.bgFirstWinClaimed ? { bgFirstWinClaimed: true } : {}),
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

/** The battleground RESULT curve, floored at 0.25. Only `awardBattlegroundHonor`
 *  uses this; every other honor site stays on `repeatHonorMultiplier` above. */
export function battlegroundResultMultiplier(previousAwards: number): number {
  return BATTLEGROUND_RESULT_DR[Math.min(previousAwards, BATTLEGROUND_RESULT_DR.length - 1)];
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
      date: ctx.resetDay,
      winsByOpponent: {},
      fiestaCompletionsByOpponent: {},
      totalWins: 0,
    };
    meta.honorArenaDaily = daily;
  }
  if (ctx.resetDay && daily.date !== ctx.resetDay) {
    daily.date = ctx.resetDay;
    daily.winsByOpponent = {};
    daily.fiestaCompletionsByOpponent = {};
    // Back to `undefined` (not `{}`) so an untouched day stays byte-equal in
    // the save blob (the absent-until-first-result rule).
    daily.bgResultsByOpponent = undefined;
    // The new day re-arms the first-win bonus. `undefined` rather than `false`
    // for the same byte-equality reason.
    daily.bgFirstWinClaimed = undefined;
    daily.totalWins = 0;
  }
  return daily;
}

/**
 * Is the first-win-of-the-day Honor bonus still unclaimed for this character?
 *
 * The READ-ONLY twin of the rollover in `dailyWindow` above, for the readouts
 * (`bgInfoFor`) that must never mutate the window they report on: a stored date
 * that is not today reads as re-armed without writing the rollover, which the
 * next actual award does. `resetDay === ''` means the host set no calendar, so
 * the window never rolls over and the stored flag is the whole answer.
 */
export function bgFirstWinBonusAvailable(resetDay: string, meta: PlayerMeta): boolean {
  const daily = meta.honorArenaDaily;
  if (!daily) return true;
  if (resetDay && daily.date !== resetDay) return true;
  return daily.bgFirstWinClaimed !== true;
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

/** What one played-out Thornhollow Fields result paid: the ordinary result award
 *  plus the first-win-of-the-day bonus, kept apart because the caller has to put
 *  the BONUS on the `bgEnd` event for the finish surface to name it. */
export interface BattlegroundHonorAward {
  /** Everything credited by this result, bonus included. */
  total: number;
  /** The first-win-of-the-day bonus part, or 0 when it did not pay. */
  firstWinBonus: number;
}

// Thornhollow Fields result honor: one award per played-out match, decayed per repeated
// opposing-team identity in the same UTC day (BATTLEGROUND_RESULT_DR, the
// battleground's own floored curve; a 5v5 match is long enough that the arena's
// first-win-only rule would be needlessly punishing, and long enough that a
// repeated opponent is queue shape rather than collusion). Draws pay the loss
// amount to both sides.
// Forfeits never reach this function (the caller pays nothing on forfeit), and
// neither do unrated /dev matches, so neither can claim the daily bonus.
export function awardBattlegroundHonor(
  ctx: SimContext,
  meta: PlayerMeta,
  opponentTeamKey: string,
  outcome: 'win' | 'loss' | 'draw',
): BattlegroundHonorAward {
  const daily = dailyWindow(ctx, meta);
  const key = `bg:${opponentTeamKey}`;
  if (!daily.bgResultsByOpponent) daily.bgResultsByOpponent = {};
  const results = daily.bgResultsByOpponent;
  const repeats = results[key] ?? 0;
  results[key] = repeats + 1;
  const base = outcome === 'win' ? BATTLEGROUND_WIN_HONOR : BATTLEGROUND_LOSS_HONOR;
  const reason: HonorReason = outcome === 'win' ? 'battleground_win' : 'battleground_complete';
  let total = grantHonor(
    ctx,
    meta,
    Math.floor(base * battlegroundResultMultiplier(repeats)),
    reason,
  );
  let firstWinBonus = 0;
  // The day's first WIN only: a loss or a draw never arms or claims it.
  if (outcome === 'win' && daily.bgFirstWinClaimed !== true) {
    // Deliberately NOT decayed by battlegroundResultMultiplier, unlike the base
    // award above. That curve exists to stop farming one opposing team over and over;
    // this bonus is already gated to once per UTC day, which is the stronger
    // form of the same protection, and double-decaying it would let a player
    // lose the day's headline reward to a rematch they did not choose.
    firstWinBonus = grantHonor(
      ctx,
      meta,
      BATTLEGROUND_FIRST_WIN_BONUS_HONOR,
      'battleground_first_win',
    );
    // The claim is spent only if the grant actually PAID. grantHonor credits
    // nothing once a purse is at the honor ceiling, and burning the day's one
    // bonus for zero honor is the wrong way to lose that race.
    if (firstWinBonus > 0) daily.bgFirstWinClaimed = true;
    total += firstWinBonus;
  }
  return { total, firstWinBonus };
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
