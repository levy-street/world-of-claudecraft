// The client half of the Log Out button. The server owns the countdown
// (server/logout_timer.ts): the client asks, the server answers with a
// `logout` event (`started` with the seconds to wait, `cancelled`, or
// `completed`), and only `completed` ends the session and returns the player
// to character select. Until then the player is still in the world and still
// playing.
//
// Socket-free and clock-injected: `online.ts` puts the frames on the wire and
// feeds the events in, so the whole flow is unit-tested without a WebSocket
// (tests/logout_flow.test.ts).
//
// One fallback, for a server that predates the countdown: it leaves the world
// on the spot and sends no `logout` event at all. If nothing answers within
// LOGOUT_ACK_TIMEOUT_MS the flow finishes by itself, which is exactly what
// the client did before the countdown existed.

import type { LogoutEvent } from '../sim/types';

/** How long to wait for the server's first `logout` event before treating the
 *  logout as done (a server from before the countdown never sends one). */
export const LOGOUT_ACK_TIMEOUT_MS = 5000;

export interface LogoutFlowDeps {
  /** Put a logout frame on the wire. False when the socket is not open. */
  send(frame: { t: 'logout'; cancel?: true }): boolean;
  /** The logout is done: end the session and return to character select. */
  finish(): void;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

type LogoutFlowState = 'idle' | 'asked' | 'counting' | 'done';

export class LogoutFlow {
  private state: LogoutFlowState = 'idle';
  private ackTimer: unknown;

  constructor(private readonly deps: LogoutFlowDeps) {}

  /** True from the Log Out press until the server answers `cancelled` or
   *  `completed` (or the connection drops under it). */
  get active(): boolean {
    return this.state === 'asked' || this.state === 'counting';
  }

  /** The Log Out button. Pressed again while the countdown is on screen it
   *  cancels it (the menu's Log Out entry is the keyboard road to Cancel);
   *  pressed again before the server has answered it does nothing. */
  request(): void {
    if (this.state === 'counting') {
      this.cancel();
      return;
    }
    if (this.state !== 'idle') return;
    // No open socket means no world to wait on: leave at once.
    if (!this.deps.send({ t: 'logout' })) {
      this.finish();
      return;
    }
    this.state = 'asked';
    this.ackTimer = this.deps.setTimer(() => {
      this.ackTimer = undefined;
      if (this.state === 'asked') this.finish();
    }, LOGOUT_ACK_TIMEOUT_MS);
  }

  /** The Cancel button. The server confirms with a `cancelled` event. */
  cancel(): void {
    if (this.active) this.deps.send({ t: 'logout', cancel: true });
  }

  /** A `logout` event from the server. */
  onEvent(event: LogoutEvent): void {
    if (this.state === 'done') return;
    this.clearAckTimer();
    if (event.phase === 'started' || event.phase === 'countdown') this.state = 'counting';
    else if (event.phase === 'cancelled') this.state = 'idle';
    else this.finish();
  }

  /** The connection closed. Returns whether a countdown was on screen, so the
   *  caller can take it down and let the normal reconnect run: the player is
   *  coming back, and the server ends the countdown when they do.
   *
   *  A close BEFORE the server answered is a different thing: a server from
   *  before the countdown answers a held logout by closing the socket, with no
   *  event. Reconnecting there would walk the player straight back into the
   *  world they asked to leave, so the logout finishes instead. */
  onSocketClosed(): boolean {
    if (this.state === 'asked') {
      this.finish();
      return false;
    }
    if (this.state !== 'counting') return false;
    this.state = 'idle';
    return true;
  }

  private finish(): void {
    this.clearAckTimer();
    this.state = 'done';
    this.deps.finish();
  }

  private clearAckTimer(): void {
    if (this.ackTimer === undefined) return;
    this.deps.clearTimer(this.ackTimer);
    this.ackTimer = undefined;
  }
}
