// The bank does not trap Tab, so its docked bags companion stays reachable; it
// records the opener and returns focus there on close (WCAG 2.4.3). The weekly
// rewards sheet that used to trap Tab inside this root is the Rewards hub's
// Vault tab now, with its own window and focus bridge.
import type { FocusManager } from './focus_manager';
import { makeWindowFocus, type WindowFocusBridge } from './window_focus';
export function makeBankWindowFocus(fm: FocusManager, root: () => HTMLElement): WindowFocusBridge {
  const bridge = makeWindowFocus(fm, root);
  return {
    captureFocus: () => fm.activeFocusable(),
    restoreFocus: bridge.restoreFocus,
  };
}
