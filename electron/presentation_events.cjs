'use strict';

// Pure, Node-testable helper for the window presentation state the main process
// pushes to the renderer (tests/electron_presentation_events.test.ts). The push
// exists because the page itself can never see this: the game window is created
// with backgroundThrottling:false, which keeps document.visibilityState at
// 'visible' even while the window is minimized or hidden, so the main process's
// window events are the only source of truth for hidden-ness.

// Build the payload for one 'desktop-presentation-changed' IPC send. Coerced
// strictly: a truthy non-boolean must never reach the renderer as a hidden
// verdict, because the renderer parks work on it.
function presentationStatePayload(hidden) {
  return { hidden: hidden === true };
}

module.exports = { presentationStatePayload };
