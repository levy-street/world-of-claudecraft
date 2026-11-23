// Decides whether a server {t:'error'} frame ends the session for good or is
// the transient reconnect-conflict window, for EVERY join attempt: the first
// one a freshly constructed ClientWorld makes (a char-select "Enter World"
// click, or a page reload after a crash/bug) exactly as much as a later
// mid-session auto-reconnect.
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
// This is NOT gated on having already been through one drop-and-retry cycle
// in this browser tab. A first attempt lands in the exact same "server has
// not yet noticed the old socket died" window as a later one: the roster's
// online flag that decided "Enter World" (rather than "Take Over") reflects
// whatever snapshot the char-select list last fetched, which can lag a drop
// that happened seconds ago. Treating attempt zero as automatically fatal
// turned every such race into a dead-end overlay the player could only clear
// by manually retrying (each retry itself a fresh attempt zero) until the
// server-side state finally caught up, sometimes stretching toward the full
// linkdead grace under load, exactly the symptom this predicate exists to
// avoid. The deliberate "someone else is actively playing this character"
// case is already handled by its own explicit UI (the char-select Take Over
// button + confirm, which calls takeoverCharacter and only then enters), so
// widening this tolerance to attempt zero does not blur that path: a
// genuinely live conflict still surfaces the fatal overlay once the bound
// below is spent, just a little slower than instantly.
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
// Any join attempt treats it exactly like a conflict: keep backing off rather
// than end the session, since the next retry lands once the stall or
// database episode has passed. It carries its own counter, bounded at
// MAX_TIMEOUT_REJECTIONS (20) rather than the conflict bound of 8 because a
// saturation or database episode outlasts the server keepalive window that
// clears a conflict.

// Wire contract: the exact rejection string server/linkdead.ts planJoin sends.
export const RECONNECT_CONFLICT_ERROR = 'character already in world';

export const MAX_CONFLICT_REJECTIONS = 8;

export function isTransientReconnectRejection(error: unknown, conflictRejections: number): boolean {
  return error === RECONNECT_CONFLICT_ERROR && conflictRejections < MAX_CONFLICT_REJECTIONS;
}

// Wire contract: this literal must stay byte-identical to the server's auth
// rejection table entry (server/ws_auth.ts, WS_AUTH_ERROR.authTimedOut).
// src/ui/api_error_i18n.ts deliberately has no match arm for it: its NOTE lists
// the string as an untranslated protocol diagnostic, so when it does surface
// (an initial connect, or past the bound below) the player sees the raw
// English wire text by design.
export const RECONNECT_TIMEOUT_ERROR = 'authentication timed out';

export const MAX_TIMEOUT_REJECTIONS = 20;

export function isTransientTimeoutRejection(error: unknown, timeoutRejections: number): boolean {
  return error === RECONNECT_TIMEOUT_ERROR && timeoutRejections < MAX_TIMEOUT_REJECTIONS;
}

// Auto-reconnect backoff for an unexpectedly dropped game socket. The server
// holds the character in-world (linkdead) for five minutes; the retry window
// is deliberately longer, since past the grace a successful auth simply
// performs a fresh join from the last save. Roughly 1s, 2s, 4s, 8s, then 15s
// apart, with each delay spread over a 0.5x to 1.5x jitter band and clamped at
// the 15s cap (computeBackoffDelay) so many clients dropped by one server blip
// do not retry in lockstep. The clamp trims the band's upper half once the
// schedule reaches the cap, so across 40 attempts the total runs from roughly
// 4.6 minutes (every draw at the floor) to 9.4 minutes (every draw at the
// ceiling), with an expected total near 8 minutes, before giving up for good.
// Read by src/net/online.ts (the reconnect loop) and by the reconnect-overlay
// show-grace pin (tests/reconnect_overlay.test.ts): the grace must clear attempt
// 1's full jitter band, and a band widened here without that pin would quietly
// reintroduce the veil blink.
export const RECONNECT_BASE_DELAY_MS = 1_000;
export const RECONNECT_MAX_DELAY_MS = 15_000;
export const RECONNECT_MAX_ATTEMPTS = 40;
