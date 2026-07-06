import type * as http from 'node:http';

// node:http server timeouts + max header size, pinned as named constants. These
// EQUAL Node's built-in defaults, so applying them changes NO runtime behavior:
// boot wires them deliberately (server/main.ts startServer calls
// applyServerTimeouts and passes maxHeaderSize to http.createServer), which
// makes the numbers named, visible in one place, and pinned by a test
// (tests/server/tunables.test.ts) so a future Node default change (or an
// accidental edit) is caught rather than silently inherited.
//
// Three constraints the values satisfy, and why:
//   (i)  HEADERS_TIMEOUT_MS (60s) MUST exceed KEEP_ALIVE_TIMEOUT_MS (5s). On a
//        kept-alive connection the header phase of the NEXT request only starts
//        after the keep-alive idle window; if the headers timeout were the shorter
//        of the two, a reused socket could trip a premature 408 header-timeout race
//        on its follow-up request. 60s > 5s keeps keep-alive reuse safe.
//   (ii) REQUEST_TIMEOUT_MS (300s) must not strangle the WebSocket upgrade handshake
//        nor a slow card upload. The upgrade is a header-phase event and the ws auth
//        handshake carries its OWN 10s AUTH_TIMEOUT_MS (server/ws_auth.ts), so the
//        request timeout never governs a live game socket. The largest legitimate
//        request body is a player-card PNG capped at MAX_CARD_BYTES = 4 MiB
//        (server/player_card.ts); 4 MiB spread over 300s needs only ~14 KiB/s
//        sustained, far below any real uploader, so 300s never cuts one off.
//   (iii) Every value equals the Node default, so codifying them changes ZERO
//        runtime behavior. Verified against the installed Node (node -p
//        "http.createServer().requestTimeout" etc. on Node v24.15.0): requestTimeout
//        300000, headersTimeout 60000, keepAliveTimeout 5000, maxHeaderSize 16384.
//
// maxHeaderSize is READ-ONLY after construction: it cannot be assigned onto an
// existing server, so it must ride the http.createServer(options) call. It is
// exported here for that one call site (server/main.ts startServer) and is
// deliberately NOT touched by applyServerTimeouts.

/** Max time (ms) from connection open to the full request being received. Node default. */
export const REQUEST_TIMEOUT_MS = 300_000;
/**
 * Max time (ms) to receive the complete request headers. Node default. MUST exceed
 * KEEP_ALIVE_TIMEOUT_MS (constraint i) or kept-alive reuse hits a premature 408 race.
 */
export const HEADERS_TIMEOUT_MS = 60_000;
/** Idle keep-alive window (ms) before an inactive socket is closed. Node default. */
export const KEEP_ALIVE_TIMEOUT_MS = 5_000;
/**
 * Max total size (bytes) of the request-line + headers. Node default. READ-ONLY
 * after construction, so it rides http.createServer({ maxHeaderSize }), never a
 * post-construction assignment.
 */
export const MAX_HEADER_SIZE_BYTES = 16_384;

/**
 * Set the three MUTABLE timeouts on an already-constructed http.Server to the named
 * constants above. maxHeaderSize is not settable here (read-only after
 * construction); it rides http.createServer({ maxHeaderSize: MAX_HEADER_SIZE_BYTES }).
 * Exposed as a seam so a test can assert the effective values on a bare http.Server
 * without booting the game server.
 */
export function applyServerTimeouts(server: http.Server): void {
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
}
