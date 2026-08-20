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
  /** A blocking arrival holds the world draw: the loading screen is up over
   *  an unprepared destination, so a submitted frame is unseen work that races
   *  the zone prepare for the main thread and pays the landing's cold links
   *  before the screen can even paint. Everything else in the frame runs. */
  worldDrawHeld: boolean;
}

export interface PresentationGateDecision {
  /** Run the renderer and sample the frame for perf. */
  render: boolean;
  /** Submit the world's GL draw (render minus a blocking arrival's hold: the
   *  renderer still runs, so culls, gates and views advance, but the frame is
   *  not presented). */
  drawWorld: boolean;
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
  drawWorld: false,
  paint: false,
  tick: false,
});
// tick stays true while hidden: skipping the network drain lets the server
// snapshot backlog pile up and refocus then freezes the client working
// through it (the July WS-backlog refocus freeze).
const HIDDEN_DESKTOP: PresentationGateDecision = Object.freeze({
  render: false,
  drawWorld: false,
  paint: false,
  tick: true,
});
// The renderer keeps running and sampling (the perf beacon must not read a
// covered arrival as a hidden window); only the world's GL submit is skipped.
const WORLD_DRAW_HELD: PresentationGateDecision = Object.freeze({
  render: true,
  drawWorld: false,
  paint: true,
  tick: true,
});
const ALL_ON: PresentationGateDecision = Object.freeze({
  render: true,
  drawWorld: true,
  paint: true,
  tick: true,
});

/** The one mutable input the frame loop refreshes in place (no per-frame
 *  allocation), with the arrival chain's hold as a bound setter so main.ts can
 *  hand it over without growing. */
export function newPresentationGateInput(
  desktopApp: boolean,
): PresentationGateInput & { holdWorldDraw: (held: boolean) => void } {
  const input = {
    hidden: false,
    desktopApp,
    graphicsRebuildPaused: false,
    worldDrawHeld: false,
    holdWorldDraw: (held: boolean): void => {
      input.worldDrawHeld = held;
    },
  };
  return input;
}

/**
 * Decide what a frame is allowed to do. Ordered by precedence: the graphics
 * rebuild wins over everything, then the desktop hidden state, then a blocking
 * arrival's world-draw hold, then the all-allowed default.
 */
export function presentationGate(input: PresentationGateInput): PresentationGateDecision {
  if (input.graphicsRebuildPaused) return PAUSED;
  if (input.hidden && input.desktopApp) return HIDDEN_DESKTOP;
  if (input.worldDrawHeld) return WORLD_DRAW_HELD;
  // Web keeps every frame whole, hidden or not: rAF is already paused in a
  // hidden tab, so there is no frame to skip and no behavior to change.
  return ALL_ON;
}
