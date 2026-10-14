// World PvP forfeit: a player who leaves the world in the middle of a world
// fight loses it.
//
// Before this, a player losing an open-world fight could log out (or close
// the client, or pull the cable) and the fight simply ended: no death, no
// honor or kill for the opponent, no gold moved. Now the authoritative host
// calls `forfeitWorldPvpFightOnDeparture` the moment a session leaves the
// world for a reason the player controls or cannot prove they did not (a
// deliberate logout, a dropped socket, a takeover from another login), and
// if a world fight is live the leaver dies to their opponent through the one
// shared death hub. Everything the death hook does for a real kill happens
// here too, under the same rules (the per-pair diminishing returns, the grey
// rule, the raid rule, the flagged-only gold stake, the split among everyone
// who worked for it): the honor pool and the kill/death record land on the
// spot, the stake leaves the leaver's purse on the spot, and the stake reaches
// the winners WORLD_PVP_FORFEIT_PAYOUT_SECONDS later (world_pvp_payouts.ts).
//
// "Live" is the assist window the kill resolution already uses: an enemy
// player hit the leaver, or the leaver hit an enemy player, inside the last
// WORLD_PVP_ASSIST_WINDOW seconds, and that enemy is still standing and still
// world-hostile to them. A player who walks into a sanctuary, waits out the
// window, or whose opponent already fell leaves freely; a duel, a battleground
// or an arena match is never a world fight (isWorldPvpHostile), so their own
// desertion rules stay in charge.
//
// Host-agnostic: no rng, no wall clock. Only the server calls it (the offline
// world and the RL env have no departure to judge), and it reads only the
// world PvP books and the sim clock, so a replay of the same inputs resolves
// identically.

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { isWorldPvpHostile } from './world_pvp';
import { WORLD_PVP_ASSIST_WINDOW } from './world_pvp_rules';

/** A live, world-hostile enemy for `victim` from one candidate pid. An enemy
 *  who is themselves on the way out (`PlayerMeta.leaving`: their final save is
 *  already taken) is no opponent: the honor and the held gold would land on a
 *  record that is never saved again, while the leaver's debit would persist. */
function liveEnemy(ctx: SimContext, victim: Entity, pid: number): Entity | null {
  const e = ctx.entities.get(pid);
  const meta = ctx.players.get(pid);
  if (!e || e.kind !== 'player' || e.dead || !meta || meta.leaving) return null;
  return isWorldPvpHostile(ctx, e, victim) ? e : null;
}

/**
 * The opponent of a live world fight `victim` is in, or null. The most recent
 * enemy who hit the victim inside the assist window wins; failing that (the
 * victim threw every blow and took none yet), the enemy the victim hit most
 * recently. Ties keep the first seen, so the answer is a pure function of the
 * books. Bounded by the rosters of the players trading blows in the window.
 */
export function worldPvpFightOpponent(ctx: SimContext, victim: Entity): Entity | null {
  const books = ctx.worldPvpBooks;
  const fresh = (at: number) => ctx.time - at <= WORLD_PVP_ASSIST_WINDOW;
  let best: Entity | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  const hitBy = books.recentDamage.get(victim.id);
  if (hitBy) {
    for (const [pid, at] of hitBy) {
      if (!fresh(at) || at <= bestAt) continue;
      const enemy = liveEnemy(ctx, victim, pid);
      if (enemy) {
        best = enemy;
        bestAt = at;
      }
    }
  }
  if (best) return best;
  for (const [subject, roster] of books.recentDamage) {
    const at = roster.get(victim.id);
    if (at === undefined || !fresh(at) || at <= bestAt) continue;
    const enemy = liveEnemy(ctx, victim, subject);
    if (enemy) {
      best = enemy;
      bestAt = at;
    }
  }
  return best;
}

/**
 * The departure hook: if `pid` is in a live world fight, they die to their
 * opponent now and the fight resolves as a forfeit (the gold held for the
 * payout delay). Returns true when a forfeit was resolved. A dead, jailed or
 * absent player, a realm with world PvP switched off, and a player in no live
 * world fight are all left exactly as they are. Idempotent: a second call
 * finds the leaver dead and does nothing.
 */
export function forfeitWorldPvpFightOnDeparture(ctx: SimContext, pid: number): boolean {
  if (ctx.worldPvpDisabled) return false;
  const victim = ctx.entities.get(pid);
  if (!victim || victim.kind !== 'player' || victim.dead || !ctx.players.has(pid)) return false;
  const opponent = worldPvpFightOpponent(ctx, victim);
  if (!opponent) return false;
  const books = ctx.worldPvpBooks;
  // The leaver is standing, so any paid-death row for them is from an earlier
  // death the once-a-minute sweep has not cleared yet (a revived fighter who
  // has only thrown blows since): without this the death hook would read it as
  // the same death re-entered and resolve nothing.
  books.paidDeaths.delete(pid);
  books.forfeitVictim = pid;
  try {
    ctx.handleDeath(victim, opponent);
  } finally {
    books.forfeitVictim = null;
  }
  return true;
}
