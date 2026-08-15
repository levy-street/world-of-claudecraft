// Pure view-core for the desktop auto-update card (DOM-free, Node-tested in
// tests/desktop_update_view.test.ts). The thin DOM consumer is
// src/ui/desktop_update_toast.ts; the events arrive from the Electron shell
// via the wocDesktop bridge (see DesktopUpdateEvent in src/runtime.ts).

import type { DesktopUpdateEvent } from '../runtime';

export interface UpdateToastState {
  mode: 'hidden' | 'checking' | 'uptodate' | 'downloading' | 'ready';
  version: string;
  // Download completion 0..100; meaningful while mode === 'downloading'.
  percent: number;
  dismissed: boolean;
  // Whether a 'checking' event was seen this session: only the FIRST check (the
  // launch one, where the player should learn the client auto-updates) shows
  // the card; the 4-hour rechecks stay silent unless they find an update.
  checkedOnce: boolean;
}

export const INITIAL_UPDATE_TOAST_STATE: UpdateToastState = {
  mode: 'hidden',
  version: '',
  percent: 0,
  dismissed: false,
  checkedOnce: false,
};

// Fold one shell event into the card state. Rules:
//  - 'checking' surfaces the card only for the session's first check (unless
//    the player already dismissed the card this session).
//  - 'available' announces the download (unless the player already dismissed
//    this session, or an update is already fully downloaded).
//  - 'progress' advances the download bar while downloading.
//  - 'not-available' resolves a visible check into a short "up to date"
//    confirmation (the consumer auto-hides it); silent rechecks stay silent.
//  - 'error' clears a checking/downloading card (a failed check or download is
//    never user-facing text; the shell logs it and retries on schedule).
//  - 'downloaded' always wins and re-surfaces even after a dismissal: it is
//    the one state with a player action attached (restart now).
export function reduceUpdateToast(
  state: UpdateToastState,
  event: DesktopUpdateEvent,
): UpdateToastState {
  if (event.type === 'downloaded') {
    return {
      ...state,
      mode: 'ready',
      version: event.version || state.version,
      percent: 100,
      dismissed: false,
    };
  }
  if (state.mode === 'ready') return state;
  if (event.type === 'checking') {
    if (state.checkedOnce || state.dismissed) return { ...state, checkedOnce: true };
    return { ...state, mode: 'checking', checkedOnce: true };
  }
  if (event.type === 'available') {
    if (state.dismissed) return state;
    // A recheck can re-emit 'available' while a download is already running.
    // Keep the live percent so the bar does not flash back to zero.
    if (state.mode === 'downloading') {
      return { ...state, version: event.version || state.version };
    }
    return { ...state, mode: 'downloading', version: event.version || '', percent: 0 };
  }
  if (event.type === 'progress') {
    if (state.mode !== 'downloading' || !Number.isFinite(event.percent)) return state;
    const next = Math.max(0, Math.min(100, Math.round(event.percent as number)));
    // Monotonic: never let a lower sample or a re-ordered IPC tick pull the bar
    // backward mid-download.
    const percent = Math.max(state.percent, next);
    return percent === state.percent ? state : { ...state, percent };
  }
  if (event.type === 'not-available') {
    return state.mode === 'checking' ? { ...state, mode: 'uptodate' } : state;
  }
  if (event.type === 'error') {
    return state.mode === 'checking' || state.mode === 'downloading'
      ? { ...state, mode: 'hidden' }
      : state;
  }
  return state;
}

// The player closed the card. Dismissing an ACTIONABLE card (downloading, or
// ready via Later) also suppresses later re-'available' chatter this session;
// swatting the informational checking/up-to-date card must not cost the
// player the download notice, so those only hide. 'downloaded' re-surfaces
// past the suppression anyway: it is the one state with an action attached.
export function dismissUpdateToast(state: UpdateToastState): UpdateToastState {
  const suppress = state.mode === 'downloading' || state.mode === 'ready';
  return { ...state, mode: 'hidden', dismissed: suppress ? true : state.dismissed };
}

// The consumer's auto-hide timer for the "up to date" confirmation expired
// (the clock lives in the DOM consumer; this core stays pure). Not a player
// dismissal, so it never sets the suppression flag.
export function expireUpToDateToast(state: UpdateToastState): UpdateToastState {
  return state.mode === 'uptodate' ? { ...state, mode: 'hidden' } : state;
}
