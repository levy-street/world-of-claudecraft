// How a drawn movement trajectory FEELS, as numbers: given the poses the
// client actually drew, the authoritative poses the server produced, and the
// intent that was held while both happened, score the five artifacts a player
// reports as "the movement is off".
//
// Pure and host-agnostic (no server/, no DOM, no clock): it takes three plain
// arrays, so a synthetic hand-built trajectory scores exactly as a harness run
// does. The sim constants it reads (RUN_SPEED, BACKPEDAL_MULT) are the movement
// kernel's own, so a balance change moves the metric with the game instead of
// against a stale literal.
//
// The five metrics, and the artifact each one names:
//   backwardSteps   - the display stepping AGAINST the direction the player is
//                     holding (a snap-back).
//   pathDeviation   - the display dragged off the line the player steered.
//   progressError   - how far ahead of or behind the authority the display is
//                     along that line (lead, lag, and the settling error left
//                     after motion stops).
//   speedContinuity - the display not moving at the speed the input commands,
//                     and the frame-to-frame roughness of it (choppiness).
//   correctionEvents- frames whose drawn step points somewhere other than where
//                     the held input does (a visible correction).
//
// Every threshold is a named parameter with a default; nothing is hard-coded
// inside the math.

import { MAX_SELF_REWIND_YD_PER_SEC } from '../../src/render/self_render_position_core';
import { BACKPEDAL_MULT } from '../../src/sim/player_motion';
import { DT, type MoveInput, RUN_SPEED } from '../../src/sim/types';

const DT_MS = DT * 1000;

/** Drawn-yaw direction changes at or below this are not perceptual reversals. */
export const FACING_REVERSAL_DEADBAND_RAD = 0.005;

/** One drawn frame: when it was drawn and where the avatar was put. */
export interface DrawnSample {
  tMs: number;
  x: number;
  z: number;
  drawnYaw?: number;
  cameraFacing?: number;
  authoritativeFacing?: number;
  turnInputActive?: boolean;
  mi?: MoveInput;
  reconcileMode?: ReconcileMode | null;
  residualYd?: number;
}

export type ReconcileMode = 'match' | 'replayed' | 'ignore' | 'stale' | 'suspend';

/** One authoritative pose, indexed by the server tick that produced it. */
export interface GroundTruthSample {
  tick: number;
  x: number;
  z: number;
  ct?: number;
}

/** The intent that was on the wire at `tMs` (held between samples). */
export interface CommandSample {
  tMs: number;
  mi: MoveInput;
  facing: number;
  ct?: number;
  samplerInterpolationAlpha?: number;
  sampledFacing?: number | null;
}

export interface AuthorityTickSample {
  tMs: number;
  consumedCt: number;
}

export interface MovementMetricsOptions {
  /** Server tick period; with `tickPhaseMs` it dates a ground-truth sample. */
  tickMs?: number;
  /**
   * When tick `k`'s pose exists, relative to the tick period. The authoritative
   * pose of tick k is the state AFTER that tick ran, so it dates at the tick's
   * END: `(k + 1) * tickMs` with the default phase of one full period.
   */
  tickPhaseMs?: number;
  /** A drawn step counts as backward below this projection (yards). */
  backwardDeadbandYd?: number;
  /** Frames within this window of a held-input CHANGE are excluded from the
   *  steady-state metrics (speed continuity, correction events). */
  rampWindowMs?: number;
  /** A drawn step deviating past this from the commanded direction is a
   *  correction event (degrees). */
  correctionAngleDeg?: number;
  /** A drawn step shorter than this has no meaningful direction. */
  minStepYd?: number;
}

export interface BackwardStepsMetric {
  /** How many drawn steps went backward past the deadband. */
  count: number;
  /** The most negative along-command projection seen (yards, <= 0). */
  worstYd: number;
  /** Steps examined (held translational input, both endpoints known). */
  samples: number;
}

export interface PathDeviationMetric {
  maxYd: number;
  meanYd: number;
  samples: number;
}

export interface ProgressErrorMetric {
  /** Largest |drawn progress - authoritative progress| (yards). */
  maxAbsYd: number;
  /** Signed mean (positive: the display leads the authority). */
  meanYd: number;
  /** The value on the last drawn frame: what is left once motion stops. */
  terminalYd: number;
  samples: number;
}

export interface SpeedContinuityMetric {
  /** Largest |drawn speed - commanded speed| in the steady segment (yd/s). */
  maxSpeedErr: number;
  /** Largest frame-to-frame change in drawn speed in the steady segment. */
  maxSpeedDelta: number;
  samples: number;
}

export interface CorrectionEventsMetric {
  count: number;
  /** Worst deviation between a drawn step and the commanded direction (deg). */
  worstDeg: number;
  samples: number;
}

export interface InputToAuthorityMetric {
  maxMs: number;
  meanMs: number;
  samples: number;
}

export interface FacingContinuityMetric {
  maxPostReleaseYawRate: number;
  reversals: number;
  samples: number;
}

export interface FacingCameraSplitMetric {
  maxRad: number;
  samples: number;
}

export interface FacingSettleErrorMetric {
  terminalRad: number;
  samples: number;
}

export interface ReplayEventsMetric {
  count: number;
  byMode: Record<ReconcileMode, number>;
  worstResidualYd: number;
}

export interface MovementMetrics {
  backwardSteps: BackwardStepsMetric;
  pathDeviation: PathDeviationMetric;
  progressError: ProgressErrorMetric;
  speedContinuity: SpeedContinuityMetric;
  correctionEvents: CorrectionEventsMetric;
  inputToAuthorityMs: InputToAuthorityMetric;
  facingContinuity: FacingContinuityMetric;
  facingCameraSplit: FacingCameraSplitMetric;
  facingSettleError: FacingSettleErrorMetric;
  replayEvents: ReplayEventsMetric;
}

export const MOVEMENT_METRICS_DEFAULTS = {
  tickMs: 50,
  tickPhaseMs: 50,
  backwardDeadbandYd: 0.001,
  rampWindowMs: 150,
  correctionAngleDeg: 30,
  minStepYd: 0.01,
} as const;

/**
 * The acceptance bar a reconciliation rework is aiming at, as opposed to the
 * measured baseline (tests/movement_latency_baseline.md). It lives beside the
 * metrics because it is stated in their vocabulary; the suite that asserts it
 * is tests/movement_latency_baseline.test.ts, behind STRICT_MOVEMENT_TARGETS.
 */
export const MOVEMENT_FEEL_TARGETS = {
  /** No frame may step against the held direction past this (yards). The
   *  deadband itself: anything a step can register as backward at all is one,
   *  so sub-centimetre continuous snap-back cannot slip under the bar. */
  backwardStepYd: MOVEMENT_METRICS_DEFAULTS.backwardDeadbandYd,
  /** No visible correction: the drawn step always points where input does. */
  correctionEvents: 0,
  /** Legitimate play never needs to replay or discard prediction history. */
  replayEvents: 0,
  /** The display never drags off the steered line past this (yards). */
  pathDeviationYd: 0.05,
  /** Mid-run lead or lag against the authority along the steered line (yd):
   *  the display-fidelity bound the reconciliation rework must meet, and the
   *  one target that says how far the drawn avatar may be from where the
   *  server has it WHILE moving rather than only after it stops. */
  progressMaxYd: 0.15,
  /** Steady-segment speed error against the commanded speed (yd/s). */
  speedErrYdPerSec: 0.5,
  /** Frame-to-frame speed change in the steady segment (yd/s). */
  speedDeltaYdPerSec: 1.5,
  /** What may be left between display and authority once motion stops (yd). */
  settleYd: 0.05,
} as const;

/**
 * The bar for cells where the SERVER legitimately overrides the client: a
 * stun, a snare, any authoritative speed change the display cannot know about
 * until a snapshot carries it.
 *
 * The ordinary targets are unsatisfiable there, and not because the client is
 * wrong: `commandedSpeed` reads the held input alone, so it cannot see a
 * server-side speed multiplier, and a correction toward an authority that just
 * changed the rules is the CORRECT behavior rather than an artifact. Asserting
 * speed error, speed delta, or a correction count against those cells would
 * pin a bar the display can only pass by ignoring the server.
 *
 * What still has to hold is that the override is absorbed cleanly: the visible
 * snap-back it costs stays bounded, and once motion stops the display sits on
 * the authority. Reconciliation during an override transition is designed
 * absorption, so replay counts are measured and pinned per CC cell rather than
 * asserted against the legitimate-play zero target.
 *
 * Authoritative scoring carries about a +0.45 yard mid-motion lead at 150 ms:
 * a healthy predictor leads the concurrent server tick. Per-sample client-clock
 * dating applies only to cells scored against their zero-latency twin.
 */
export const MOVEMENT_FEEL_TARGETS_CC = {
  /** The predictor-to-fallback residual may rewind by one bounded display
   *  frame, plus a small allowance for floating-point arithmetic. */
  backwardStepYd: MAX_SELF_REWIND_YD_PER_SEC * (1 / 60) + 0.000001,
  /** Terminal settle is NOT excused by crowd control: once the aura and the
   *  motion are done the display must land on the authority. */
  settleYd: 0.05,
} as const;

interface Vec2 {
  x: number;
  z: number;
}

/**
 * The world direction the held input commands, given the display heading.
 * Mirrors stepPlayerMotion exactly: local z is forward, local x is strafe
 * right, and world = forward * mz + right * mx with right = (-cos f, sin f).
 * Returns null when nothing translational is held.
 */
export function commandedDirection(mi: MoveInput, facing: number): Vec2 | null {
  let mx = 0;
  let mz = 0;
  if (mi.forward) mz += 1;
  if (mi.back) mz -= 1;
  if (mi.strafeLeft) mx -= 1;
  if (mi.strafeRight) mx += 1;
  if (mx === 0 && mz === 0) return null;
  const len = Math.hypot(mx, mz);
  mx /= len;
  mz /= len;
  const sin = Math.sin(facing);
  const cos = Math.cos(facing);
  return { x: mz * sin - mx * cos, z: mz * cos + mx * sin };
}

/**
 * Ground speed the held input commands (yd/s), on a constant-speed lane
 * (sloped terrain, level horizontal speed) with no speed auras: the harness
 * lane is exactly that, and a scenario that leaves it would be measuring
 * terrain rather than latency. It reads the held input alone, so a server-side
 * speed multiplier is invisible to it (see MOVEMENT_FEEL_TARGETS_CC).
 */
export function commandedSpeed(mi: MoveInput): number {
  let mz = 0;
  if (mi.forward) mz += 1;
  if (mi.back) mz -= 1;
  const translational = mz !== 0 || mi.strafeLeft || mi.strafeRight;
  if (!translational) return 0;
  return mz < 0 ? RUN_SPEED * BACKPEDAL_MULT : RUN_SPEED;
}

function translationalHeld(mi: MoveInput): boolean {
  return mi.forward || mi.back || mi.strafeLeft || mi.strafeRight;
}

function angularDistance(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function signedAngularStep(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function computeFacingContinuity(drawn: readonly DrawnSample[]): FacingContinuityMetric {
  const metric: FacingContinuityMetric = {
    maxPostReleaseYawRate: 0,
    reversals: 0,
    samples: 0,
  };
  let lastActiveIndex = -1;
  for (let i = 0; i < drawn.length; i++) {
    if (drawn[i].turnInputActive === true) lastActiveIndex = i;
  }
  let previousDirection = 0;
  for (let i = 1; i < drawn.length; i++) {
    const previous = drawn[i - 1];
    const current = drawn[i];
    if (previous.drawnYaw === undefined || current.drawnYaw === undefined) continue;
    const dtSec = (current.tMs - previous.tMs) / 1000;
    if (!(dtSec > 0)) continue;
    const step = signedAngularStep(previous.drawnYaw, current.drawnYaw);
    if (i > lastActiveIndex) {
      metric.samples++;
      metric.maxPostReleaseYawRate = Math.max(metric.maxPostReleaseYawRate, Math.abs(step) / dtSec);
    }
    if (current.turnInputActive === true) {
      previousDirection = 0;
      continue;
    }
    const direction = Math.abs(step) > FACING_REVERSAL_DEADBAND_RAD ? Math.sign(step) : 0;
    if (direction === 0) continue;
    if (previousDirection !== 0 && direction !== previousDirection) metric.reversals++;
    previousDirection = direction;
  }
  return metric;
}

export function computeFacingCameraSplit(drawn: readonly DrawnSample[]): FacingCameraSplitMetric {
  const metric: FacingCameraSplitMetric = { maxRad: 0, samples: 0 };
  for (const frame of drawn) {
    if (frame.drawnYaw === undefined || frame.cameraFacing === undefined) continue;
    metric.samples++;
    metric.maxRad = Math.max(metric.maxRad, angularDistance(frame.drawnYaw, frame.cameraFacing));
  }
  return metric;
}

export function computeFacingSettleError(drawn: readonly DrawnSample[]): FacingSettleErrorMetric {
  for (let i = drawn.length - 1; i >= 0; i--) {
    const frame = drawn[i];
    if (frame.drawnYaw === undefined || frame.authoritativeFacing === undefined) continue;
    return {
      terminalRad: angularDistance(frame.drawnYaw, frame.authoritativeFacing),
      samples: 1,
    };
  }
  return { terminalRad: 0, samples: 0 };
}

export function computeReplayEvents(drawn: readonly DrawnSample[]): ReplayEventsMetric {
  const byMode: Record<ReconcileMode, number> = {
    match: 0,
    replayed: 0,
    ignore: 0,
    stale: 0,
    suspend: 0,
  };
  let worstResidualYd = 0;
  for (const frame of drawn) {
    if (frame.reconcileMode !== undefined && frame.reconcileMode !== null) {
      byMode[frame.reconcileMode]++;
    }
    if (frame.residualYd !== undefined) {
      worstResidualYd = Math.max(worstResidualYd, frame.residualYd);
    }
  }
  return {
    count: byMode.replayed + byMode.ignore + byMode.stale + byMode.suspend,
    byMode,
    worstResidualYd,
  };
}

function sameHeldInput(a: MoveInput, b: MoveInput): boolean {
  return (
    a.forward === b.forward &&
    a.back === b.back &&
    a.strafeLeft === b.strafeLeft &&
    a.strafeRight === b.strafeRight &&
    a.jump === b.jump
  );
}

/** The command sample in force at `tMs` (held between samples). */
function commandAt(timeline: readonly CommandSample[], tMs: number): CommandSample | null {
  let found: CommandSample | null = null;
  for (const sample of timeline) {
    if (sample.tMs > tMs) break;
    found = sample;
  }
  return found ?? timeline[0] ?? null;
}

/**
 * Times at which the HELD input changed. A facing sweep is deliberately not a
 * change: steering smoothly is exactly the case these metrics must keep in
 * their steady segment, not excuse.
 */
function heldInputChangeTimes(timeline: readonly CommandSample[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < timeline.length; i++) {
    if (!sameHeldInput(timeline[i - 1].mi, timeline[i].mi)) out.push(timeline[i].tMs);
  }
  return out;
}

function nearChange(changes: readonly number[], tMs: number, windowMs: number): boolean {
  for (const change of changes) {
    if (Math.abs(tMs - change) <= windowMs) return true;
  }
  return false;
}

interface PathPoint extends Vec2 {
  tMs: number;
  /** Arc length from the start of the polyline. */
  s: number;
}

function buildPath(
  truth: readonly GroundTruthSample[],
  commands: readonly CommandSample[],
  tickMs: number,
  tickPhaseMs: number,
): PathPoint[] {
  const commandsByClientTick = new Map(
    commands
      .filter((sample): sample is CommandSample & { ct: number } => sample.ct !== undefined)
      .map((sample) => [sample.ct, sample]),
  );
  const out: PathPoint[] = [];
  let s = 0;
  for (let i = 0; i < truth.length; i++) {
    const sample = truth[i];
    if (i > 0) s += Math.hypot(sample.x - truth[i - 1].x, sample.z - truth[i - 1].z);
    const command = sample.ct === undefined ? undefined : commandsByClientTick.get(sample.ct);
    const tMs =
      command?.samplerInterpolationAlpha === undefined
        ? sample.tick * tickMs + tickPhaseMs
        : command.tMs + DT_MS - command.samplerInterpolationAlpha * DT_MS;
    out.push({ x: sample.x, z: sample.z, tMs, s });
  }
  return out;
}

interface Projection {
  distance: number;
  s: number;
}

/** Unit direction of the last non-degenerate segment, walking from `from`
 *  toward `step`. Null when the polyline never moves. */
function endDirection(path: readonly PathPoint[], from: number, step: number): Vec2 | null {
  for (let i = from; i >= 0 && i < path.length; i += step) {
    const a = path[i];
    const b = path[i + step];
    if (!b) break;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len > 0) return { x: (dx / len) * step, z: (dz / len) * step };
  }
  return null;
}

/**
 * Closest point on the polyline: its distance and its arc length. A pose past
 * either END is projected onto the extension of the nearest real segment, so an
 * overshoot after the authority has stopped reads as progress ahead of it
 * rather than silently clamping to zero error.
 */
function projectOnPath(path: readonly PathPoint[], x: number, z: number): Projection | null {
  if (path.length === 0) return null;
  if (path.length === 1) {
    return { distance: Math.hypot(x - path[0].x, z - path[0].z), s: path[0].s };
  }
  let best: Projection | null = null;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lenSq)) : 0;
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const distance = Math.hypot(x - px, z - pz);
    if (!best || distance < best.distance) best = { distance, s: a.s + (b.s - a.s) * t };
  }
  if (!best) return null;
  const tail = path[path.length - 1];
  const head = path[0];
  // Past an end, both readings come off the EXTENSION of the last real
  // segment: the along component is progress beyond the authority, and the
  // perpendicular component is the deviation. Clamping to the end vertex
  // instead would report a pose sitting squarely on the extended line as
  // deviating by however far past the end it sits, which is not a deviation.
  if (best.s >= tail.s) {
    const direction = endDirection(path, path.length - 1, -1);
    if (direction) {
      const beyond = (x - tail.x) * direction.x + (z - tail.z) * direction.z;
      if (beyond > 0) {
        const perpendicular = Math.abs((x - tail.x) * direction.z - (z - tail.z) * direction.x);
        best = { distance: perpendicular, s: tail.s + beyond };
      }
    }
  } else if (best.s <= head.s) {
    const direction = endDirection(path, 0, 1);
    if (direction) {
      const behind = (x - head.x) * direction.x + (z - head.z) * direction.z;
      if (behind < 0) {
        const perpendicular = Math.abs((x - head.x) * direction.z - (z - head.z) * direction.x);
        best = { distance: perpendicular, s: head.s + behind };
      }
    }
  }
  return best;
}

/** Arc length the authority had reached at `tMs` (linear between ticks). */
function truthProgressAt(path: readonly PathPoint[], tMs: number): number | null {
  if (path.length === 0) return null;
  if (tMs <= path[0].tMs) return path[0].s;
  const last = path[path.length - 1];
  if (tMs >= last.tMs) return last.s;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (tMs > b.tMs) continue;
    const span = b.tMs - a.tMs;
    const f = span > 0 ? (tMs - a.tMs) / span : 0;
    return a.s + (b.s - a.s) * f;
  }
  return last.s;
}

export function computeMovementMetrics(
  drawn: readonly DrawnSample[],
  truth: readonly GroundTruthSample[],
  commands: readonly CommandSample[],
  options: MovementMetricsOptions = {},
  authorityTicks: readonly AuthorityTickSample[] = [],
): MovementMetrics {
  const tickMs = options.tickMs ?? MOVEMENT_METRICS_DEFAULTS.tickMs;
  const tickPhaseMs = options.tickPhaseMs ?? MOVEMENT_METRICS_DEFAULTS.tickPhaseMs;
  const backwardDeadbandYd =
    options.backwardDeadbandYd ?? MOVEMENT_METRICS_DEFAULTS.backwardDeadbandYd;
  const rampWindowMs = options.rampWindowMs ?? MOVEMENT_METRICS_DEFAULTS.rampWindowMs;
  const correctionAngleDeg =
    options.correctionAngleDeg ?? MOVEMENT_METRICS_DEFAULTS.correctionAngleDeg;
  const minStepYd = options.minStepYd ?? MOVEMENT_METRICS_DEFAULTS.minStepYd;

  const path = buildPath(truth, commands, tickMs, tickPhaseMs);
  const changes = heldInputChangeTimes(commands);
  const correctionCos = Math.cos((correctionAngleDeg * Math.PI) / 180);

  const backward: BackwardStepsMetric = { count: 0, worstYd: 0, samples: 0 };
  const deviation: PathDeviationMetric = { maxYd: 0, meanYd: 0, samples: 0 };
  const progress: ProgressErrorMetric = { maxAbsYd: 0, meanYd: 0, terminalYd: 0, samples: 0 };
  const speed: SpeedContinuityMetric = { maxSpeedErr: 0, maxSpeedDelta: 0, samples: 0 };
  const corrections: CorrectionEventsMetric = { count: 0, worstDeg: 0, samples: 0 };
  const inputToAuthority: InputToAuthorityMetric = { maxMs: 0, meanMs: 0, samples: 0 };
  const facingContinuity = computeFacingContinuity(drawn);
  const facingCameraSplit = computeFacingCameraSplit(drawn);
  const facingSettleError = computeFacingSettleError(drawn);
  const replayEvents = computeReplayEvents(drawn);

  let deviationSum = 0;
  let progressSum = 0;
  let previousSteadySpeed: number | null = null;

  for (let i = 0; i < drawn.length; i++) {
    const frame = drawn[i];
    const command = commandAt(commands, frame.tMs);
    if (!command) continue;
    const held = translationalHeld(command.mi);
    const direction = commandedDirection(command.mi, command.facing);

    const projection = projectOnPath(path, frame.x, frame.z);
    if (projection) {
      // Deviation is about being dragged off the line the player STEERED, so it
      // is measured only while they are steering. Progress error is measured on
      // every frame, released input included: what is left after the keys come
      // up is the settling error.
      if (held) {
        deviation.samples++;
        deviationSum += projection.distance;
        if (projection.distance > deviation.maxYd) deviation.maxYd = projection.distance;
      }
      const truthS = truthProgressAt(path, frame.tMs);
      if (truthS !== null) {
        const error = projection.s - truthS;
        progress.samples++;
        progressSum += error;
        if (Math.abs(error) > progress.maxAbsYd) progress.maxAbsYd = Math.abs(error);
        progress.terminalYd = error;
      }
    }

    if (i === 0) continue;
    const previous = drawn[i - 1];
    const dtSec = (frame.tMs - previous.tMs) / 1000;
    if (!(dtSec > 0)) continue;
    const dx = frame.x - previous.x;
    const dz = frame.z - previous.z;
    const stepLength = Math.hypot(dx, dz);

    if (held && direction) {
      const along = dx * direction.x + dz * direction.z;
      backward.samples++;
      if (along < backward.worstYd) backward.worstYd = along;
      if (along < -backwardDeadbandYd) backward.count++;
    }

    const steady = !nearChange(changes, frame.tMs, rampWindowMs);
    if (steady) {
      const drawnSpeed = stepLength / dtSec;
      const wanted = commandedSpeed(command.mi);
      speed.samples++;
      const error = Math.abs(drawnSpeed - wanted);
      if (error > speed.maxSpeedErr) speed.maxSpeedErr = error;
      if (previousSteadySpeed !== null) {
        const delta = Math.abs(drawnSpeed - previousSteadySpeed);
        if (delta > speed.maxSpeedDelta) speed.maxSpeedDelta = delta;
      }
      previousSteadySpeed = drawnSpeed;

      if (direction && stepLength >= minStepYd) {
        const cos = (dx * direction.x + dz * direction.z) / stepLength;
        corrections.samples++;
        const deg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
        if (deg > corrections.worstDeg) corrections.worstDeg = deg;
        if (cos < correctionCos) corrections.count++;
      }
    } else {
      previousSteadySpeed = null;
    }
  }

  deviation.meanYd = deviation.samples > 0 ? deviationSum / deviation.samples : 0;
  progress.meanYd = progress.samples > 0 ? progressSum / progress.samples : 0;
  const commandsByClientTick = new Map(
    commands
      .filter((sample): sample is CommandSample & { ct: number } => sample.ct !== undefined)
      .map((sample) => [sample.ct, sample]),
  );
  const measuredClientTicks = new Set<number>();
  let inputToAuthoritySum = 0;
  for (const tick of authorityTicks) {
    if (tick.consumedCt < 0 || measuredClientTicks.has(tick.consumedCt)) continue;
    const command = commandsByClientTick.get(tick.consumedCt);
    if (!command) continue;
    measuredClientTicks.add(tick.consumedCt);
    const delayMs = tick.tMs - command.tMs;
    inputToAuthority.samples++;
    inputToAuthoritySum += delayMs;
    if (delayMs > inputToAuthority.maxMs) inputToAuthority.maxMs = delayMs;
  }
  inputToAuthority.meanMs =
    inputToAuthority.samples > 0 ? inputToAuthoritySum / inputToAuthority.samples : 0;
  return {
    backwardSteps: backward,
    pathDeviation: deviation,
    progressError: progress,
    speedContinuity: speed,
    correctionEvents: corrections,
    inputToAuthorityMs: inputToAuthority,
    facingContinuity,
    facingCameraSplit,
    facingSettleError,
    replayEvents,
  };
}
