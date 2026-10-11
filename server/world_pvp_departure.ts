import { forfeitWorldPvpFightOnDeparture } from '../src/sim/pvp';
import type { Sim } from '../src/sim/sim';

/** A session leaving the world mid world fight forfeits it: the leaver dies to
 *  their opponent now, the honor and the kill/death record land now, and the
 *  gold stake reaches the winner after WORLD_PVP_FORFEIT_PAYOUT_SECONDS
 *  (src/sim/pvp/world_pvp_forfeit.ts owns the rule). Called from the two
 *  places every departure passes through: `socketClosed` (a closed client or
 *  a lost connection, before the linkdead grace begins) and `leave()` (a
 *  deliberate logout, every kick including the message-flood one, a takeover
 *  from another login, the end of the linkdead grace). Both run it BEFORE the
 *  departure's save, so the death and the debit are what persist.
 *
 *  `canSave` is false for a session whose writes can never land again (an
 *  escrow-quarantined zombie, displaced by a lease fence or a ledger failure):
 *  its death and debit could not persist while the winner's credit would, so
 *  a server-side fault never mints gold or honor. A no-op for a player in no
 *  live world fight, and idempotent (the second call finds a corpse). */
export function forfeitWorldPvpFightOnSessionDeparture(
  sim: Sim,
  pid: number,
  canSave: boolean,
): boolean {
  if (!canSave) return false;
  return forfeitWorldPvpFightOnDeparture(sim.ctx, pid);
}
