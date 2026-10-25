// Same-client resume proof for a reconnect that races the keepalive sweep.
//
// After a black-holed drop (no FIN/RST reaches the server) the old socket still
// looks live until the keepalive sweep reaps it (server/keepalive_sweep.ts, up to
// one to two WS_KEEPALIVE_PING_MS intervals), and planJoin (server/linkdead.ts)
// refuses a re-auth for the same character as 'character already in world' all
// that time, so the client burns its bounded conflict retries on a session it
// owns. Every `hello` frame carries a fresh unguessable token for its session
// (server/session_hello.ts). The client keeps it in memory only (never storage,
// so another tab or device cannot present it) and echoes it on its auto-reconnect
// auth frame (src/net/world_auth_message.ts). A match from the same account
// proves the reconnect comes from the very client the old socket served, so the
// server supersedes the stale socket instead of refusing.
//
// A missing or mismatched token keeps today's refusal exactly, which leaves the
// explicit char-select Take Over flow the only way to displace a session played
// from elsewhere. The token is a second factor ON TOP of the account's full-scope
// auth token, never instead of it: that auth token alone can already take the
// character over through the takeover route, so the resume token grants no
// capability its holder lacked; it only lets the same tab skip the wait.

import { randomBytes, timingSafeEqual } from 'node:crypto';

// 32 random bytes, base64url: 43 characters, no padding.
const RESUME_TOKEN_BYTES = 32;
const RESUME_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function mintResumeToken(): string {
  return randomBytes(RESUME_TOKEN_BYTES).toString('base64url');
}

// The auth frame field is untrusted client input: anything but a well-formed
// token string reads as "no token presented".
export function presentedResumeToken(raw: unknown): string | null {
  return typeof raw === 'string' && RESUME_TOKEN_PATTERN.test(raw) ? raw : null;
}

// Constant-time comparison. An empty held token (a session that has not been
// sent a hello yet) never matches anything. Lengths are compared in BYTES, since
// timingSafeEqual throws on unequal buffers and a non-ASCII value can share a
// token's character count.
export function resumeTokenMatches(held: string, presented: string | null | undefined): boolean {
  if (!held || !presented) return false;
  const a = Buffer.from(held);
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}
