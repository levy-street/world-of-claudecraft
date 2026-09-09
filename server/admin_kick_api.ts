// The admin-panel kick's server-side REST contract: the typed request schema,
// the reason normalizer, the stable error codes the route refuses with, and the
// disconnect message the kicked client receives. Host-agnostic leaf: no db, no
// res, no HTTP server, so a Vitest drives it directly and the admin coordinator
// (server/admin.ts adminKickHandler) stays a thin consumer. Same shape as
// server/cheater_mark_api.ts, the registry-only admin route precedent.
//
// The kick is the in-game `/kick` (server/moderation_service.ts) reached from the
// dashboard: it writes the SAME moderation-history row (action 'kick', actor =
// the operator, reason recorded) through moderation_db.recordInGameAction, then
// tears the live session down through the injected AdminRuntime.disconnectAccount.
// Nothing here touches account state; a kick is a live-session effect only.

import type { ErrorCode } from './http/error_codes';
import { type Infer, object, str } from './http/schema';

/**
 * The reason ceiling, mirroring moderation_db's ACTION_REASON_MAX so the wire
 * refuses what the audit write would otherwise silently truncate. The admin
 * prompt's input carries the same maxlength.
 */
export const ADMIN_KICK_REASON_MAX = 500;

/**
 * POST /admin/api/moderation/accounts/:id/kick body. SHAPE plus the length
 * ceiling only: a wrong-typed or missing reason is a 422 validation.failed from
 * the pipeline; a blank one (whitespace) is the coded refusal below, raised by
 * the route after normalizeAdminKickReason.
 */
export const adminKickBodySchema = object({
  reason: str({ maxLength: ADMIN_KICK_REASON_MAX }),
});
export type AdminKickBody = Infer<typeof adminKickBodySchema>;

/**
 * Trim the operator's reason; null when nothing is left. The audit write
 * (recordInGameAction) trims the same way and refuses an empty reason with a
 * prose Error, so the route decides BEFORE the write and answers with a code.
 */
export function normalizeAdminKickReason(raw: string): string | null {
  const reason = raw.trim();
  return reason.length > 0 ? reason : null;
}

/** The audited reason was blank after trimming (400). */
export const KICK_REASON_REQUIRED_CODE: ErrorCode = 'kick.reason_required';

/**
 * The target is an operator account (400). Mirrors the in-game `/kick`, which
 * refuses a staff target ("You can't moderate that player"), and the
 * isAdminAccount guards on suspend/ban/chat-mute: an operator must not be able
 * to drop another operator's session, deliberately or by mistyping an id.
 */
export const KICK_ADMIN_TARGET_CODE: ErrorCode = 'kick.admin_target';

/**
 * The account has no live session on this realm process (409). The roster the
 * operator clicked in is a snapshot; a player who logged out between page load
 * and click lands here, and the route answers BEFORE writing the audit row, so
 * moderation history never claims a disconnect that did not happen (the
 * restore-item ordering, server/admin.ts restoreItemHandler).
 */
export const KICK_TARGET_OFFLINE_CODE: ErrorCode = 'kick.target_offline';

/**
 * The disconnect reason the kicked client is sent, in the same family as the
 * moderation kick literals (server/admin.ts IP_BLOCK_KICK_MESSAGE, the suspend
 * and ban lines in server/moderation_service.ts). BYTE-EXACT wire contract with
 * the client matcher (src/ui/api_error_i18n.ts), which recognizes the prefix
 * and re-localizes the line with the operator's reason interpolated; change
 * one and the other in the same commit (pinned by tests/main_api_error.test.ts).
 */
export const ADMIN_KICK_MESSAGE_PREFIX = 'A moderator has disconnected you: ';

/** The full disconnect line for a normalized reason. */
export function adminKickMessage(reason: string): string {
  return `${ADMIN_KICK_MESSAGE_PREFIX}${reason}`;
}
