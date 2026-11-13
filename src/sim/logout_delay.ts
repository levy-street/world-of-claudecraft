// How long the Log Out button makes a player wait before the character
// leaves the world. The wait is what a player pays for leaving somewhere
// unsafe: taking damage during it cancels the logout (the host owns the
// countdown, server/logout_timer.ts), so a logout can never be a free escape
// from a fight.
//
//   - not in combat, PvP flag off: no wait, the logout is instant
//   - in combat (or just out of it), PvP flag off: LOGOUT_COMBAT_SECONDS
//   - PvP flag on: LOGOUT_PVP_FLAGGED_SECONDS
//   - PvP flag on and a recent world fight: LOGOUT_PVP_COMBAT_SECONDS
//
// "In combat" is the sim's own combat state (`Entity.inCombat`: still held on
// a hate table, or a combat event in the last few seconds). A "recent world
// fight" is a world-hostile hit, taken or dealt, inside
// WORLD_PVP_DEPARTURE_HOLD_WINDOW: the same window the departure hold reads
// (pvp/world_pvp_forfeit.ts worldPvpHoldsDeparture), so the button and every
// other way out of the game agree on what "recent" means. An unflagged player
// can still trade world-hostile hits in a free-for-all zone; that fight counts
// as combat for the whole window, so the instant arm never covers it.
//
// A corpse or a ghost has nothing left to escape from and leaves at once.
//
// Host-agnostic: no rng, no wall clock. Only the server asks (the offline
// world and the RL env have no departure to judge), and it reads only the
// entity, the world PvP books and the sim clock.

import { WORLD_PVP_DEPARTURE_HOLD_WINDOW } from './pvp/world_pvp_rules';
import type { SimContext } from './sim_context';

export const LOGOUT_COMBAT_SECONDS = 10;
export const LOGOUT_PVP_FLAGGED_SECONDS = 15;
export const LOGOUT_PVP_COMBAT_SECONDS = 30;

/** Seconds the Log Out button waits for `pid` right now; 0 is an instant logout. */
export function logoutDelaySeconds(ctx: SimContext, pid: number): number {
  const e = ctx.entities.get(pid);
  if (!e || e.kind !== 'player' || e.dead || e.ghost) return 0;
  const foughtAt = ctx.worldPvpBooks.lastFightAt.get(pid);
  const recentWorldFight =
    foughtAt !== undefined && ctx.time - foughtAt <= WORLD_PVP_DEPARTURE_HOLD_WINDOW;
  if (e.pvpFlag) return recentWorldFight ? LOGOUT_PVP_COMBAT_SECONDS : LOGOUT_PVP_FLAGGED_SECONDS;
  return recentWorldFight || e.inCombat ? LOGOUT_COMBAT_SECONDS : 0;
}
