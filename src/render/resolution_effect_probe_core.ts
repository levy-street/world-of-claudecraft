// Does a render-scale cut actually make the frame cheaper on THIS device?
//
// The quality governor (render_budget.ts) sheds resolution as its last rung and
// on severe pressure. Every reading it has is CPU-side (its own header says so),
// so it cannot tell a GPU-bound frame, where fewer pixels help, from a CPU-bound
// one, where they cannot: on a CPU-bound phone it cut the render scale to the
// floor for whole sessions and the frame did not get faster. (Measured
// 2026-11-11 on a Snapdragon 7s Gen 3 phone at Low: render scale 0.85 vs 0.5,
// 2.9x the pixels, moved frame rate by about 5% and main-thread time not at all.)
//
// So a resolution cut is an A/B/A experiment, the same idea as the governor's
// external-frame-cap probe: hold the cut level and measure the typical frame cost,
// briefly restore the level it came from and measure, then cut again and measure
// once more. The cut is kept only if the restored arm costs meaningfully more
// than the AVERAGE of the two cut arms (RESOLUTION_EFFECT_MIN_MS and
// RESOLUTION_EFFECT_MIN_SHARE). Bracketing the restored arm with two cut arms
// cancels a load that rises or falls steadily during the experiment (a cut is
// usually triggered by a sudden rise, so the calm before it is no baseline); a
// load that jumps inside one arm can still mislead it, which costs one lockout.
//
// While an experiment runs the governor holds every other rung still
// (render_budget.ts), so the arms differ in resolution only. On a GPU-bound
// device the restored arm is visible: about 1.5 s back at the previous scale.
// A kept cut lets the next RESOLUTION_TRUSTED_CUTS cuts inside RESOLUTION_TRUST_S
// skip the experiment, so a descent pays for one restored arm every few steps,
// and a keep the arms misjudged (a load that jumped inside the restored arm) can
// walk the scale down by at most that many unjudged steps before the next
// experiment checks the level it reached. A cut that bought nothing stays undone
// and the resolution rung is locked out for RESOLUTION_LOCKOUT_S; the lockout
// expires because what bounds a frame changes with the scene. With too little
// clean evidence the cut stands, which is the governor's behaviour before this
// probe, and so does a cut whose experiment is cancelled.
//
// Pure and DOM-free (RENDER_PURE_CORES): the governor feeds it frame costs and
// tells it when it cut; each step answers which level to hold.

/** Seconds after a level change that are not judged: targets reallocate and the
 *  pipeline catches up. */
export const RESOLUTION_EFFECT_SETTLE_S = 0.5;
/** Seconds of readings each arm's median is taken over. */
export const RESOLUTION_EFFECT_MEASURE_S = 1.5;
/** Clean readings each arm needs before its median counts as evidence. */
export const RESOLUTION_EFFECT_MIN_READINGS = 10;
/** A cut is worth keeping when the typical frame is cheaper by at least this
 *  many milliseconds AND at least this share of the restored arm's cost. */
export const RESOLUTION_EFFECT_MIN_MS = 0.5;
export const RESOLUTION_EFFECT_MIN_SHARE = 0.04;
/** How long a reverted cut keeps the resolution rung out of the ladder. */
export const RESOLUTION_LOCKOUT_S = 60;
/** After a kept cut, how long further cuts may skip the experiment. */
export const RESOLUTION_TRUST_S = 30;
/** After a kept cut, how many further cuts skip the experiment (inside
 *  RESOLUTION_TRUST_S); the one after them is judged again. */
export const RESOLUTION_TRUSTED_CUTS = 2;

export type ResolutionProbePhase =
  | 'idle'
  | 'settle-cut'
  | 'measure-cut'
  | 'settle-restore'
  | 'measure-restore'
  | 'settle-recut'
  | 'measure-recut';

export type ResolutionProbeVerdict = 'pending' | 'keep' | 'revert';

export interface ResolutionProbeState {
  phase: ResolutionProbePhase;
  phaseS: number;
  levelBefore: number;
  levelAfter: number;
  cutReadings: number[];
  restoredReadings: number[];
  recutReadings: number[];
  lockoutS: number;
  trustS: number;
  /** Cuts the current trust may still let through unjudged. */
  trustCuts: number;
  kept: number;
  reverted: number;
  unjudged: number;
  cancelled: number;
  lastGainMs: number;
}

export interface ResolutionProbeStep {
  /** The resolution level the governor must hold from now on, or null for "no
   *  instruction" (leave the level as it is). */
  setLevel: number | null;
  verdict: ResolutionProbeVerdict;
}

export function createResolutionProbe(): ResolutionProbeState {
  return {
    phase: 'idle',
    phaseS: 0,
    levelBefore: 1,
    levelAfter: 1,
    cutReadings: [],
    restoredReadings: [],
    recutReadings: [],
    lockoutS: 0,
    trustS: 0,
    trustCuts: 0,
    kept: 0,
    reverted: 0,
    unjudged: 0,
    cancelled: 0,
    lastGainMs: 0,
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** An experiment is running: the governor holds every rung still and does not
 *  report itself at baseline. */
export function resolutionProbeBusy(state: ResolutionProbeState): boolean {
  return state.phase !== 'idle';
}

/** Whether the resolution rung may be cut now: not while an experiment runs and
 *  not during the lockout a reverted cut started (an exhaustive shed, the frame
 *  cap probe's, ignores the lockout: see render_budget.ts). */
export function resolutionCutAllowed(state: ResolutionProbeState): boolean {
  return state.phase === 'idle' && state.lockoutS <= 0;
}

/**
 * Abandon a running experiment without a verdict: something else now owns the
 * resolution level (the external-frame-cap probe, a changed resolution range).
 * Returns the level to hold: the cut, which is what the governor chose before
 * the experiment began; null when nothing was running.
 */
export function cancelResolutionProbe(state: ResolutionProbeState): number | null {
  if (state.phase === 'idle') return null;
  state.phase = 'idle';
  state.phaseS = 0;
  state.cancelled++;
  return state.levelAfter;
}

/** The governor cut resolution from `levelBefore` to `levelAfter`. Starts an
 *  experiment unless the device recently proved pixel-bound. Returns whether
 *  an experiment started. */
export function noteResolutionCut(
  state: ResolutionProbeState,
  levelBefore: number,
  levelAfter: number,
): boolean {
  if (state.phase !== 'idle' || !(levelAfter < levelBefore)) return false;
  if (state.trustS > 0 && state.trustCuts > 0) {
    state.trustCuts--;
    return false;
  }
  state.phase = 'settle-cut';
  state.phaseS = 0;
  state.levelBefore = levelBefore;
  state.levelAfter = levelAfter;
  state.cutReadings.length = 0;
  state.restoredReadings.length = 0;
  state.recutReadings.length = 0;
  return true;
}

const PENDING: ResolutionProbeStep = Object.freeze({ setLevel: null, verdict: 'pending' });

function verdict(state: ResolutionProbeState): ResolutionProbeStep {
  state.phase = 'idle';
  state.phaseS = 0;
  const enough =
    state.cutReadings.length >= RESOLUTION_EFFECT_MIN_READINGS &&
    state.restoredReadings.length >= RESOLUTION_EFFECT_MIN_READINGS &&
    state.recutReadings.length >= RESOLUTION_EFFECT_MIN_READINGS;
  if (!enough) {
    // No evidence either way: the cut stands, as it always did.
    state.unjudged++;
    return { setLevel: state.levelAfter, verdict: 'keep' };
  }
  const restoredMs = median(state.restoredReadings);
  const cutMs = (median(state.cutReadings) + median(state.recutReadings)) / 2;
  const gain = restoredMs - cutMs;
  state.lastGainMs = Math.round(gain * 100) / 100;
  const paidOff =
    gain >= RESOLUTION_EFFECT_MIN_MS && gain >= restoredMs * RESOLUTION_EFFECT_MIN_SHARE;
  if (paidOff) {
    state.kept++;
    state.trustS = RESOLUTION_TRUST_S;
    state.trustCuts = RESOLUTION_TRUSTED_CUTS;
    return { setLevel: state.levelAfter, verdict: 'keep' };
  }
  state.reverted++;
  state.lockoutS = RESOLUTION_LOCKOUT_S;
  return { setLevel: state.levelBefore, verdict: 'revert' };
}

/**
 * Feed one reading: `costMs` is the frame's cost as the governor reads it,
 * `clean` false for a reading that is not evidence (a neutral preparation or
 * covered frame). Returns which level to hold and, at the end, the verdict.
 */
export function advanceResolutionProbe(
  state: ResolutionProbeState,
  costMs: number,
  dt: number,
  clean: boolean,
): ResolutionProbeStep {
  if (state.lockoutS > 0) state.lockoutS = Math.max(0, state.lockoutS - dt);
  if (state.trustS > 0) state.trustS = Math.max(0, state.trustS - dt);
  if (state.phase === 'idle') return PENDING;
  const usable = clean && Number.isFinite(costMs) && costMs > 0;
  state.phaseS += dt;
  const settled = state.phaseS >= RESOLUTION_EFFECT_SETTLE_S;
  const measured = state.phaseS >= RESOLUTION_EFFECT_MEASURE_S;
  switch (state.phase) {
    case 'settle-cut':
      if (settled) [state.phase, state.phaseS] = ['measure-cut', 0];
      return PENDING;
    case 'measure-cut':
      if (usable) state.cutReadings.push(costMs);
      if (!measured) return PENDING;
      [state.phase, state.phaseS] = ['settle-restore', 0];
      return { setLevel: state.levelBefore, verdict: 'pending' };
    case 'settle-restore':
      if (settled) [state.phase, state.phaseS] = ['measure-restore', 0];
      return PENDING;
    case 'measure-restore':
      if (usable) state.restoredReadings.push(costMs);
      if (!measured) return PENDING;
      [state.phase, state.phaseS] = ['settle-recut', 0];
      return { setLevel: state.levelAfter, verdict: 'pending' };
    case 'settle-recut':
      if (settled) [state.phase, state.phaseS] = ['measure-recut', 0];
      return PENDING;
    default:
      if (usable) state.recutReadings.push(costMs);
      if (!measured) return PENDING;
      return verdict(state);
  }
}
