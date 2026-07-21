// WebSocket send backpressure guard.
//
// `ws.send()` never blocks: bytes the peer has not yet acknowledged pile up in
// the socket's outbound buffer, surfaced as `ws.bufferedAmount`. The server
// pushes a snapshot to every session 20 times a second, so a single client that
// stops draining its socket (a frozen tab, a wedged proxy, a deliberately
// non-reading attacker) accumulates an unbounded write buffer and can OOM the
// whole process, starving every other player. Checking only `readyState` does
// not catch this: the socket is still OPEN, just not draining.
//
// The fix is to terminate any session whose unflushed buffer climbs past a hard
// limit. The limit sits far above one legitimate burst: inbound frames are
// capped at 16 KiB (maxPayload) and an interest-scoped snapshot is a few KiB, so
// several MiB of backlog can only mean a client that is not reading.
export const WS_BACKPRESSURE_LIMIT_BYTES = 8 * 1024 * 1024;

// True when a socket's unflushed outbound buffer has grown past the limit, i.e.
// the peer is not draining and the session should be torn down.
export function isBackpressureExceeded(
  bufferedAmount: number,
  limit = WS_BACKPRESSURE_LIMIT_BYTES,
): boolean {
  return bufferedAmount > limit;
}
