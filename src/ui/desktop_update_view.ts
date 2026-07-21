// Pure view-core for the desktop auto-update toast (DOM-free, Node-tested in
// tests/desktop_update_view.test.ts). The thin DOM consumer is
// src/ui/desktop_update_toast.ts; the events arrive from the Electron shell
// via the wocDesktop bridge (see DesktopUpdateEvent in src/runtime.ts).

import type { DesktopUpdateEvent } from '../runtime';

export interface UpdateToastState {
  mode: 'hidden' | 'downloading' | 'ready';
  version: string;
  dismissed: boolean;
}

export const INITIAL_UPDATE_TOAST_STATE: UpdateToastState = {
  mode: 'hidden',
  version: '',
  dismissed: false,
};

// Fold one shell event into the toast state. Rules:
//  - 'available' announces the download (unless the player already dismissed
//    this session, or an update is already fully downloaded).
//  - 'progress' never changes what is shown (the main process throttles it;
//    the toast stays a calm one-liner, not a progress bar).
//  - 'downloaded' always wins and re-surfaces even after a dismissal: it is
//    the one state with a player action attached (restart now).
export function reduceUpdateToast(
  state: UpdateToastState,
  event: DesktopUpdateEvent,
): UpdateToastState {
  if (event.type === 'downloaded') {
    return { mode: 'ready', version: event.version || state.version, dismissed: false };
  }
  if (state.mode === 'ready') return state;
  if (event.type === 'available') {
    if (state.dismissed) return state;
    return { ...state, mode: 'downloading', version: event.version || '' };
  }
  return state;
}

// The player closed the toast. A 'downloading' dismissal also suppresses any
// later re-'available' chatter this session; 'downloaded' re-surfaces anyway.
export function dismissUpdateToast(state: UpdateToastState): UpdateToastState {
  return { ...state, mode: 'hidden', dismissed: true };
}
