// Stateful half of the loading-screen "slow connection" hint: arms a 1s
// interval that watches how long progress has gone quiet and toggles
// `#ls-slow-hint` via shouldShowSlowConnectionHint (loading_slow_hint_core.ts).
//
// Only watches the network-bound phase: noteLoadingProgress is fed solely by
// the asset-fetch progress callback, so the watch is stopped as soon as
// assets finish (stopSlowConnectionWatch) rather than left armed through the
// CPU-bound scene-build stretch that follows (mountGameUi, prewarmInitialScene,
// two rAFs to first frame), which can exceed the threshold on a slow device
// with a perfectly fine connection and would misattribute the stall.

import { shouldShowSlowConnectionHint } from './loading_slow_hint_core';

const SLOW_HINT_CHECK_MS = 1000;

let slowHintTimer: number | null = null;
let lastProgressAt = 0;

// index.html AND play.html both load the module that calls this, but the
// element only exists as inline markup on both entries; still null-guarded to
// survive any future entry drift without throwing on this frequently-hit
// interval path.
function setSlowConnectionHintVisible(visible: boolean): void {
  document.querySelector('#ls-slow-hint')?.classList.toggle('visible', visible);
}

export function startSlowConnectionWatch(): void {
  lastProgressAt = Date.now();
  if (slowHintTimer !== null) return;
  slowHintTimer = window.setInterval(() => {
    setSlowConnectionHintVisible(shouldShowSlowConnectionHint(Date.now() - lastProgressAt));
  }, SLOW_HINT_CHECK_MS);
}

export function stopSlowConnectionWatch(): void {
  if (slowHintTimer !== null) {
    window.clearInterval(slowHintTimer);
    slowHintTimer = null;
  }
  setSlowConnectionHintVisible(false);
}

// Called on each real progress tick (asset done/total advancing): resets the
// quiet-timer and clears any hint already shown, since progress just moved.
export function noteLoadingProgress(): void {
  lastProgressAt = Date.now();
  setSlowConnectionHintVisible(false);
}
