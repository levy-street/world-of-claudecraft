// Consumes the desktop shell's presentation state. With backgroundThrottling
// disabled the Page Visibility API stays 'visible' even while the window is
// minimized or hidden, so document.hidden never flips in the shell and the only
// truthful hidden signal is the main process pushing it over the bridge.
//
// Lives in src/game so main.ts stays a firewall: the frame loop reads the latch
// through desktopPresentationHidden() and feeds it to the presentation gate.

import type { DesktopBridge, DesktopPresentationState } from '../runtime';

// Whether the shell last reported the window as hidden. False until the shell
// says otherwise, so the web build and any older shell keep every frame whole.
let hidden = false;

/**
 * Subscribe to the shell's presentation pushes. Returns the unsubscribe hook, or
 * a no-op on a bridge without onPresentationChanged (older shell, or a plain
 * browser), which leaves the latch false and behavior unchanged.
 */
export function initDesktopPresentation(bridge: DesktopBridge): () => void {
  hidden = false;
  const subscribe = bridge.onPresentationChanged;
  if (typeof subscribe !== 'function') return () => {};
  return subscribe.call(bridge, (raw: DesktopPresentationState) => {
    // The shell is a separate, independently updated binary: a payload that is
    // not an object carrying a strict boolean is dropped whole rather than
    // coerced, because coercing it would strand the client in the wrong state
    // (a truthy non-boolean would stop rendering a window the player is using).
    if (!raw || typeof raw !== 'object') return;
    const candidate = raw as Partial<DesktopPresentationState>;
    if (typeof candidate.hidden !== 'boolean') return;
    hidden = candidate.hidden;
  });
}

/**
 * Whether the desktop window is currently hidden. Sampled at check time (once
 * per frame), never cached by the caller, so a flip lands on the next frame.
 */
export function desktopPresentationHidden(): boolean {
  return hidden;
}
