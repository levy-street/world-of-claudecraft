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
