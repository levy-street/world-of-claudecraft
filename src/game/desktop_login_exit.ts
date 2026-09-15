// Owns the desktop-only pre-game Exit Game control. The HTML starts
// hidden, and this module reveals it only when a current shell exposes both
// narrow capabilities and reports the stored borderless display mode.

import type { DesktopBridge } from '../runtime';
import { DESKTOP_LOGIN_EXIT_SHOWN_CLASS } from '../ui/root_state_classes';

interface DesktopLoginExitButton {
  hidden: boolean;
  addEventListener(type: 'click', listener: () => void): void;
  removeEventListener(type: 'click', listener: () => void): void;
}

interface DesktopLoginExitRoot {
  querySelector(selector: '#desktop-login-exit'): DesktopLoginExitButton | null;
  /** The homepage header re-flows around the revealed button through a body
   *  class (shell.css), stamped here with the reveal. */
  readonly body?: { classList: { toggle(token: string, force: boolean): boolean } } | null;
}

export function initDesktopLoginExit(
  bridge: DesktopBridge,
  root: DesktopLoginExitRoot = document,
): () => void {
  const button = root.querySelector('#desktop-login-exit');
  if (!button) return () => {};
  const setShown = (shown: boolean): void => {
    button.hidden = !shown;
    root.body?.classList.toggle(DESKTOP_LOGIN_EXIT_SHOWN_CLASS, shown);
  };
  setShown(false);

  const getDisplayMode = bridge.getDisplayMode;
  const quitApp = bridge.quitApp;
  if (typeof getDisplayMode !== 'function' || typeof quitApp !== 'function') return () => {};

  let disposed = false;
  const onClick = (): void => {
    try {
      Promise.resolve(quitApp.call(bridge)).catch(() => {});
    } catch {}
  };
  button.addEventListener('click', onClick);

  try {
    Promise.resolve(getDisplayMode.call(bridge)).then(
      (mode) => {
        if (!disposed && mode === 'borderless') setShown(true);
      },
      () => {},
    );
  } catch {}

  return () => {
    disposed = true;
    button.removeEventListener('click', onClick);
    setShown(false);
  };
}
