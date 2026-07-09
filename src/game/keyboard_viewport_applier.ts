// Thin DOM applier for the pure keyboard_viewport.ts core: reads the real
// window/visualViewport heights and writes the mobile-keyboard-open body class
// plus the --mobile-keyboard-visible-vh CSS var that hud.mobile.css uses to
// recenter the mobile chat window/input above an open on-screen keyboard
// (issue 1577 (5)). No decision logic lives here.
import { keyboardViewportState } from './keyboard_viewport';
import { useTouchInterface } from './mobile_controls';

const KEYBOARD_OPEN_CLASS = 'mobile-keyboard-open';

export function applyMobileKeyboardViewport(win: Window = window): void {
  const doc = win.document;
  const vv = win.visualViewport;
  if (!useTouchInterface(win) || !vv) {
    doc.body.classList.remove(KEYBOARD_OPEN_CLASS);
    return;
  }
  const state = keyboardViewportState(win.innerHeight, vv.height);
  doc.body.classList.toggle(KEYBOARD_OPEN_CLASS, state.open);
  doc.body.style.setProperty('--mobile-keyboard-visible-vh', `${state.visibleHeight}px`);
}
