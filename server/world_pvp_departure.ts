import { forfeitWorldPvpFightOnDeparture } from '../src/sim/pvp';
import type { Sim } from '../src/sim/sim';

/** A session leaving the world mid world fight forfeits it: the leaver dies to
 *  their opponent now, the honor and the kill/death record land now, and the
 *  gold stake reaches the winner after WORLD_PVP_FORFEIT_PAYOUT_SECONDS
 *  (src/sim/pvp/world_pvp_forfeit.ts owns the rule). Called from every
 *  departure the player controls or cannot be told apart from one: a dropped
 *  socket (a closed client or a lost connection, before the linkdead grace
 *  begins), a deliberate logout, and a takeover from another login. Runs
 *  BEFORE the departure's save, so the death and the debit are what persist.
 *  A no-op for a player in no live world fight. */
export function forfeitWorldPvpFightOnSessionDeparture(sim: Sim, pid: number): boolean {
  return forfeitWorldPvpFightOnDeparture(sim.ctx, pid);
}
