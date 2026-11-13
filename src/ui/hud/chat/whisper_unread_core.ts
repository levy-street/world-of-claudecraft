// PURE print rule for the touch HUD's unread-whisper badge (no DOM, no i18n).
//
// On touch the chat panel is closed most of the time, so a received whisper
// lands in a log nobody is looking at. whisper_unread_badge.ts paints a count
// on the controls that open chat. The COUNT itself (what counts as unread and
// when it clears) is the counter in chat_unread_core.ts; this file only decides
// what the badge prints.

/** The highest count the badge prints as a number; above it the badge reads "9+". */
export const WHISPER_UNREAD_BADGE_CAP = 9;

/** What the badge prints: null for no badge, else the number and whether it is
 *  the capped "9+" form. */
export function whisperUnreadBadge(count: number): { shown: number; overflow: boolean } | null {
  if (count <= 0) return null;
  return count > WHISPER_UNREAD_BADGE_CAP
    ? { shown: WHISPER_UNREAD_BADGE_CAP, overflow: true }
    : { shown: count, overflow: false };
}
