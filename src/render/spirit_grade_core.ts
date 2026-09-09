// The spirit-mode (ghost) grade amount over time: 0 alive, 1 fully drained,
// eased exactly the way the CSS transition it replaces was.
//
// The classic death look used to be a CSS `filter: grayscale(1) brightness(0.88)`
// with a `transition: filter 0.6s ease` on #game-canvas. A CSS filter on the
// world canvas promotes it into its own render surface and adds a full-screen
// filter pass for the whole corpse run, which is a compositor cost paid on top
// of a post chain that is already grading every pixel. The tint moved into that
// grade pass; this core is the timing half of the move, so it can be tested
// without a GL context.
//
// The curve is the CSS `ease` keyword, cubic-bezier(0.25, 0.1, 0.25, 1), and the
// interruption behaviour is CSS's too: a target flip restarts the transition at
// the CURRENT value and runs the full duration toward the new one, so releasing
// and resurrecting inside 0.6 s never snaps.

/** The CSS transition duration this replaces (base.css kept the same value). */
export const SPIRIT_GRADE_EASE_SEC = 0.6;

// cubic-bezier(0.25, 0.1, 0.25, 1): the CSS `ease` keyword.
const EASE_X1 = 0.25;
const EASE_Y1 = 0.1;
const EASE_X2 = 0.25;
const EASE_Y2 = 1;
const NEWTON_ITERATIONS = 6;
const NEWTON_EPSILON = 1e-6;

function bezier(t: number, p1: number, p2: number): number {
  const inv = 1 - t;
  return 3 * inv * inv * t * p1 + 3 * inv * t * t * p2 + t * t * t;
}

function bezierSlope(t: number, p1: number, p2: number): number {
  const inv = 1 - t;
  return 3 * inv * inv * p1 + 6 * inv * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

/** The CSS `ease` timing function: progress in, eased fraction out. */
export function cssEase(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  let t = progress;
  for (let i = 0; i < NEWTON_ITERATIONS; i++) {
    const slope = bezierSlope(t, EASE_X1, EASE_X2);
    if (Math.abs(slope) < NEWTON_EPSILON) break;
    const error = bezier(t, EASE_X1, EASE_X2) - progress;
    if (Math.abs(error) < NEWTON_EPSILON) break;
    t -= error / slope;
  }
  return bezier(Math.max(0, Math.min(1, t)), EASE_Y1, EASE_Y2);
}

export interface SpiritGradeState {
  /** The live grade amount the shader uniform carries. */
  value: number;
  /** Where this transition started, and where it is heading. */
  from: number;
  to: number;
  /** Elapsed fraction of the current transition, 1 once it has settled. */
  progress: number;
}

export function createSpiritGradeState(): SpiritGradeState {
  return { value: 0, from: 0, to: 0, progress: 1 };
}

/**
 * Advance the grade by `dtSec` toward `ghost ? 1 : 0` and return the amount.
 * `instant` (the reduced-motion arm, which is why the CSS rule dropped its
 * transition under that query too) settles immediately.
 */
export function advanceSpiritGrade(
  state: SpiritGradeState,
  dtSec: number,
  ghost: boolean,
  instant = false,
): number {
  const target = ghost ? 1 : 0;
  if (target !== state.to) {
    state.from = state.value;
    state.to = target;
    state.progress = 0;
  }
  if (instant) {
    state.progress = 1;
    state.value = target;
    return state.value;
  }
  if (state.progress >= 1) {
    state.value = target;
    return state.value;
  }
  state.progress = Math.min(1, state.progress + Math.max(0, dtSec) / SPIRIT_GRADE_EASE_SEC);
  state.value = state.from + (state.to - state.from) * cssEase(state.progress);
  return state.value;
}
