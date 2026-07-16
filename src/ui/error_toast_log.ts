// Pure helper for mirroring center-screen error toasts (showError in hud.ts,
// e.g. "You cannot do that", "Out of range") into the chat log, so the message
// does not just vanish after its 1.6s fade. No DOM/Three deps: the actual
// append happens through hud.ts's existing log() (which already tags the
// 'system' chan reused by loot/level-up/death lines and everything else that
// belongs in the combined chat view), this module only decides WHETHER a given
// toast is worth mirroring and WHAT color to mirror it with.

// Reuses the same red used for other danger/system lines (e.g. player death)
// so the mirrored line reads consistently with the rest of the system channel.
export const ERROR_LOG_COLOR = '#ff4444';

// The chan tag hud.ts's log() already defaults to; kept here as a named
// re-export so callers do not have to hardcode the string 'system' twice.
export const ERROR_LOG_CHAN = 'system';

// Guards against mirroring a blank/whitespace-only toast (defensive: showError
// is never called with empty text today, but an empty chat line would still be
// a visible, confusing no-op entry if that ever changed), and against mirroring
// the same text twice in a row. Without the latter, mashing a key or
// click-spamming an action button while an error condition persists (out of
// range, ability on cooldown, not enough mana) appends one duplicate chat line
// per attempt, flooding the shared system channel and pushing real history
// (loot, level-ups, deaths) out of view. Only the LAST mirrored text is
// tracked (not a longer history), so a burst of the same error still collapses
// to a single line, matching the on-screen toast's own clearTimeout-based
// collapsing, while a different error in between still logs normally.
export function shouldMirrorErrorToast(text: string, lastMirrored: string | undefined): boolean {
  return text.trim().length > 0 && text !== lastMirrored;
}
