// There is no direct "is the on-screen keyboard open" API, but visualViewport
// shrinks to the space left above it while window.innerHeight (the layout
// viewport main.ts pins #ui to via app_viewport.ts) stays the full screen size.
// Comparing the two is the standard keyboard-open signal; wired from main.ts's
// visualViewport 'resize' listener (issue 1577 (5): reposition mobile chat
// above the keyboard instead of letting it cover the composer).
const KEYBOARD_HEIGHT_RATIO = 0.75;

export interface KeyboardViewportState {
  /** True when the visible viewport is meaningfully shorter than the full
   *  window height, the signal an on-screen keyboard is covering the rest. */
  open: boolean;
  /** The visible height above the keyboard (or the full height when closed),
   *  rounded to a whole CSS pixel. */
  visibleHeight: number;
}

export function keyboardViewportState(
  windowInnerHeight: number,
  visualViewportHeight: number,
): KeyboardViewportState {
  const open =
    windowInnerHeight > 0 && visualViewportHeight < windowInnerHeight * KEYBOARD_HEIGHT_RATIO;
  return { open, visibleHeight: Math.max(1, Math.round(visualViewportHeight)) };
}
