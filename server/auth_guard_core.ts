// The pure core of the two per-request auth-guard reads: row types and the
// row-to-answer computes, extracted from server/db.ts so the direct read path
// and the marketplace guard cache (server/woc_auth_guard_cache.ts) share ONE
// source of truth for the security decisions. This module is deliberately
// host-agnostic: no pg, no pool, no clock of its own (callers pass nowMs), so
// a unit test drives every branch with plain rows.
//
// Anything time-dependent is computed HERE, at read time, from the raw row:
// a cached row must never freeze a verdict. That is the whole reason the
// cache stores rows and not results (a cached "locked" result would outlive a
// lapsing suspension, and a cached token result would outlive expires_at).

import type { TokenScope } from './db';
import type { GeneralChatRateLimit } from './general_chat_quota_db';

// Re-exported for consumers of the pure core (the guard cache) that must not
// import the pg-bearing db module even for a type.
export type { TokenScope } from './db';

// ── Token probe ─────────────────────────────────────────────────────────────

/** The raw auth_tokens row the probe fetches (scope kept raw: the allowlist
 *  below is the ONE place a database value is promoted to authority). */
export interface AuthTokenRow {
  accountId: number;
  /** Raw database value; anything outside the allowlist fails closed. */
  scope: string;
  /** The row's expires_at as epoch milliseconds. */
  expiresAtMs: number;
}

/**
 * The fail-closed token verdict: null for a missing row, an unrecognized
 * scope value, or a row past its expiry at read time. The expiry check is
 * what makes a CACHED row safe (the SQL probe's expires_at > now() qual
 * cannot protect a row fetched earlier); on the direct path it is redundant
 * with the qual up to clock skew, and skew resolves toward refusal (the
 * fail-closed direction). No caller anywhere distinguishes an expired token
 * from a deleted one, so answering null here is semantically exact.
 */
export function tokenInfoFromRow(
  row: AuthTokenRow | null,
  nowMs: number,
): { accountId: number; scope: TokenScope } | null {
  if (!row) return null;
  if (row.scope !== 'full' && row.scope !== 'read') return null;
  if (!(row.expiresAtMs > nowMs)) return null;
  return { accountId: row.accountId, scope: row.scope };
}

// ── Moderation status ───────────────────────────────────────────────────────

export interface AccountModerationStatus {
  locked: boolean;
  banned: boolean;
  suspendedUntil: string | null;
  // True only for a self-deactivated account (locked, not banned, no active
  // suspension). Lets a caller distinguish the deactivation lock from a
  // suspension so it can surface the correct message/code (e.g. the API pipeline
  // requireAccount maps it to account.deactivated, not moderation.suspended).
  deactivated?: boolean;
  reason: string;
  message: string;
  // Chat mute is independent of `locked`: a muted account can still log in and
  // play, it just can't send chat until `chatMutedUntil` passes. Surfaced here
  // so the WS auth handshake can seed the live session without a second query.
  chatMutedUntil: string | null;
  chatStrikes: number;
  // Sparse account policy. Null means Unlimited. Loaded in this existing auth
  // read so a known-unlimited session never performs quota database work.
  generalChatRateLimit?: GeneralChatRateLimit | null;
}

/** The raw accounts row (plus the LEFT-JOINed chat-quota policy columns) the
 *  moderation read fetches, keys exactly as the SQL returns them. */
export interface AccountModerationRow {
  banned_at: string | Date | null;
  suspended_until: string | Date | null;
  moderation_reason: string | null;
  chat_muted_until: string | Date | null;
  chat_strikes: number | string | null;
  deactivated_at: string | Date | null;
  /** Chat-quota policy (LEFT JOIN): null/undefined when no policy row exists. */
  messages: number | string | null;
  window_minutes: number | string | null;
}

/**
 * The moderation verdict computed from the raw row at read time (nowMs).
 * Byte-for-byte the decision ladder that lived inline in
 * db.ts moderationStatusForAccount: admin-imposed states (ban, then active
 * suspension) outrank a self-imposed deactivation, all three resolve to
 * locked, and every time comparison (suspension lapse, chat-mute lapse)
 * happens HERE so a cached row's verdict moves with the clock.
 */
export function computeModerationStatus(
  row: AccountModerationRow | null,
  nowMs: number,
): AccountModerationStatus {
  // A fresh object per call (matching the extracted code): callers may hold or
  // decorate the status, so a shared constant would alias across requests.
  if (!row) {
    return {
      locked: false,
      banned: false,
      suspendedUntil: null,
      reason: '',
      message: '',
      chatMutedUntil: null,
      chatStrikes: 0,
      generalChatRateLimit: null,
    };
  }
  const mutedUntilDate = row.chat_muted_until ? new Date(row.chat_muted_until) : null;
  const chatMutedUntil =
    mutedUntilDate && mutedUntilDate.getTime() > nowMs ? mutedUntilDate.toISOString() : null;
  const chatStrikes = Number(row.chat_strikes ?? 0);
  const generalChatRateLimit =
    row.messages === null || row.messages === undefined
      ? null
      : {
          messages: Number(row.messages),
          windowMinutes: Number(row.window_minutes),
        };
  // Admin-imposed states (ban, then active suspension) outrank a self-imposed
  // deactivation: a banned+deactivated account must still surface the ban reason
  // and label, not be relabelled "deactivated". All branches resolve to locked.
  if (row.banned_at) {
    return {
      locked: true,
      banned: true,
      suspendedUntil: null,
      reason: row.moderation_reason ?? '',
      message: 'This account has been banned.',
      chatMutedUntil,
      chatStrikes,
      generalChatRateLimit,
    };
  }
  const suspendedUntil = row.suspended_until ? new Date(row.suspended_until) : null;
  if (suspendedUntil && suspendedUntil.getTime() > nowMs) {
    return {
      locked: true,
      banned: false,
      suspendedUntil: suspendedUntil.toISOString(),
      reason: row.moderation_reason ?? '',
      message: `This account is suspended until ${suspendedUntil.toUTCString()}.`,
      chatMutedUntil,
      chatStrikes,
      generalChatRateLimit,
    };
  }
  // A self-deactivated account is locked out of login + WS auth (same gate as
  // banned/suspended) until an admin reactivates it.
  if (row.deactivated_at) {
    return {
      locked: true,
      banned: false,
      suspendedUntil: null,
      deactivated: true,
      reason: '',
      message: 'This account has been deactivated.',
      chatMutedUntil,
      chatStrikes,
      generalChatRateLimit,
    };
  }
  return {
    locked: false,
    banned: false,
    suspendedUntil: null,
    reason: '',
    message: '',
    chatMutedUntil,
    chatStrikes,
    generalChatRateLimit,
  };
}
