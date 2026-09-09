// Dev-channel build-phase telemetry for the Renderer constructor (English,
// console.info, Release-silent), lifted out of renderer.ts so the coordinator
// carries the phase MARKS and not the closure that stamps them.
//
// The iPhone 17 Pro WebContent kill lands INSIDE that constructor, after every
// preload completes, so localizing which build phase tips the memory ceiling
// requires a marker between phases. Wall-clock only, no allocation. Every
// segment also stamps a 'woc:load:renderer-ctor/<phase>' measure for the boot
// profiler (window.__loadProfile), unconditionally: marks are cheap and the
// profiler needs them on production-class devices too.

import { GFX } from './gfx';
import { renderLoadMeasure } from './load_marks';

/** Open a build-diag run; the returned function closes one phase and opens the
 *  next. `now` is injected so a test can drive it without a wall clock. */
export function createRendererBuildDiag(
  now: () => number = () => performance.now(),
): (phase: string) => void {
  const start = now();
  let last = start;
  return (phase: string): void => {
    const at = now();
    renderLoadMeasure(`renderer-ctor/${phase}`, last, at);
    // Gated like [load-diag] and the residency table: dev browsers plus the
    // iOS WebKit profile under diagnosis, never the production web console.
    if (import.meta.env.DEV || GFX.iosMemoryProfile) {
      console.info(
        `[build-diag] ${phase} +${(at - last).toFixed(0)}ms (total ${(at - start).toFixed(0)}ms)`,
      );
    }
    last = at;
  };
}
