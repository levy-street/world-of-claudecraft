// The WebSocket keepalive sweep runs on a fixed interval and terminates any live
// session that did not answer the previous interval's ping. That verdict is only
// sound when the sweep itself ran on time. If the process stalled and the sweep
// fired late, queued pong frames were never processed during the stall, so a
// still-set awaitingPong flag reflects the stall and not a dead client. This factor
// is the stall threshold expressed in whole intervals. Below 1.0x every normal timer
// jitter would read as a stall; at 1.5x a sweep half an interval late means queued
// pongs were never processed, so the termination evidence is void.
//
// Deliberate consequence: while the loop is CHRONICALLY late (every sweep past the
// threshold), reaping is paused entirely, so genuinely dead sockets accumulate and
// their characters answer 'character already in world' until one on-time sweep
// runs. That is the intended trade: a saturated process must not mass-terminate
// every live session on evidence the stall itself manufactured; the dead sockets
// drain one clean interval after the loop recovers.
export const KEEPALIVE_STALL_FACTOR = 1.5;
// WS protocol-level ping cadence; shared by GameServer.start() and dependency-light
// keepalive tests.
export const WS_KEEPALIVE_PING_MS = 30_000;

// True when the gap since the previous sweep exceeds the stall threshold, meaning
// this sweep fired late enough that pong silence is not evidence of a dead client.
export function keepaliveSweepDelayed(
  nowMs: number,
  lastSweepAtMs: number,
  intervalMs: number,
): boolean {
  const elapsed = nowMs - lastSweepAtMs;
  return elapsed > KEEPALIVE_STALL_FACTOR * intervalMs;
}

// Hard liveness deadline, independent of the pong check above. The pong check
// judges a one-shot flag at sweep time, so every late sweep voids its evidence
// and (deliberately) reaps nobody; on a chronically late server a black-holed
// socket therefore held its character 'already in world' with no upper bound
// at all, long after the client's bounded reconnect had given up. This
// deadline caps that: a socket the server has processed NO frame from (no
// input, no pong; browsers answer pings on their own, so an AFK or
// backgrounded tab still counts as alive) for ten whole minutes is terminated
// into the linkdead grace, and the character resumes on the next reconnect.
export const WS_SILENCE_DEADLINE_MS = 10 * 60 * 1000;

// Last frame PROCESSED from each socket, keyed on socket identity (a resume
// swaps the session's socket, so the replacement starts its own clock and a
// late frame from the old one can never vouch for it). A WeakMap so a torn-down
// socket takes its entry with it.
const lastFrameAtBySocket = new WeakMap<object, number>();

export function noteClientFrame(ws: object, nowMs = Date.now()): void {
  lastFrameAtBySocket.set(ws, nowMs);
}

// True when the socket's silence, measured only up to the PREVIOUS sweep,
// exceeds the deadline. Stopping the measurement at the previous sweep is what
// makes the verdict stall-tolerant: a frame that arrived before the previous
// sweep is normally processed (and stamped) in the poll phase that follows it,
// well before this sweep, while frames that arrived since may still be queued
// behind a stall, so that interval is never counted. The ordering is not an
// absolute guarantee (a very large fd backlog, or an async inflate if
// permessage-deflate were ever enabled on the WebSocketServer, can carry a
// frame to a later turn), which is why the deadline is many ping intervals
// long: a live client has answered several pings inside it. A socket with no
// stamp yet (handshake just finished) is never judged.
export function socketSilentPastDeadline(ws: object, lastSweepAtMs: number): boolean {
  const lastFrameAt = lastFrameAtBySocket.get(ws);
  if (lastFrameAt === undefined) return false;
  return lastSweepAtMs - lastFrameAt >= WS_SILENCE_DEADLINE_MS;
}

// The sweep's per-session verdict: reap (terminate into the linkdead grace)
// when the previous ping went unanswered and this sweep ran on time, OR when
// the socket's proven silence has passed the hard deadline regardless of how
// late this sweep is.
export function shouldReapSession(
  session: { awaitingPong: boolean; ws: object },
  delayed: boolean,
  lastSweepAtMs: number,
): boolean {
  return (session.awaitingPong && !delayed) || socketSilentPastDeadline(session.ws, lastSweepAtMs);
}
