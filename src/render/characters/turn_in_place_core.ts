// A rooted body that turns in place to face its target (ClipMap.turn,
// VisualDef.turnRate).
//
// The Gorgebloom is the reference: a house-sized flower rooted on its dais that
// never walks, only swings round to its next victim. The sim snaps a mob's
// facing to its target in one tick, which on a 14 yd body reads as the whole
// flower teleporting through a quarter turn. A rig that names a `turnRate`
// instead SLEWS its drawn heading toward the sim's facing at that rate (easing
// out over the last stretch), and holds its `turn` loop while it is still
// catching up (plus a short tail, so a run of small re-aims never flickers the
// loop on and off). Without a rate the heading follows the sim at once and the
// loop still plays while the facing moves.
//
// Presentation only: the sim's facing, every telegraph and every hit test keep
// the true heading; only the model's yaw lags it for a moment. Data, not a
// Gorgebloom branch: another rooted creature earns the turn by naming one.
// Node-only (RENDER_PURE_CORES): no three.js, no DOM.

/** Radians the heading must move to count as turning. */
export const TURN_EPSILON = 0.03;
/** Seconds the loop is held after the heading settles. */
export const TURN_TAIL_SECONDS = 0.3;
/** The slew eases out over the last stretch: its speed never exceeds this
 *  many times the gap still to cover (1/s). */
export const TURN_EASE = 5;
/** A frame this long (a hidden tab, a hitch) snaps the heading instead. */
export const TURN_SNAP_DT = 1;
/** A rig not stepped for this long (parked in the visual pool, streamed out
 *  and back) snaps to the sim's heading instead of spinning round to it. */
export const TURN_STALE_SECONDS = 0.5;

/** One rig's drawn heading. */
export interface TurnInPlaceState {
  /** The drawn heading (radians, the sim's convention). */
  yaw: number;
  seeded: boolean;
  /** Seconds of the loop's tail still to hold. */
  tail: number;
  /** The drawn heading minus the sim's (radians, wrapped): the yaw the model
   *  is turned by on top of its parent. */
  lag: number;
  /** Hold the turn loop this frame. */
  turning: boolean;
  /** The sim heading last frame (for the rate-free follow). */
  lastTarget: number;
  /** The clock (seconds) it was last stepped at; NaN before the first. */
  seenAt: number;
}

export function createTurnInPlaceState(): TurnInPlaceState {
  return { yaw: 0, seeded: false, tail: 0, lag: 0, turning: false, lastTarget: 0, seenAt: NaN };
}

/** `a` wrapped into (-pi, pi]. */
export function wrapAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  else if (r <= -Math.PI) r += Math.PI * 2;
  return r;
}

/**
 * Advance the drawn heading toward the sim's `target` over `dt` seconds at
 * `rate` rad/s (0 or less: follow at once). `now` is a clock in seconds (a
 * long gap since the last step reseeds). Writes `lag` and `turning` into
 * `st`; allocation-free (runs once per rig per frame).
 */
export function stepTurnInPlace(
  st: TurnInPlaceState,
  target: number,
  dt: number,
  rate: number,
  now = Number.NaN,
): TurnInPlaceState {
  const step = Math.max(0, dt);
  const stale = now - st.seenAt > TURN_STALE_SECONDS;
  st.seenAt = now;
  if (!st.seeded || stale || step >= TURN_SNAP_DT || !Number.isFinite(target)) {
    st.yaw = Number.isFinite(target) ? target : 0;
    st.lastTarget = st.yaw;
    st.seeded = true;
    st.tail = 0;
    st.lag = 0;
    st.turning = false;
    return st;
  }
  let moved: number;
  if (rate > 0) {
    const gap = wrapAngle(target - st.yaw);
    const speed = Math.min(rate, Math.abs(gap) * TURN_EASE);
    const delta = Math.min(Math.abs(gap), speed * step);
    st.yaw = wrapAngle(st.yaw + Math.sign(gap) * delta);
    moved = Math.abs(gap);
  } else {
    moved = Math.abs(wrapAngle(target - st.lastTarget)) * (step > 0 ? 1 : 0);
    st.yaw = target;
  }
  st.lastTarget = target;
  st.lag = wrapAngle(st.yaw - target);
  if (moved > TURN_EPSILON) st.tail = TURN_TAIL_SECONDS;
  else st.tail = Math.max(0, st.tail - step);
  st.turning = st.tail > 0;
  return st;
}
