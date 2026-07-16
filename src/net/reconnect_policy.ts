// Decides whether a server {t:'error'} frame received during an auto-reconnect
// ends the session for good or is the transient reconnect-conflict window.
//
// After a black-holed drop (no FIN/RST ever reaches the server: a mobile
// WiFi-to-cellular handoff, a NAT rebind), the server still counts the old
// socket as live, so a re-auth for the same character is rejected with
// 'character already in world' until the server's keepalive sweep notices the
// dead socket and flips the session linkdead. That rejection must not end the
// reconnect loop, or the resume never fires in exactly the abrupt-drop case
// the linkdead grace exists for. Every other error frame (kick, moderation,
// takeover, failed auth) is final.
//
// The tolerance is bounded: if the character is genuinely held by someone
// else's LIVE socket (an explicit takeover from another device), the conflict
// never clears, so after MAX_CONFLICT_REJECTIONS the client gives up and
// shows the fatal overlay. The bound comfortably covers the server's
// detection window (one to two 30s keepalive intervals) at the reconnect
// backoff cadence.
//
// A second transient failure mode is the auth-timeout rejection. The server
// sends it when a handshake cannot complete: the first auth frame missed the
// auth window (a server event-loop stall under CPU saturation, or a reconnect
// race), or a database failure interrupted the handshake mid-flight (the
// server converts that rejection into this same literal, so clients keep
// backing off until the database recovers instead of being dumped to login).
// A reconnecting client treats it exactly like a conflict: keep backing off
// rather than end the session, since the next retry lands once the stall or
// database episode has passed. It carries its own counter, bounded at
// MAX_TIMEOUT_REJECTIONS (20) rather than the conflict bound of 8 because a
// saturation or database episode outlasts the server keepalive window that
// clears a conflict.

// Wire contract: the exact rejection string server/linkdead.ts planJoin sends.
export const RECONNECT_CONFLICT_ERROR = 'character already in world';

export const MAX_CONFLICT_REJECTIONS = 8;

export function isTransientReconnectRejection(
  error: unknown,
  reconnectAttempts: number,
  conflictRejections: number,
): boolean {
  return (
    reconnectAttempts > 0 &&
    error === RECONNECT_CONFLICT_ERROR &&
    conflictRejections < MAX_CONFLICT_REJECTIONS
  );
}

// Wire contract: this literal must stay byte-identical to the server's auth
// rejection table entry (server/ws_auth.ts, WS_AUTH_ERROR.authTimedOut).
// src/ui/api_error_i18n.ts deliberately has no match arm for it: its NOTE lists
// the string as an untranslated protocol diagnostic, so when it does surface
// (an initial connect, or past the bound below) the player sees the raw
// English wire text by design.
export const RECONNECT_TIMEOUT_ERROR = 'authentication timed out';

export const MAX_TIMEOUT_REJECTIONS = 20;

export function isTransientTimeoutRejection(
  error: unknown,
  reconnectAttempts: number,
  timeoutRejections: number,
): boolean {
  return (
    reconnectAttempts > 0 &&
    error === RECONNECT_TIMEOUT_ERROR &&
    timeoutRejections < MAX_TIMEOUT_REJECTIONS
  );
}
