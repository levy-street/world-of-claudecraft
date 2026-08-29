// "The thing you want is off that edge": a golden bloom down one side of the
// screen, shown ONLY while the current objective is entirely off-screen.
//
// The first cut of this keyed on a bearing dead zone, and was wrong twice
// over (CX): it lit up while the objective was plainly visible on screen,
// and it sometimes lit the wrong edge, because a bearing measured against
// the compass rose is not the same thing as where the camera actually
// projects a point. This version asks the renderer where the objective
// LANDS on screen and answers from that, so the cue can only appear when
// there is genuinely nothing to look at, and can only point the way the
// pixels went.
//
// Pure: no DOM, no Three, no wall clock, no rng. The caller does the
// projection (renderer.worldToScreen) and hands in the result, which is what
// keeps this testable. Registered in UI_PURE_CORES
// (tests/architecture.test.ts); driven by tests/objective_glow_view.test.ts.

export type GlowSide = 'left' | 'right' | 'behind' | 'bottom';

export interface ObjectiveGlowPlan {
  /** Which edge blooms: the side the player has to turn TOWARD, or 'behind'
   *  for BOTH side edges at once. */
  side: GlowSide;
  /** 0 (just past the edge) to 1 (fully away). */
  intensity: number;
}

/** A projected objective, the shape renderer.worldToScreen returns. */
export interface ProjectedObjective {
  x: number;
  y: number;
  /** True when the point is behind the camera plane, where x and y are
   *  mirrored nonsense and must not be read as a position. */
  behind: boolean;
}

export interface Viewport {
  width: number;
  height: number;
}

/**
 * How far past the viewport edge the objective must sit before the cue
 * starts. A small margin, so an objective hugging the edge does not flicker
 * the bloom on and off as the player walks.
 */
export const OFFSCREEN_MARGIN_PX = 24;

/** How far past the edge the bloom reaches full strength, as a fraction of
 *  viewport width. Anything behind the camera is full strength outright. */
export const FULL_INTENSITY_FRAC = 0.5;

/**
 * The glow for this frame, or null while the objective is on screen.
 *
 * `behind` is its own answer, not a side. A point behind the camera projects
 * to a MIRRORED x, so reading it as a left/right edge is guesswork on a
 * value that means nothing; worse, it tells a player who has turned right
 * around to keep turning one particular way when either way is equally
 * correct and one of them is a longer turn. CX put it plainly: the cue "still
 * isn't working when it's behind my character, it sticks to left and right
 * side". So behind blooms BOTH side edges, which reads as "turn around" and
 * cannot point the wrong way.
 */
export function objectiveGlowFromScreen(
  screen: ProjectedObjective,
  viewport: Viewport,
): ObjectiveGlowPlan | null {
  if (!Number.isFinite(screen.x) || viewport.width <= 0) return null;

  if (screen.behind) return { side: 'behind', intensity: 1 };

  const offLeft = -screen.x - OFFSCREEN_MARGIN_PX;
  const offRight = screen.x - viewport.width - OFFSCREEN_MARGIN_PX;
  // On screen (or within the margin): nothing to point at, so no cue.
  if (offLeft < 0 && offRight < 0) return null;

  const past = Math.max(offLeft, offRight);
  const full = viewport.width * FULL_INTENSITY_FRAC;
  const intensity = full > 0 ? Math.min(1, past / full) : 1;
  return { side: offLeft > offRight ? 'left' : 'right', intensity };
}

/**
 * Is the coach's current instruction about the INTERFACE rather than a place?
 *
 * The bag and character-sheet lessons have no world direction, so they bloom
 * the BOTTOM, where those buttons live.
 */
export function uiLessonGlow(): ObjectiveGlowPlan {
  return { side: 'bottom', intensity: 1 };
}
