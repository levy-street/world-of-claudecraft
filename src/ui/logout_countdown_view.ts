// Pure presentation mapping for the Log Out countdown. The server owns the
// countdown and sends structured `logout` events (src/sim/types.ts LogoutEvent,
// server/logout_timer.ts), one a second while it runs; this leaf decides what
// the HUD does with each one and which localized line it shows, without
// touching the DOM or a clock.

import type { LogoutEvent } from '../sim/types';
import type { TranslationKey } from './i18n.catalog';

/** The plural family of the countdown line ("Logging out in {count} seconds"). */
export const LOGOUT_COUNTDOWN_PLURAL = 'hudChrome.plurals.logoutCountdown';

export type LogoutCountdownAction =
  /** Put the countdown on screen, or move it on, with this many seconds to go.
   *  `announce` marks the beat that opens (or lengthens) the wait: the one a
   *  player who cannot see the prompt has to be told about. */
  | { kind: 'show'; seconds: number; announce: boolean }
  /** Take the countdown down; `errorKey` is the line to tell the player, if any. */
  | { kind: 'hide'; errorKey: TranslationKey | null };

export function logoutCountdownAction(event: LogoutEvent): LogoutCountdownAction {
  if (event.phase === 'started') return { kind: 'show', seconds: event.seconds, announce: true };
  if (event.phase === 'countdown') {
    return { kind: 'show', seconds: event.seconds, announce: false };
  }
  if (event.phase === 'completed') return { kind: 'hide', errorKey: null };
  // The player pressed Cancel, or the connection dropped (the reconnect overlay
  // already says so): only an interruption they did not choose needs a line.
  return {
    kind: 'hide',
    errorKey: event.reason === 'damaged' ? 'hudChrome.logout.interrupted' : null,
  };
}
