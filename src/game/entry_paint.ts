// A hidden document may not receive animation frames. Entry may still build
// and prewarm its world while the tab is away; visible entry keeps the two-frame
// wait that lets the loading screen paint before synchronous scene work.

export interface EntryPaintScheduler {
  readonly hidden: boolean;
  addVisibilityListener(listener: () => void): void;
  removeVisibilityListener(listener: () => void): void;
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
}

const browserScheduler: EntryPaintScheduler = {
  get hidden() {
    return document.hidden;
  },
  addVisibilityListener: (listener) => document.addEventListener('visibilitychange', listener),
  removeVisibilityListener: (listener) =>
    document.removeEventListener('visibilitychange', listener),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (id) => cancelAnimationFrame(id),
};

export function waitForEntryPaint(
  scheduler: EntryPaintScheduler = browserScheduler,
): Promise<void> {
  if (scheduler.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    let frameId: number | null = null;
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (frameId !== null) scheduler.cancelFrame(frameId);
      scheduler.removeVisibilityListener(onVisibilityChange);
      resolve();
    };
    const onVisibilityChange = (): void => {
      if (scheduler.hidden) finish();
    };
    scheduler.addVisibilityListener(onVisibilityChange);
    // Close the gap between the initial hidden read and listener attach.
    if (scheduler.hidden) {
      finish();
      return;
    }
    frameId = scheduler.requestFrame(() => {
      frameId = scheduler.requestFrame(finish);
    });
  });
}
