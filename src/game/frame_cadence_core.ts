// The frame rate ceiling: which requestAnimationFrame callbacks render. Under
// vsync an image is only ever shown on a refresh slot, so the only regular
// rhythms are divisors of the display rate; a player's "about 30" becomes the
// divisor closest above it, re-derived whenever the display reading changes.
// Without vsync there are no slots and the ceiling is a plain time limiter.
//
// Pure and allocation-free: the wiring (frame_cadence_wiring.ts) owns the
// clock, the estimator and the re-arm.

import type { RefreshVerdict } from './display_refresh_estimator_core';

/** Ceiling intents, in frames per second. 0 means no ceiling. */
export type FrameCeilingIntent = 0 | 30 | 60;

/** A divisor is accepted when its rate is at or below the intent times this:
 *  37.5 on a 75 Hz display honours "about 30", 48 on a 144 Hz one does not. */
export const CEILING_RATE_TOLERANCE = 1.25;
/** Never pace under this rate. It also keeps the rendered interval under the
 *  50 ms input tick, so a frame never owes the server more than one tick. */
export const MIN_CEILING_FPS = 24;
/** Miss-share smoothing per rendered frame: a few seconds at about 30 fps. */
const MISS_SHARE_ALPHA = 0.02;
/** Without slots a frame is late once it overshoots the target by this share. */
const UNPACED_LATE_SHARE = 0.25;
/** Without slots a callback this share of the target ahead of the deadline
 *  renders: the re-arm sleeps to that point, and a timer fires late, never
 *  early, so the frame lands around the deadline without spinning up to it. */
const UNPACED_EARLY_SHARE = 0.1;

/** How many refresh slots one rendered frame spans. 1 means the ceiling is
 *  inert on this display (the display already runs at or under the intent). */
export function ceilingDivisor(refreshHz: number, intentFps: number): number {
  if (!Number.isFinite(refreshHz) || !(refreshHz > 0) || !(intentFps > 0)) return 1;
  let divisor = 1;
  while (refreshHz / divisor > intentFps * CEILING_RATE_TOLERANCE) divisor++;
  while (divisor > 1 && refreshHz / divisor < MIN_CEILING_FPS) divisor--;
  return divisor;
}

export interface FrameCadenceState {
  /** 0 while the ceiling is inactive. */
  targetIntervalMs: number;
  divisor: number;
  /** Half a slot when paced, a share of the target when not. */
  slackMs: number;
  /** How far ahead of the deadline a callback already renders. */
  earlyMs: number;
  paced: boolean;
  deadlineMs: number;
  lastRenderedAtMs: number;
  /** Smoothed share of rendered frames that arrived a slot or more late. */
  missShare: number;
  /** Whether the last rendered frame missed its chosen slot. */
  lastLate: boolean;
}

export function createFrameCadence(): FrameCadenceState {
  return {
    targetIntervalMs: 0,
    divisor: 1,
    slackMs: 0,
    earlyMs: 0,
    paced: true,
    deadlineMs: 0,
    lastRenderedAtMs: 0,
    missShare: 0,
    lastLate: false,
  };
}

/** Re-derive the target from the intent and the display reading. */
export function configureFrameCadence(
  state: FrameCadenceState,
  intent: FrameCeilingIntent,
  verdict: RefreshVerdict,
  refreshMs: number,
): void {
  let target = 0;
  let divisor = 1;
  let slack = 0;
  let early = 0;
  if (intent !== 0 && verdict !== 'paced') {
    // No slots to align to, or none visible: a plain time limiter. Under a
    // paced display whose lattice cannot be read it still works, since rAF
    // aligns itself; a late timer then costs a slot now and then.
    target = 1000 / intent;
    slack = target * UNPACED_LATE_SHARE;
    early = target * UNPACED_EARLY_SHARE;
  } else if (intent !== 0 && verdict === 'paced' && refreshMs > 0) {
    divisor = ceilingDivisor(1000 / refreshMs, intent);
    if (divisor > 1) {
      target = refreshMs * divisor;
      slack = refreshMs / 2;
      early = slack;
    }
  }
  if (target === 0 || state.targetIntervalMs === 0) state.missShare = 0;
  state.targetIntervalMs = target;
  state.divisor = divisor;
  state.slackMs = slack;
  state.earlyMs = early;
  state.paced = verdict === 'paced';
}

export function frameCadenceActive(state: FrameCadenceState): boolean {
  return state.targetIntervalMs > 0;
}

/**
 * Decide this callback. The deadline advances by whole target intervals so the
 * rate does not drift under the intent, and resyncs to now after a stall. A
 * paced callback within half a slot of the deadline IS the deadline's slot.
 */
export function frameCadenceShouldRender(state: FrameCadenceState, nowMs: number): boolean {
  const target = state.targetIntervalMs;
  if (target <= 0) {
    state.lastRenderedAtMs = nowMs;
    return true;
  }
  if (nowMs < state.deadlineMs - state.earlyMs) return false;
  state.lastLate =
    state.lastRenderedAtMs > 0 && nowMs - state.lastRenderedAtMs > target + state.slackMs;
  if (state.lastRenderedAtMs > 0) {
    state.missShare += ((state.lastLate ? 1 : 0) - state.missShare) * MISS_SHARE_ALPHA;
  }
  // A late frame restarts the rhythm from itself: catching the old phase back
  // would follow a long interval with a short one, a second irregularity.
  const lateBy = nowMs - state.deadlineMs;
  state.deadlineMs = lateBy > state.slackMs ? nowMs + target : state.deadlineMs + target;
  state.lastRenderedAtMs = nowMs;
  return true;
}

/** Let exempt callbacks (loading curtain, hidden shell) render without
 *  counting as misses or leaving a stale deadline behind. */
export function frameCadenceNoteExemptRender(state: FrameCadenceState, nowMs: number): void {
  state.deadlineMs = nowMs + state.targetIntervalMs;
  state.lastRenderedAtMs = 0;
}

/** Time the unpaced re-arm may sleep before the next deadline. */
export function frameCadenceSleepMs(state: FrameCadenceState, nowMs: number): number {
  return state.deadlineMs - state.earlyMs - nowMs;
}
