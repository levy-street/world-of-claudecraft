// The Ashen Coliseum daily claim: once per host calendar day, a player who has
// ENTERED an arena bout that day can claim honor plus hero points scaled by their
// arena rating. One claim per day; the reset boundary is the host `utcDay` string
// (the same one the honor arena taper, the Book of Deeds, and the Frontier daily use;
// offline/headless never roll a day, so the claim is one-and-done there,
// deterministically). Pure reward math + a small state machine; a Vitest imports it
// directly. Draws NO rng.
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { grantHeroPoints } from './hero_points';
import { grantHonor } from './honor';

// Reward tuning. Flat base plus a linear rating bonus, so a fresh gladiator still gets
// a worthwhile claim and a ranked one is paid for the ladder they hold. At the 1500
// starting-ish rating this pays 125 honor + 5 hero; it scales gently from there.
export const ARENA_DAILY_HONOR_BASE = 50;
export const ARENA_DAILY_HONOR_PER_RATING = 20;
export const ARENA_DAILY_HERO_BASE = 2;
export const ARENA_DAILY_HERO_PER_RATING = 400;

export interface ArenaDailyState {
  enteredDay: string; // utcDay of the last arena bout entered
  claimedDay: string; // utcDay of the last claim
}

export type ArenaDailyClaimStatus =
  | 'unavailable' // has not entered an arena bout today
  | 'ready' // entered today, not yet claimed
  | 'claimed'; // already claimed today

export function normalizeArenaDaily(value: unknown): ArenaDailyState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as { enteredDay?: unknown; claimedDay?: unknown };
  const enteredDay = typeof v.enteredDay === 'string' ? v.enteredDay : '';
  const claimedDay = typeof v.claimedDay === 'string' ? v.claimedDay : '';
  if (enteredDay === '' && claimedDay === '') return undefined;
  return { enteredDay, claimedDay };
}

/** Record that the player entered an arena bout on `utcDay` (preserves claimedDay). */
export function markArenaEntered(meta: PlayerMeta, utcDay: string): void {
  meta.arenaDaily = { enteredDay: utcDay, claimedDay: meta.arenaDaily?.claimedDay ?? '' };
}

export function arenaDailyClaimStatus(meta: PlayerMeta, utcDay: string): ArenaDailyClaimStatus {
  const d = meta.arenaDaily;
  if (!d || d.enteredDay !== utcDay) return 'unavailable';
  return d.claimedDay === utcDay ? 'claimed' : 'ready';
}

/** Honor + hero reward for a claim at this arena rating (the player's best bracket). */
export function arenaDailyReward(rating: number): { honor: number; hero: number } {
  const r = Math.max(0, Math.floor(rating));
  return {
    honor: ARENA_DAILY_HONOR_BASE + Math.floor(r / ARENA_DAILY_HONOR_PER_RATING),
    hero: ARENA_DAILY_HERO_BASE + Math.floor(r / ARENA_DAILY_HERO_PER_RATING),
  };
}

// The player's best rating across the ranked brackets (drives the reward). Legacy
// arenaRating is the 1v1 ladder; arena2v2Rating is the team ladder.
function bestArenaRating(meta: PlayerMeta): number {
  return Math.max(meta.arenaRating ?? 0, meta.arena2v2Rating ?? 0);
}

/** The claim readout for the UI: eligibility plus the honor + hero it would pay. */
export function arenaDailyInfo(
  meta: PlayerMeta,
  utcDay: string,
): { status: ArenaDailyClaimStatus; honor: number; hero: number } {
  const { honor, hero } = arenaDailyReward(bestArenaRating(meta));
  return { status: arenaDailyClaimStatus(meta, utcDay), honor, hero };
}

// The command body: claim if ready, granting honor + hero and stamping today's claim.
// A no-op (with a matcher-backed error) when not eligible.
export function claimArenaDaily(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta } = r;
  const status = arenaDailyClaimStatus(meta, ctx.utcDay);
  if (status === 'unavailable') {
    ctx.error(meta.entityId, 'Enter an arena match today to claim your daily reward.');
    return;
  }
  if (status === 'claimed') {
    ctx.error(meta.entityId, 'You have already claimed your daily arena reward today.');
    return;
  }
  const { honor, hero } = arenaDailyReward(bestArenaRating(meta));
  grantHonor(ctx, meta, honor, 'arena_daily');
  grantHeroPoints(ctx, meta, hero, 'arena_daily');
  meta.arenaDaily = {
    enteredDay: meta.arenaDaily?.enteredDay ?? ctx.utcDay,
    claimedDay: ctx.utcDay,
  };
}
