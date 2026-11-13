// The Log Out button's countdown. A `t:'logout'` frame no longer leaves the
// world on the spot: the sim says how long this player has to wait
// (src/sim/logout_delay.ts: nothing when safe, longer in combat, longer again
// when flagged for PvP or fresh out of a world fight), the session is told,
// and it leaves when the wait runs out. Taking damage during the wait cancels
// it, and so does a `t:'logout', cancel:true` frame (the Cancel button).
//
// This is the BUTTON's rule only. A player who gets out of the game any other
// way (a closed client, a dropped connection, a takeover from another login)
// never reaches this module: `socketClosed` holds the body for the linkdead
// grace and the world fight departure hold (server/world_pvp_departure.ts)
// keeps it there, exactly as before.
//
// A countdown the player DID ask for keeps running if their socket then
// closes (they pressed Log Out and shut the client, or a client from before
// the countdown reloaded right after sending the frame): the body stands in
// the world for what is left of the wait and then leaves, and damage still
// cancels it, after which it is an ordinary linkdead body under the hold
// rules. Coming back on a new socket ends the countdown: they are playing.
//
// When the wait does run out, the session leaves through `GameServer.leave`,
// so a world fight that is still live at that moment is forfeited like any
// other departure.
//
// Runs on the sim clock, so a stalled world loop cannot run a countdown down,
// and the client is told each second as it passes (it keeps no clock of its
// own). The per-tick cost is one map-size check when nobody is logging out,
// and a few field reads per session that is.

import { logoutDelaySeconds } from '../src/sim/logout_delay';
import type { Sim } from '../src/sim/sim';
import type { LogoutEvent } from '../src/sim/types';

/** What the countdown needs to know about a session. */
export interface LogoutTimerSession {
  pid: number;
  left: boolean;
  linkdead: boolean;
  /** The live transport; a resume swaps it for a new one. */
  ws: unknown;
}

interface PendingLogout {
  startedAt: number;
  /** The wait this countdown is serving, in seconds. Only ever grows. */
  seconds: number;
  endsAt: number;
  /** The last whole second told to the client, so each is told once. */
  announced: number;
  /** `PlayerMeta.counters.damageTaken` when the countdown began. */
  damageTaken: number;
  /** The transport that asked. A countdown never outlives it: a session that
   *  dropped and resumed on a new socket did not ask to log out there. */
  ws: unknown;
}

export class LogoutTimers<S extends LogoutTimerSession> {
  private readonly pending = new Map<S, PendingLogout>();

  /**
   * @param notify Send one logout event to the session's own client.
   * @param leave Take the session out of the world now (the clean leave).
   * @param drawCancelToken Draw a command-lane token for a cancel frame; false
   *   sheds it. The request itself stays lane-exempt (leaving must always work),
   *   but a countdown can be started again after a cancel, so without this a
   *   logout/cancel loop would run at the raw frame rate, outside every lane.
   */
  constructor(
    private readonly notify: (session: S, event: LogoutEvent) => void,
    private readonly leave: (session: S) => void,
    private readonly drawCancelToken: (session: S, nowSec: number) => boolean,
  ) {}

  /** Is this session inside a countdown right now? */
  isPending(session: S): boolean {
    return this.pending.has(session);
  }

  /** A `t:'logout'` frame: start the countdown (or leave at once when there is
   *  none to wait out), or cancel a running one. A repeated request while one
   *  is already running changes nothing, so a flood of frames costs a map read.
   *  Always true: the frame is consumed here, whatever it did. */
  handle(sim: Sim, session: S, cancel: unknown, receivedAtMs: number): true {
    if (session.left || session.linkdead) return true;
    // An entry from a socket this session has since dropped is not running.
    const running = this.pending.get(session)?.ws === session.ws;
    if (cancel === true) {
      if (this.drawCancelToken(session, receivedAtMs / 1000) && running) {
        this.stop(session, 'cancelled');
      }
      return true;
    }
    if (running) return true;
    const seconds = logoutDelaySeconds(sim.ctx, session.pid);
    if (seconds <= 0) {
      this.finish(session);
      return true;
    }
    this.pending.set(session, {
      startedAt: sim.ctx.time,
      seconds,
      endsAt: sim.ctx.time + seconds,
      announced: seconds,
      damageTaken: sim.meta(session.pid)?.counters.damageTaken ?? 0,
      ws: session.ws,
    });
    this.notify(session, { type: 'logout', phase: 'started', seconds });
    return true;
  }

  /** Once per world-loop pass: cancel the countdowns damage interrupted,
   *  lengthen the ones whose player got into worse trouble, and log out the
   *  ones that ran their course. */
  tick(sim: Sim): void {
    if (this.pending.size === 0) return;
    for (const [session, pending] of this.pending) {
      // Gone, or back in the game on a new socket: no logout left to finish.
      if (session.left || session.ws !== pending.ws) {
        this.pending.delete(session);
        continue;
      }
      const meta = sim.meta(session.pid);
      if (!meta) {
        // Still connected but no longer in the sim: never leave the client counting.
        this.stop(session, 'cancelled');
        continue;
      }
      if (meta.counters.damageTaken > pending.damageTaken) {
        this.stop(session, 'damaged');
        continue;
      }
      // The wait is owed for the state the player is in NOW, not the one they
      // pressed the button in: raising the PvP flag or opening a world fight
      // mid-countdown stretches it to the longer wait, measured from the press.
      const owed = logoutDelaySeconds(sim.ctx, session.pid);
      if (owed > pending.seconds) {
        pending.seconds = owed;
        pending.endsAt = pending.startedAt + owed;
        pending.announced = Math.ceil(pending.endsAt - sim.ctx.time);
        this.notify(session, { type: 'logout', phase: 'started', seconds: pending.announced });
      }
      const left = Math.ceil(pending.endsAt - sim.ctx.time);
      if (left > 0 && left < pending.announced) {
        pending.announced = left;
        this.notify(session, { type: 'logout', phase: 'countdown', seconds: left });
      }
      if (sim.ctx.time >= pending.endsAt) {
        this.pending.delete(session);
        this.finish(session);
      }
    }
  }

  private stop(session: S, reason: 'damaged' | 'cancelled'): void {
    this.pending.delete(session);
    this.notify(session, { type: 'logout', phase: 'cancelled', reason });
  }

  private finish(session: S): void {
    // Told first: `leave` marks the session gone, and the client returns to
    // character select on this event.
    this.notify(session, { type: 'logout', phase: 'completed' });
    this.leave(session);
  }
}
