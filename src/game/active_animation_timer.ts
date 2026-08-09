export const ACTIVE_ANIMATION_WALL_CAP_MULTIPLIER = 3;
const MAX_ACTIVE_FRAME_STEP_MS = 50;

export interface ActiveAnimationScheduler {
  now(): number;
  requestFrame(callback: (now: number) => void): void;
}

const browserScheduler: ActiveAnimationScheduler = {
  now: () => performance.now(),
  requestFrame: (callback) => {
    requestAnimationFrame(callback);
  },
};

/**
 * Wait for active animation time while bounding the total wall-clock delay.
 * Frame deltas are capped so a throttled or restored tab does not count a long
 * hidden gap as animation time. The independent wall cap prevents a loading
 * curtain from remaining indefinitely when frames keep arriving too slowly.
 */
export function afterActiveAnimationMs(
  durationMs: number,
  callback: () => void,
  scheduler: ActiveAnimationScheduler = browserScheduler,
): void {
  const targetMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  if (targetMs === 0) {
    callback();
    return;
  }

  let activeMs = 0;
  const startedAt = scheduler.now();
  let previousAt = startedAt;
  const wallCapMs = targetMs * ACTIVE_ANIMATION_WALL_CAP_MULTIPLIER;
  const tick = (now: number): void => {
    activeMs += Math.min(MAX_ACTIVE_FRAME_STEP_MS, Math.max(0, now - previousAt));
    previousAt = now;
    if (activeMs >= targetMs || now - startedAt >= wallCapMs) {
      callback();
      return;
    }
    scheduler.requestFrame(tick);
  };
  scheduler.requestFrame(tick);
}
