import { forfeitWorldPvpFightOnDeparture, worldPvpHoldsDeparture } from '../src/sim/pvp';
import type { Sim } from '../src/sim/sim';
import type { ClientSession, GameServer } from './game';

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

/** A deliberate logout: forfeit a live world fight first, then report whether
 *  a fight inside WORLD_PVP_DEPARTURE_HOLD_WINDOW still holds the body in the
 *  world. True means the caller enters the linkdead grace (`socketClosed`), as
 *  a closed client would, instead of leaving at once; false (no recent fight,
 *  the forfeit killed them, or a session that can never save again) means a
 *  clean leave. */
export function worldFightHoldsLogout(sim: Sim, pid: number, canSave: boolean): boolean {
  forfeitWorldPvpFightOnSessionDeparture(sim, pid, canSave);
  return canSave && worldPvpHoldsDeparture(sim.ctx, pid);
}

/** Owner-requested logout or takeover closes the transport but retains a held
 *  body. Mark it linkdead before closing so the close event cannot tear it
 *  down. A takeover notice flushes before close, preserving the old client's
 *  return to character select; a fresh transport can resume the same body. */
export function holdWorldFightSession(
  server: Pick<GameServer, 'sim' | 'socketClosed'>,
  session: ClientSession,
  notify?: () => void,
): boolean {
  if (!worldFightHoldsLogout(server.sim, session.pid, !session.escrowQuarantined)) return false;
  notify?.();
  if (server.socketClosed(session, session.ws)) session.ws.close();
  return true;
}

/** Is a held (linkdead) body still inside its fight window? While it is, the
 *  account's other characters stay out of the world (planJoin), so switching
 *  to an alt cannot pull the fighter out of reach either. */
export function worldFightHoldsBody(sim: Sim, pid: number): boolean {
  return worldPvpHoldsDeparture(sim.ctx, pid);
}
