// The one decision point for "what may this frame skip". The desktop shell can
// be hidden or minimized while the page still believes it is visible
// (backgroundThrottling is off, so the Page Visibility API never flips), which
// is why the hidden signal is an input here rather than a document read.
//
// Pure and DOM-free so the truth table is unit-testable; main.ts only consumes
// the decision.

export interface PresentationGateInput {
  /** Hidden per the page OR per the desktop shell's push. */
  hidden: boolean;
  /** True only in the desktop shell build. */
  desktopApp: boolean;
  /** The renderer is being rebuilt; nothing may run against it this frame. */
  graphicsRebuildPaused: boolean;
}

export interface PresentationGateDecision {
  /** Submit GL draws and sample the frame for perf. */
  render: boolean;
  /** Write HUD and overlay DOM. */
  paint: boolean;
  /** Advance the sim and drain the network. */
  tick: boolean;
}

// The three possible decisions, shared frozen singletons: the gate runs on the
// rAF hot path, which must not allocate (tests/client_frame_allocations.test.ts
// polices the loop in main.ts; returning a fresh literal per frame would be the
// same leak one module deeper). Frozen so no consumer can mutate shared state.
const PAUSED: PresentationGateDecision = Object.freeze({
  render: false,
  paint: false,
  tick: false,
});
// tick stays true while hidden: skipping the network drain lets the server
// snapshot backlog pile up and refocus then freezes the client working
// through it (the July WS-backlog refocus freeze).
const HIDDEN_DESKTOP: PresentationGateDecision = Object.freeze({
  render: false,
  paint: false,
  tick: true,
});
const ALL_ON: PresentationGateDecision = Object.freeze({ render: true, paint: true, tick: true });

/**
 * Decide what a frame is allowed to do. Ordered by precedence: the graphics
 * rebuild wins over everything, then the desktop hidden state, then the
 * all-allowed default.
 */
export function presentationGate(input: PresentationGateInput): PresentationGateDecision {
  if (input.graphicsRebuildPaused) return PAUSED;
  if (input.hidden && input.desktopApp) return HIDDEN_DESKTOP;
  // Web keeps every frame whole, hidden or not: rAF is already paused in a
  // hidden tab, so there is no frame to skip and no behavior to change.
  return ALL_ON;
}
