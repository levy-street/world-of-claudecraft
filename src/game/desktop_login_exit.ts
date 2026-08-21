// Owns the desktop-only pre-game Exit to Desktop control. The HTML starts
// hidden, and this module reveals it only when a current shell exposes both
// narrow capabilities and reports the stored borderless display mode.

import type { DesktopBridge } from '../runtime';

interface DesktopLoginExitButton {
  hidden: boolean;
  addEventListener(type: 'click', listener: () => void): void;
  removeEventListener(type: 'click', listener: () => void): void;
}

interface DesktopLoginExitRoot {
  querySelector(selector: '#desktop-login-exit'): DesktopLoginExitButton | null;
}

export function initDesktopLoginExit(
  bridge: DesktopBridge,
  root: DesktopLoginExitRoot = document,
): () => void {
  const button = root.querySelector('#desktop-login-exit');
  if (!button) return () => {};
  button.hidden = true;

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
        if (!disposed && mode === 'borderless') button.hidden = false;
      },
      () => {},
    );
  } catch {}

  return () => {
    disposed = true;
    button.removeEventListener('click', onClick);
    button.hidden = true;
  };
}
