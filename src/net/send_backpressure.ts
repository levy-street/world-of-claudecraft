// Client-side send backpressure gate for the periodic movement-intent stream
// (issue #2943). `ws.send()` never blocks: when the local uplink cannot drain
// as fast as the client writes, bytes queue in the browser's own outbound
// buffer, surfaced as `ws.bufferedAmount`. Two players sharing one saturated
// residential connection hit exactly this: each client keeps calling
// `sendInput`'s unconditional 50 ms timer at full rate regardless of whether
// the previous frame drained, so intent frames pile up instead of being
// shed. WebSocket rides one ordered TCP stream, so the server's keepalive
// pong (`WS_KEEPALIVE_PING_MS`, server/game.ts) queues behind that same
// backlog; once a session misses one whole keepalive interval the server
// terminates it into linkdead, and the client's reconnect_policy.ts auto-retry
// reads back as a "quick reconnecting" loop.
//
// The fix: skip an input send while the local buffer is already backed up
// past a client-local limit. One input frame serializes under 200 bytes, so
// 64 KiB leaves headroom for more than 100 full frames of ordinary scheduler
// jitter while stopping ordinary input admission after the threshold; a send
// admitted exactly at the boundary adds at most one input frame. Healthy,
// draining sockets never trip it. Most movement intent is idempotent-latest;
// the few engagement edges that are not
// are retained by ClientWorld until a real send succeeds. This is deliberately
// NOT the client-side send
// coalescing that docs/design/player-performance/packet-3-input-cadence.md
// (R13, Decision 3) rules out of scope: that ruling is about reducing the
// SEND CADENCE under normal conditions, which the facing-feel cluster
// depends on; this gate is a no-op whenever the socket is draining (the
// normal case) and only ever activates on a genuine congestion signal.
// `cmd` frames are NOT idempotent and must never be gated this way.
export const INPUT_SEND_BACKPRESSURE_LIMIT_BYTES = 64 * 1024;
export const INPUT_SEND_MAX_FRAME_BYTES = 200;

// True when the socket's own unflushed outbound buffer has grown past the
// limit, i.e. the local uplink is not draining and an input send should be
// shed rather than queued behind the backlog that is already not moving.
export function isInputSendBackpressured(
  bufferedAmount: number,
  limit = INPUT_SEND_BACKPRESSURE_LIMIT_BYTES,
): boolean {
  return bufferedAmount > limit;
}
