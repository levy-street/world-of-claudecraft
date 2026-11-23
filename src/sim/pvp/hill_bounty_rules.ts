// King of the Hill bounties: the pure rule tables (owner spec, 2026-10-02:
// "like League of Legends: kill streaks raise your bounty, deaths lower it,
// repeat kills on the hill pay in full, with the callouts"). No state, no
// SimContext: src/sim/pvp/hill_bounty.ts owns the books and the wiring.
//
// The tables are League's pre-2024 champion bounty, scaled from its 300 gold
// base to the 10 Honor of a world kill (WORLD_PVP_KILL_HONOR): a streak of 2
// to 6 pays 450, 600, 700, 800, 900 gold there, so 15, 20, 23, 27, 30 Honor
// here, and 7 or more pays 1,000 there, 33 here (capped, no further steps).
// League documents only the floor of its death-streak reduction (a third of
// the base), so the steps between are this game's own, owner-approved
// 2026-10-02: 9, 7, 6, 5, then 3 from six deaths on.

/** The Honor a victim on a kill streak of `kills` (index; 7 and up use the
 *  last) is worth: 0 and 1 kills are the plain world kill. */
export const HILL_BOUNTY_KILL_STREAK_HONOR: readonly number[] = [10, 10, 15, 20, 23, 27, 30, 33];

/** The Honor a victim on a death streak of `deaths` (index; 6 and up use the
 *  last) is worth: 0 and 1 deaths are the plain world kill. */
export const HILL_BOUNTY_DEATH_STREAK_HONOR: readonly number[] = [10, 10, 9, 7, 6, 5, 3];

/** The plain world kill, the bounty of a player with no streak either way. */
export const HILL_BOUNTY_BASE_HONOR = HILL_BOUNTY_KILL_STREAK_HONOR[0];

/** Full Honor for the first this-many kills of one victim by one contributor
 *  on one hill; nothing after (the hill's replacement for the world's hourly
 *  100/50/25/0 decay, so the fight over the circle is never worthless). */
export const HILL_BOUNTY_REPEAT_CAP = 5;

/** A victim on at least this kill streak is "shut down" when killed. */
export const HILL_SHUTDOWN_STREAK = 3;

/** How long, in sim seconds, the latest callout stays on the readout: a
 *  player who walks into the zone afterwards never sees a stale banner. */
export const HILL_CALLOUT_SECONDS = 6;

export type HillStreakCalloutKind =
  | 'killingSpree'
  | 'rampage'
  | 'unstoppable'
  | 'dominating'
  | 'godlike'
  | 'legendary';

export type HillCalloutKind = HillStreakCalloutKind | 'shutDown';

function tableAt(table: readonly number[], index: number): number {
  return table[Math.max(0, Math.min(table.length - 1, Math.floor(index)))];
}

/** What killing this player pays, before the split between contributors.
 *  A kill streak and a death streak never coexist (a kill ends the death
 *  streak and a death ends the kill streak), so whichever is running decides. */
export function hillBountyHonor(killStreak: number, deathStreak: number): number {
  if (killStreak >= 2) return tableAt(HILL_BOUNTY_KILL_STREAK_HONOR, killStreak);
  return tableAt(HILL_BOUNTY_DEATH_STREAK_HONOR, deathStreak);
}

/** One contributor's Honor multiplier on a hill kill, given the kills of this
 *  victim they were already paid on this hill. */
export function hillRepeatHonorMultiplier(previousKills: number): number {
  return previousKills < HILL_BOUNTY_REPEAT_CAP ? 1 : 0;
}

/** The announcer's call for a killer who has just reached `killStreak`, or
 *  null below a spree. Eight and on stay Legendary. */
export function hillStreakCallout(killStreak: number): HillStreakCalloutKind | null {
  if (killStreak < 3) return null;
  if (killStreak === 3) return 'killingSpree';
  if (killStreak === 4) return 'rampage';
  if (killStreak === 5) return 'unstoppable';
  if (killStreak === 6) return 'dominating';
  if (killStreak === 7) return 'godlike';
  return 'legendary';
}
