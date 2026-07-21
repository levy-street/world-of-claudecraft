// Desktop auto-update toast: a small shell-level, non-blocking notice that
// works both on the pre-game shell and in-world (it owns its fixed-position
// element on document.body; styles in src/styles/shell.css "desktop update
// toast" section). State transitions live in the pure view-core
// (src/ui/desktop_update_view.ts); this module is the thin DOM consumer.
//
// UX: 'available' shows a transient "downloading" line; 'downloaded' shows the
// persistent restart affordance (Restart now / Later). If the player picks
// Later (or never answers), the update still installs on quit
// (autoInstallOnAppQuit in electron/updater.cjs).

import type { DesktopBridge, DesktopUpdateEvent } from '../runtime';
import {
  dismissUpdateToast,
  INITIAL_UPDATE_TOAST_STATE,
  reduceUpdateToast,
  type UpdateToastState,
} from './desktop_update_view';
import { t } from './i18n';

export function initDesktopUpdateToast(bridge: DesktopBridge): void {
  if (typeof bridge.onUpdateEvent !== 'function') return;

  let state: UpdateToastState = INITIAL_UPDATE_TOAST_STATE;
  let root: HTMLDivElement | null = null;
  let message: HTMLSpanElement | null = null;
  let restartButton: HTMLButtonElement | null = null;
  let laterButton: HTMLButtonElement | null = null;

  const ensureDom = (): void => {
    if (root) return;
    root = document.createElement('div');
    root.id = 'desktop-update-toast';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.hidden = true;
    message = document.createElement('span');
    message.className = 'desktop-update-message';
    restartButton = document.createElement('button');
    restartButton.type = 'button';
    restartButton.className = 'desktop-update-restart';
    restartButton.addEventListener('click', () => {
      void bridge.installUpdate?.();
    });
    laterButton = document.createElement('button');
    laterButton.type = 'button';
    laterButton.className = 'desktop-update-later';
    laterButton.addEventListener('click', () => {
      state = dismissUpdateToast(state);
      render();
    });
    root.append(message, restartButton, laterButton);
    document.body.appendChild(root);
  };

  const render = (): void => {
    if (state.mode === 'hidden') {
      if (root) root.hidden = true;
      return;
    }
    ensureDom();
    if (!root || !message || !restartButton || !laterButton) return;
    root.hidden = false;
    const version = state.version;
    if (state.mode === 'downloading') {
      message.textContent = t('desktop.update.downloading', { version });
      restartButton.hidden = true;
      laterButton.hidden = true;
    } else {
      message.textContent = t('desktop.update.ready', { version });
      restartButton.textContent = t('desktop.update.restart');
      restartButton.hidden = false;
      laterButton.textContent = t('desktop.update.later');
      laterButton.hidden = false;
    }
  };

  bridge.onUpdateEvent((event: DesktopUpdateEvent) => {
    state = reduceUpdateToast(state, event);
    render();
  });

  // Locale flips re-render whatever is currently shown (the language selector
  // dispatches this on both the shell and the in-game options path).
  document.addEventListener('woc:languagechange', render);
}
