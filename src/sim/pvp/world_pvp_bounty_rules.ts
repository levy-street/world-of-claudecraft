// World PvP bounties: the pure rules. A FLAGGED player who is paid for
// WORLD_PVP_BOUNTY_STREAK world kills in a row without dying earns a bounty on
// their own head. Every player can carry one at the same time: a bounty is not
// a single realm-wide prize but a mark each hot streak earns for itself. While
// it stands, the holder's own kills pay more Honor on a gentler per-victim
// curve (worldPvpBountyHolderMultiplier), and anyone who kills the holder
// shares a doubled honor pool (worldPvpKillHonorPool). Any death ends the
// bounty and the streak, and so does the flag dropping. No SimContext, no rng,
// no clock: every function here is a plain function of its arguments so the
// death hook (world_pvp.ts), the bounty system (world_pvp_bounty.ts) and the
// tests read the same numbers. Numbers: docs/design/warfare.md, "World PvP
// bounties".

import { WORLD_PVP_KILL_HONOR } from './world_pvp_rules';

/** Paid world kills in a row, without dying and with the flag up, that earn a
 *  bounty (owner spec). */
export const WORLD_PVP_BOUNTY_STREAK = 5;

/** The honor pool a kill of a bounty holder pays, as a multiple of the
 *  ordinary WORLD_PVP_KILL_HONOR pool (owner spec: "double the honor drop
 *  rewards"). Split among the contributors exactly like the ordinary pool. */
export const WORLD_PVP_BOUNTY_KILL_HONOR_MULT = 2;

/** The holder's per-victim diminishing-returns curve, the bounty twin of
 *  HONOR_REPEAT_DR (100, 50, 25, then 0 percent). Owner spec: a solo holder is
 *  paid 15, then 10 instead of 5, then 5 instead of 2 for the first three kills
 *  of one victim, out of the 10-honor pool. The fourth kill inside the
 *  per-pair window still pays nothing, so a bounty never makes camping pay. */
export const WORLD_PVP_BOUNTY_HOLDER_DR = [1.5, 1, 0.5, 0] as const;

/** The honor pool one world kill splits among its contributors: doubled when
 *  the victim carried a bounty at the moment of death. */
export function worldPvpKillHonorPool(victimHadBounty: boolean): number {
  return victimHadBounty
    ? WORLD_PVP_KILL_HONOR * WORLD_PVP_BOUNTY_KILL_HONOR_MULT
    : WORLD_PVP_KILL_HONOR;
}

/** The per-pair multiplier for a bounty HOLDER who has already been paid
 *  `previousKills` kills of this victim inside the current DR window. Past the
 *  end of the curve it stays at its last step (zero). A negative or fractional
 *  count reads as its floor, never below zero. */
export function worldPvpBountyHolderMultiplier(previousKills: number): number {
  const index = Math.max(0, Math.floor(previousKills));
  return WORLD_PVP_BOUNTY_HOLDER_DR[Math.min(index, WORLD_PVP_BOUNTY_HOLDER_DR.length - 1)];
}

/** Does a streak of this many paid kills earn the bounty? */
export function worldPvpStreakEarnsBounty(streak: number): boolean {
  return streak >= WORLD_PVP_BOUNTY_STREAK;
}
