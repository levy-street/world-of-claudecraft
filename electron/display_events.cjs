'use strict';

// Pure, Node-testable helpers for the display reading the main process pushes to
// the renderer (tests/electron_display_events.test.ts). Only the scale factor
// and an opaque display id cross the boundary: Electron's Display object also
// carries bounds, work area, rotation, and a human label, none of which the page
// has any business seeing (window bounds are a separate, later contract).

// Chromium reports scale factors well inside this range. The clamp is not
// cosmetic: the renderer resolves its drawing-buffer size from this number, so
// an out-of-range reading would allocate an absurd framebuffer.
const MIN_SCALE_FACTOR = 0.25;
const MAX_SCALE_FACTOR = 10;

// Accept only a real, finite number. The shell reads these from Electron, but
// this reducer is the boundary, and a NaN would poison every later comparison
// (NaN !== NaN would make shouldForwardDisplayChange fire on every event).
function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Build the payload for one 'desktop-display-changed' IPC send.
function displayChangedPayload(display) {
  const rawScale = finiteNumber(display?.scaleFactor);
  const scaleFactor =
    rawScale !== null && rawScale > 0
      ? Math.min(Math.max(rawScale, MIN_SCALE_FACTOR), MAX_SCALE_FACTOR)
      : 1;
  const rawId = finiteNumber(display?.id);
  return { scaleFactor, displayId: rawId === null ? 0 : Math.trunc(rawId) };
}

// Both triggers fire for reasons that leave the reading unchanged: a window drag
// within one monitor, or another monitor's metrics changing. Forward only a real
// change, so the renderer never re-resolves its pixel ratio for noise.
function shouldForwardDisplayChange(prev, next) {
  if (prev == null) return true;
  return next.displayId !== prev.displayId || next.scaleFactor !== prev.scaleFactor;
}

// Narrow a reading to what actually crosses the bridge. The display identity is
// needed for the dedup above (two monitors at the same scale are still a move
// worth forwarding), but the renderer only ever re-resolves a pixel ratio from
// the scale factor, so the id stops here: it is a stable OS-derived identifier
// and the page has no use for one. The scale factor itself is no new capability,
// the page already reads window.devicePixelRatio. Re-runs the coercion so the
// bound holds even if a caller hands this a raw Display object.
function displayWirePayload(reading) {
  return { scaleFactor: displayChangedPayload(reading).scaleFactor };
}

module.exports = { displayChangedPayload, displayWirePayload, shouldForwardDisplayChange };
