// PvP Resurrect (owner rule, 2026-10-02): a player killed in the open world with
// another player's hand in it may skip the corpse run. Their death screen offers
// "PvP Resurrect", which releases the spirit as normal (it rises at the nearest
// graveyard, the same one Release picks) and stands them straight up there at
// full health and mana with no Keeper's Toll, the battleground deal for world
// PvP. The raise itself is spirit.ts pvpResurrect, beside the other ways back.
// The offer is not instant (owner rule 2026-10-12): the corpse waits
// PVP_RESURRECT_WAIT_SECONDS (Entity.pvpResurrectWait, counted down with the
// other per-player timers) before the raise is honored, and the death screen
// counts the wait down and names the graveyard so the player knows what comes.
//
// This leaf owns the RULE and the stamp: the offer is decided at death
// (worldPvpOnPlayerDeath calls notePvpResurrectAtDeath for every player death),
// and lives on the corpse as Entity.pvpResurrect until any revive clears it
// (spirit.ts reviveAt). It is never offered:
//   - on the instance plane (dungeons, raids, delves, rifts, battlegrounds,
//     arenas), which have their own way back;
//   - to a jailed player (the jail brawl is player damage too, and a graveyard
//     revive would walk them out of the cell).
// Pure apart from the one Entity write: sim clock only, no rng, no wall clock.

import { DUNGEON_X_THRESHOLD } from '../data';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

/** How recent a hostile player's hit must be for the death to count as PvP. */
export const PVP_RESURRECT_WINDOW_SECONDS = 10;
/** How long a PvP corpse waits before PvP Resurrect raises it (owner rule
 *  2026-10-12), so a killer is not met at once by a fresh, full-health foe. */
export const PVP_RESURRECT_WAIT_SECONDS = 15;

export interface PvpResurrectDeath {
  /** The killing blow came from a hostile player or a hostile player's pet. */
  killedByHostilePlayer: boolean;
  /** Seconds since the latest hostile player's hit, or null when none is booked. */
  secondsSincePlayerHit: number | null;
  onInstancePlane: boolean;
  jailed: boolean;
}

/** The pure rule: does this death offer PvP Resurrect? */
export function pvpResurrectEarned(death: PvpResurrectDeath): boolean {
  if (death.onInstancePlane || death.jailed) return false;
  if (death.killedByHostilePlayer) return true;
  return (
    death.secondsSincePlayerHit !== null &&
    death.secondsSincePlayerHit <= PVP_RESURRECT_WINDOW_SECONDS
  );
}

/** The wait is over: the raise may be honored now. */
export function pvpResurrectReady(p: Entity): boolean {
  return (p.pvpResurrectWait ?? 0) <= 0;
}

/** Whole seconds left on the wait, rounded up (the death screen's countdown and
 *  the self wire share this one rounding). */
export function pvpResurrectWaitSeconds(p: Entity): number {
  return Math.max(0, Math.ceil(p.pvpResurrectWait ?? 0));
}

/** Where PvP Resurrect may never be taken, whatever the death (shared with the raise). */
export function pvpResurrectBarred(p: Entity): boolean {
  return p.jailed === true || p.pos.x > DUNGEON_X_THRESHOLD;
}

/** Stamp the offer on a player's corpse at the moment of death, and start its
 *  PVP_RESURRECT_WAIT_SECONDS wait. It only ever turns the offer ON: every revive
 *  clears it (spirit.ts reviveAt), so a second pass over the same corpse, after
 *  the first pass has already cleared the hit books, can never take away an offer
 *  the first pass earned, nor restart the wait it began. `recentHits` is
 *  the World PvP books' attacker-to-time map for this victim, read before the
 *  death hook clears it; the books prune hits older than WORLD_PVP_ASSIST_WINDOW,
 *  so PVP_RESURRECT_WINDOW_SECONDS must not exceed it (pinned by test). */
export function notePvpResurrectAtDeath(
  ctx: SimContext,
  victim: Entity,
  killedByHostilePlayer: boolean,
  recentHits: ReadonlyMap<number, number> | undefined,
): void {
  let latest: number | null = null;
  for (const at of recentHits?.values() ?? []) if (latest === null || at > latest) latest = at;
  const earned = pvpResurrectEarned({
    killedByHostilePlayer,
    secondsSincePlayerHit: latest === null ? null : ctx.time - latest,
    onInstancePlane: victim.pos.x > DUNGEON_X_THRESHOLD,
    jailed: victim.jailed === true,
  });
  if (!earned || victim.pvpResurrect === true) return;
  victim.pvpResurrect = true;
  victim.pvpResurrectWait = PVP_RESURRECT_WAIT_SECONDS;
}
