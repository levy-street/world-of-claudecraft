// Device-pixel-ratio watch. There is no resize event when a window moves to a
// display with a different scale factor and the CSS viewport size happens to
// stay the same, so the backing store keeps the old ratio and the frame renders
// soft or aliased until something else forces a resize.
//
// The only portable signal is a resolution media query, which matches exactly
// one ratio: it has to be re-armed at the new ratio every time it fires.

// Once per session, not per watcher: every watcher on such a host hits the
// same dead arm, and one line on the dev channel names the degrade.
let warnedLegacyMatchMedia = false;

function warnLegacyMatchMediaOnce(): void {
  if (warnedLegacyMatchMedia) return;
  warnedLegacyMatchMedia = true;
  console.warn(
    'dpr_watch: matchMedia has no addEventListener (legacy addListener-only host); DPR changes will not be watched',
  );
}

/**
 * Call onChange whenever window.devicePixelRatio changes. Returns the
 * unsubscribe hook, or a no-op where matchMedia is missing (older embedded
 * webviews, and test environments that do not implement it).
 */
export function watchDevicePixelRatio(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  let armed: MediaQueryList | null = null;
  let stopped = false;

  function arm(): void {
    if (stopped) return;
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    if (typeof query.addEventListener !== 'function') {
      // Degrade-only contract, made visible: a MediaQueryList with only the
      // legacy addListener API (pre-2020 WebKit) gets no watch, and the caller
      // keeps a working-looking no-op unsubscribe. Pre-watch behavior was no
      // DPR tracking at all, and the Electron 43 shell always has
      // addEventListener, so a legacy fallback path is not worth carrying;
      // the one-time warn is so the dead arm cannot pass for a live watch.
      warnLegacyMatchMediaOnce();
      return;
    }
    armed = query;
    query.addEventListener('change', handle, { once: true });
  }

  function handle(): void {
    if (stopped) return;
    // Re-arm at the new ratio BEFORE notifying: the listener is a one-shot, so
    // a throw out of onChange would otherwise end the watch for the session.
    armed = null;
    arm();
    onChange();
  }

  arm();
  return () => {
    stopped = true;
    armed?.removeEventListener('change', handle);
    armed = null;
  };
}
