// PURE rules for the touch HUD's unread-whisper badge (no DOM, no i18n).
//
// On touch the chat panel is closed most of the time, so a received whisper
// lands in a log nobody is looking at. These rules decide when one counts as
// unread and when the count clears; whisper_unread_badge.ts paints the result
// on the controls that open chat.
//
// Whispers ONLY, by design: General/World/Party traffic would keep a badge lit
// permanently, and a badge that is always lit says nothing.

import { type ChatTabId, WHISPER_TAB } from './chat_channels';

/** The highest count the badge prints as a number; above it the badge reads "9+". */
export const WHISPER_UNREAD_BADGE_CAP = 9;

export interface WhisperViewState {
  /** The touch HUD is active (body.mobile-touch). Desktop keeps its log on screen. */
  touch: boolean;
  /** The chat log is on screen: the open chat panel or the read-only log peek. */
  logVisible: boolean;
  /** The chat tab the log is filtered to. */
  activeTab: ChatTabId;
}

/** True while the player can already read an incoming whisper where it lands:
 *  the log is up on All (which shows every channel) or on the Whisper tab. */
export function whispersInView(view: WhisperViewState): boolean {
  return view.logVisible && (view.activeTab === 'all' || view.activeTab === WHISPER_TAB);
}

/** The unread count after one RECEIVED whisper (never the sender's own echo). */
export function whisperUnreadAfterReceive(count: number, view: WhisperViewState): number {
  if (!view.touch || whispersInView(view)) return 0;
  return count + 1;
}

/** The unread count after the view changed (chat opened or closed, tab switched,
 *  layout left touch): it clears once the whispers are in view, else it holds. */
export function whisperUnreadAfterViewChange(count: number, view: WhisperViewState): number {
  return !view.touch || whispersInView(view) ? 0 : count;
}

/** What the badge prints: null for no badge, else the number and whether it is
 *  the capped "9+" form. */
export function whisperUnreadBadge(count: number): { shown: number; overflow: boolean } | null {
  if (count <= 0) return null;
  return count > WHISPER_UNREAD_BADGE_CAP
    ? { shown: WHISPER_UNREAD_BADGE_CAP, overflow: true }
    : { shown: count, overflow: false };
}
