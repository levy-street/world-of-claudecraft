// permessage-deflate (RFC 7692) for the game WebSocket.
//
// Every broadcast is one JSON string per session per tick, and most of its bytes
// repeat the previous tick's (key names, unchanged records, the keep list). A
// per-connection deflate stream with context takeover turns those repeats into
// back-references, so outbound snapshots shrink several-fold: about 9x for a
// 30-player walking town crowd and about 12x for solo players near mobs, measured
// on 2026-10-06 against real wire frames from the tests/bandwidth.test.ts harness.
// The game server's internet egress is billed per GB and /ws is most of it.
//
// Every frame is compressed, however small: while context takeover is on (the
// default, and what browsers negotiate) ws ignores its size threshold, which only
// applies once a peer negotiates no context takeover. That suits snapshots, since
// even a solo player's sub-1KiB frame is mostly a repeat of the previous tick.
//
// The knobs, tuned against those frames:
// - level 3: a few percent of one core at today's payload rate. The zlib work
//   runs on the libuv threadpool; ws's per-send stream and framing bookkeeping
//   stays on the main thread. Level 6 saves a little more for about 60% more
//   compression CPU.
// - window bits stay at the zlib default (15): 13 would save about 100 KiB of
//   zlib state per connection but give back about a fifth of the saving.
//
// Costs to watch as the realm grows (the kill switch below is the remedy):
// - memory: about 256 KiB of deflate state per connection, plus about 40 KiB of
//   inflate state once a browser compresses what it sends. That is about 15 MB
//   at 50 players and 300 MB at 1,000, native memory inside the game
//   container's mem_limit; the ws README also warns about zlib fragmentation at
//   high concurrency.
// - threadpool: compression jobs share libuv's pool (4 threads unless
//   UV_THREADPOOL_SIZE says otherwise) with scrypt password hashing
//   (server/auth.ts), so a burst of password logins can delay snapshot sends.
// - pre-auth inflate: a client may send compressed frames before it signs in.
//   ws inflates one frame at a time per socket, each capped at maxPayload, and
//   a rejected socket is answered uncompressed so it never allocates a deflate
//   stream (rejectHandshake in server/ws_auth.ts).
//
// Inbound is unchanged in size: ws hands the server's maxPayload to the
// extension, so the 16 KiB cap (server/CLAUDE.md) also bounds a client message's
// INFLATED length. A client that does not offer the extension, or a proxy that
// strips the header, just gets uncompressed frames; browsers negotiate it natively.
//
// Kill switch: WS_PERMESSAGE_DEFLATE=0 (or false), read once at boot by the
// validated Config (server/http/config.ts, wsPerMessageDeflate). Unset, empty, 1
// and true keep it on; the WebSocketServer options are fixed for the process.

import type { PerMessageDeflateOptions } from 'ws';

// zlib compression level, 1 (fastest) to 9 (smallest).
const WS_DEFLATE_LEVEL = 3;

/** The game WebSocketServer's `perMessageDeflate` option: false turns it off. */
export function wsPerMessageDeflateOptions(enabled: boolean): PerMessageDeflateOptions | false {
  if (!enabled) return false;
  return { zlibDeflateOptions: { level: WS_DEFLATE_LEVEL } };
}
