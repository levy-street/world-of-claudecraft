// The session edges a Graveyard Shift run must hear about on the server, kept
// out of game.ts: a run is a parenthesis, so it closes before the host saves or
// moves the player (src/sim/graveyard_shift/CLAUDE.md). The sim owns the rules;
// this only says when to apply them.
import { graveyardShiftResolveLeave, hasMorthenIdentity } from '../src/sim/graveyard_shift';
import { graveyardShiftObservable } from '../src/sim/graveyard_shift/grave_staging';
import type { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

/** A dropped connection or a jail sentence: the run ends now, before the
 *  safety flush and before the jail captures where to send the player back. */
export function resolveGraveyardShiftDeparture(sim: Sim, pid: number): void {
  graveyardShiftResolveLeave(sim.ctx, pid);
}

/** leave(): every live mode that must resolve BEFORE the leave save, so the save
 *  sees its outcome. Each call is idempotent (removePlayer repeats the match
 *  ones after the save, harmlessly). */
export function resolveModesBeforeLeaveSave(sim: Sim, pid: number): void {
  resolveGraveyardShiftDeparture(sim, pid);
  // Arena forfeit accounting: keeps the remaining player's win/honor durable if
  // both combatants disconnect close together.
  sim.arenaResolveDesertion(pid);
  // Card Duel: drop the queue slot and forfeit any live match.
  sim.leaveCardMinigameEntirely(pid);
  // Thornhollow Fields: the leaver's recorded loss and rating delta are in the
  // persisted state.
  sim.bgResolveDesertion(pid);
}

/** A hotbar layout upload is refused while Morthen's kit stands in for the bar:
 *  the client freezes its writers, and the server never stores a layout the
 *  real character did not choose. */
export function hotbarLayoutSaveAllowed(sim: Sim, pid: number): boolean {
  return !hasMorthenIdentity(sim.entities.get(pid));
}

/** The snapshot filter's arm for the mode's private entities: the grave reaches
 *  only an eligible viewer, a Tibbs only the player who woke him. O(1) per pair. */
export function observable(sim: Sim, viewer: Entity, e: Entity): boolean {
  return graveyardShiftObservable(sim.ctx, viewer, e);
}
