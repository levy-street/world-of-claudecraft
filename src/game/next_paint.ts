// Wait until the browser has actually painted (the entry's and the
// arrivals' loading screen before a synchronous build freezes the main
// thread). Two animation frames guarantee a paint happened between them.
//
// A browser draws no frames for a hidden page: a minimized window, or one
// fully covered by another (Chromium's native window occlusion marks it
// hidden). A wait on frames alone then never ended, and the world entry sat
// on "Entering the world..." before any of the scene was built, for as long
// as the window stayed hidden (five minutes and more on the Smith's Heart
// night of 2026-11-20, until the window was brought forward). A hidden page
// has nothing to paint, so the wait checks, every NEXT_PAINT_HIDDEN_CHECK_MS,
// whether the page is hidden and goes on if so. A visible page keeps waiting
// for its frames however slow they are, exactly as before.

/** How often a wait with no frames yet asks whether the page is hidden. */
export const NEXT_PAINT_HIDDEN_CHECK_MS = 500;

export interface PaintScheduler {
  requestFrame(callback: () => void): void;
  setTimer(callback: () => void, ms: number): void;
  pageHidden(): boolean;
}

const browserPaintScheduler: PaintScheduler = {
  requestFrame: (callback) => {
    requestAnimationFrame(() => callback());
  },
  setTimer: (callback, ms) => {
    setTimeout(callback, ms);
  },
  pageHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
};

export function nextPaint(scheduler: PaintScheduler = browserPaintScheduler): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    scheduler.requestFrame(() => scheduler.requestFrame(finish));
    const check = (): void => {
      if (done) return;
      if (scheduler.pageHidden()) finish();
      else scheduler.setTimer(check, NEXT_PAINT_HIDDEN_CHECK_MS);
    };
    scheduler.setTimer(check, NEXT_PAINT_HIDDEN_CHECK_MS);
  });
}
