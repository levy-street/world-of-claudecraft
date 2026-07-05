// Pure math + commit policy for direct placement manipulation in Select mode
// (drag-move, Shift/Alt+wheel rotate/scale, arrow-key nudges). No DOM, no
// Three: the app and the 3D viewport consume it; a Vitest drives it directly.

/** Placement scale bounds shared by the inspector sliders and the wheel path. */
export const PLACEMENT_SCALE_MIN = 0.2;
export const PLACEMENT_SCALE_MAX = 5;

/** One Shift+wheel tick rotates by 15 degrees. */
export const ROTATE_STEP_RAD = Math.PI / 12;

/** Multiplicative Alt+wheel scale step per tick. */
const SCALE_WHEEL_FACTOR = 1.1;

/** Arrow-key nudge distances (yards). */
export const NUDGE_STEP_YD = 0.5;
export const NUDGE_STEP_BIG_YD = 2;

/** A burst of transform ticks commits once, this long after the last tick. */
export const TRANSFORM_COMMIT_MS = 400;

/**
 * The camera yaw whose screen axes match the top-down 2D canvas (+x screen
 * right, +z screen down): ArrowUp maps to -z, ArrowRight to +x. Also the
 * EditorCamera's default yaw.
 */
export const NORTH_UP_YAW = Math.PI;

export type NudgeKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

/**
 * Ground-plane delta for one arrow-key nudge, relative to the CAMERA yaw
 * (screen-relative, not world axes). EditorCamera convention: the camera sits
 * behind the target along -(sin yaw, cos yaw), so screen-up (away from the
 * camera) is (sin yaw, cos yaw) and screen-right is the Y-up lookAt basis
 * x-axis, (-cos yaw, sin yaw).
 */
export function nudgeDelta(
  key: NudgeKey,
  camYaw: number,
  step: number,
): { dx: number; dz: number } {
  const fx = Math.sin(camYaw);
  const fz = Math.cos(camYaw);
  const rx = -Math.cos(camYaw);
  const rz = Math.sin(camYaw);
  switch (key) {
    case 'ArrowUp':
      return { dx: fx * step, dz: fz * step };
    case 'ArrowDown':
      return { dx: -fx * step, dz: -fz * step };
    case 'ArrowRight':
      return { dx: rx * step, dz: rz * step };
    case 'ArrowLeft':
      return { dx: -rx * step, dz: -rz * step };
  }
}

/** Wrap an angle into [0, 2*PI). */
export function wrapAngle(a: number): number {
  const two = Math.PI * 2;
  const r = a % two;
  return r < 0 ? r + two : r;
}

/**
 * One Shift+wheel rotation tick: 15 degrees in the wheel direction, wrapped
 * into [0, 2*PI). Scrolling down (positive deltaY) rotates clockwise.
 */
export function rotateStep(rotY: number, deltaY: number): number {
  const dir = deltaY > 0 ? 1 : -1;
  return wrapAngle(rotY + dir * ROTATE_STEP_RAD);
}

/**
 * One Alt+wheel scale tick: multiplicative step clamped to the inspector
 * slider bounds, rounded to 2 decimals so repeated ticks stay tidy.
 * Scrolling up (negative deltaY) grows the placement.
 */
export function scaleStep(scale: number, deltaY: number): number {
  const next = deltaY > 0 ? scale / SCALE_WHEEL_FACTOR : scale * SCALE_WHEEL_FACTOR;
  const clamped = Math.min(PLACEMENT_SCALE_MAX, Math.max(PLACEMENT_SCALE_MIN, next));
  return Math.round(clamped * 100) / 100;
}

/**
 * Coalesces a burst of live transform ticks (wheel spins, held arrow keys)
 * into ONE undo commit: each tick pushes the deadline out; the burst is due
 * once the window lapses with no further tick. Time is injected, so the state
 * machine is directly testable; the app supplies the wall clock and a timer.
 */
export class CommitCoalescer {
  private deadline: number | null = null;

  constructor(readonly windowMs: number = TRANSFORM_COMMIT_MS) {}

  /** Register a live transform tick at `now`; extends the commit deadline. */
  tick(now: number): void {
    this.deadline = now + this.windowMs;
  }

  /** A burst is open and has not committed yet. */
  get pending(): boolean {
    return this.deadline !== null;
  }

  /** Poll at `now`: true exactly once when the burst window has lapsed. */
  due(now: number): boolean {
    if (this.deadline === null || now < this.deadline) return false;
    this.deadline = null;
    return true;
  }

  /** Drop the open burst without committing (the caller commits explicitly). */
  cancel(): void {
    this.deadline = null;
  }
}
