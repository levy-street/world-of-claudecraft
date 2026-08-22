// Keep the packaged client inside the console's WebView2 memory budget.
//
// The client's graphics tier auto-detects from the GPU adapter, and a console
// reports a strong adapter, so detection lands on a tier sized for a desktop
// with several GB of headroom. The WebView2 render process on Xbox gets a far
// smaller budget, and that tier (plus devicePixelRatio-scaled backing buffers
// on a 4K TV) is what killed the render process in the field, surfacing as
// CoreWebView2 ProcessFailed with RenderProcessUnresponsive.
//
// Two levers, applied before any game script runs:
//
// 1. devicePixelRatio is pinned to 1. Every DPR-scaled canvas and backing
//    store shrinks fourfold on a 4K panel; at couch distance the difference is
//    not visible, and it is the single largest GPU-memory win available
//    without touching the client.
//
// 2. The persisted settings get a console floor: first run seeds the low
//    graphics preset at reduced render scale (and marks the device default
//    applied, so the client's own first-run detection does not raise it back
//    on a strong-looking adapter); later runs only CLAMP preset and render
//    scale down to the console ceiling, so a lower player choice is always
//    respected.
//
// Keys and ranges are src/game/settings.ts (graphicsPreset 1..6, renderScale
// 0.5..1, store key woc_settings). The client itself ships unmodified, same
// policy as gamepad-polyfill.js.
(() => {
  // biome-ignore lint/suspicious/noRedundantUseStrict: injected as a classic script, not a module
  'use strict';

  try {
    Object.defineProperty(window, 'devicePixelRatio', {
      get: () => 1,
      configurable: true,
    });
  } catch {
    // Leave the real DPR if the property refuses to be redefined.
  }

  const KEY = 'woc_settings';
  const PRESET_CEILING = 2;
  const SCALE_CEILING = 0.75;

  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      localStorage.setItem(
        KEY,
        JSON.stringify({ graphicsPreset: 1, renderScale: 0.75, graphicsDefaultApplied: true }),
      );
      return;
    }
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return;
    let dirty = false;
    if (typeof s.graphicsPreset === 'number' && s.graphicsPreset > PRESET_CEILING) {
      s.graphicsPreset = PRESET_CEILING;
      dirty = true;
    }
    if (typeof s.renderScale === 'number' && s.renderScale > SCALE_CEILING) {
      s.renderScale = SCALE_CEILING;
      dirty = true;
    }
    // The client's first-run device detection would raise the preset right back
    // on a strong-looking adapter; mark it applied so it never runs here.
    if (s.graphicsDefaultApplied !== true) {
      s.graphicsDefaultApplied = true;
      dirty = true;
    }
    if (dirty) localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Corrupt or unavailable storage: the client fills its own defaults.
  }
})();
