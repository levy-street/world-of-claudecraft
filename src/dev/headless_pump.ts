// Headless frame pump for automated verification (dev server only).
//
// WHY THIS EXISTS. The agent-driven browser pane renders the page offscreen, so
// `document.visibilityState` is 'hidden' for the whole session. Chrome then
// throttles `requestAnimationFrame` to a crawl and never fires
// `requestIdleCallback` at all, and the renderer's shader prewarm
// (renderer.ts prewarmInitialScene -> runEntry) waits on exactly those two, so
// world entry hangs on "Entering the world..." forever. Nothing is wrong with
// the game; the tab simply never gets a frame budget.
//
// The fix is a clock the browser does not throttle: a dedicated Worker posting
// a message every 16 ms. Both callbacks are re-pointed at that clock, so the
// page runs at a real ~60 Hz while offscreen and a screenshot shows the actual
// scene.
//
// Import it from a dedicated entry (play-headless.html) so it is installed
// BEFORE any game module runs, patching after boot is too late, the prewarm's
// first idle callback is already lost. It is never part of the normal
// index.html entry and is compiled out of production by the import.meta.env.DEV
// guard below.

export function installHeadlessPump(): void {
  if (!import.meta.env.DEV) return;
  const w = window as typeof window & { __dgPump?: { frames: number } };
  if (w.__dgPump) return;

  const raf: FrameRequestCallback[] = [];
  const idle: IdleRequestCallback[] = [];
  // Short timers land here too. The prewarm loop yields between entries with
  // `setTimeout(resolve, 0)`, and a hidden tab clamps that to ~1s (and worse
  // under intensive throttling), which alone stretches world entry past any
  // sane wait. Only near-zero delays are redirected; real timers keep their
  // real semantics.
  const soon: Array<() => void> = [];
  const SOON_MS = 20;
  const state = { frames: 0 };
  w.__dgPump = state;

  window.requestAnimationFrame = (cb: FrameRequestCallback): number => raf.push(cb);
  window.cancelAnimationFrame = (): void => {};
  window.requestIdleCallback = ((cb: IdleRequestCallback): number =>
    idle.push(cb)) as typeof window.requestIdleCallback;
  window.cancelIdleCallback = ((): void => {}) as typeof window.cancelIdleCallback;

  const nativeSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    if (typeof handler === 'function' && (timeout ?? 0) <= SOON_MS) {
      soon.push(() => (handler as (...a: unknown[]) => void)(...args));
      return 0;
    }
    return nativeSetTimeout(handler as TimerHandler, timeout, ...args);
  }) as typeof window.setTimeout;

  const src = 'setInterval(function(){postMessage(0)},16)';
  const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  worker.onmessage = (): void => {
    const now = performance.now();
    for (const fn of soon.splice(0, soon.length)) {
      try {
        fn();
      } catch (err) {
        console.error('[headless-pump] deferred timer threw', err);
      }
    }
    for (const cb of raf.splice(0, raf.length)) {
      try {
        cb(now);
        state.frames++;
      } catch (err) {
        console.error('[headless-pump] rAF callback threw', err);
      }
    }
    // Idle work gets whatever is left of a nominal frame. The deadline is a
    // fixed slice rather than a real measurement: the prewarm only uses it to
    // decide how much to chew per pass, and a steady slice keeps it moving.
    const deadline: IdleDeadline = { didTimeout: false, timeRemaining: () => 8 };
    for (const cb of idle.splice(0, idle.length)) {
      try {
        cb(deadline);
      } catch (err) {
        console.error('[headless-pump] idle callback threw', err);
      }
    }
  };
  console.info('[headless-pump] worker clock installed (offscreen verification mode)');
}
