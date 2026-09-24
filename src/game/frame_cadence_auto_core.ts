// The automatic Frame Rate Limit: settle, then hold. It lowers the ceiling only
// on a machine that demonstrably cannot hold its display's rhythm, and after a
// settle phase it leaves the cadence alone: the player wants a stable rhythm
// more than the last frames per second.
//
// The contract. Once settled, the cadence changes only:
// - because of something the player did (the wiring invalidates the verdict);
// - downward, when the rhythm in force is demonstrably missed;
// - through a small per-session budget of self-initiated probes, each aborted
//   within a handful of frames, never in combat or near a loading transition,
//   and only on positive evidence of headroom.
// A failed verdict is remembered across sessions (the wiring owns the storage).
//
// Two controllers share the frame: the quality governor (render_budget.ts) and
// this one. Quality is shed first: the ceiling only steps down once the governor
// has stopped shedding. While a verdict is still being formed (a provisional
// hold, a probe, the probation after a passed probe) the governor holds its
// levels, so a probe measures the scene and not quality that just came back.
// In a CONFIRMED hold the headroom goes to quality: the governor judges the
// chosen cadence through its miss share and restores what that cadence carries.
// That is also what makes the headroom evidence mean something: a machine that
// cannot restore its baseline quality at the ceiling has nothing left for a
// faster cadence, and is never asked.
//
// Readings that straddle a stall of a second or more are dropped (they are not
// readings), so the rules need whole bursts of play between stalls: the floor
// is the 120-frame recent ring. A machine stalling every second or two is read
// as paced and never limited; every three seconds or more, it is.
//
// Pure: rendered frames in, the ceiling intent out. Every threshold is a share
// of frames, a count of frames or a duration of play, never a frame time
// calibrated on a machine.

import { ceilingDivisor, type FrameCeilingIntent } from './frame_cadence_core';

/** A watch window is uneven from this share of late frames (the Iris Xe laptop
 *  reads 39 to 50 percent on the preset it cannot hold, 0 to 2 on the one it can). */
export const AUTO_UNEVEN_SHARE = 0.15;
/** A checkpoint is clean under this share. */
export const AUTO_CLEAN_SHARE = 0.05;
/** Unmistakable: this share of the last AUTO_RECENT_FRAMES steps down at the
 *  next checkpoint, without waiting for the watch window to close. */
export const AUTO_FLAGRANT_SHARE = 0.3;
export const AUTO_RECENT_FRAMES = 120;
/** The governor goes first, but not for ever: a stream still flagrant at this
 *  many checkpoints in a row steps down while it sheds (measured on a Windows
 *  HD 530: its shedding ran 16 s and changed nothing the player could see). */
export const AUTO_FLAGRANT_CHECKPOINTS_BEFORE_GOVERNOR = 3;
export const AUTO_CHECKPOINT_FRAMES = 60;
export const AUTO_WATCH_WINDOW_S = 15;
/** A descent this early in the observation is provisional: the first minute of
 *  a session is its heaviest, so it earns one confirming probe. */
export const AUTO_SETTLE_S = 60;
export const AUTO_CONFIRM_CLEAN_S = 60;
/** A provisional hold freezes the governor's recovery, so it is bounded: past
 *  this much READABLE play without its probe, the descent stands as settled.
 *  Readable: the clock advances at checkpoints, and a checkpoint needs 60 frames
 *  clear of exempt spans, so covers every few seconds stall it (as they stall
 *  the 120 s probation clock). */
export const AUTO_PROVISIONAL_MAX_S = 300;
/** A checkpoint counts toward a confirmed hold's evidence run under this
 *  share: the governor's own allowed miss share, since released it refills
 *  quality up to just under that line and a stricter one would never be met. */
export const AUTO_EVIDENCE_SHARE = 0.1;
export const AUTO_PROBE_FRAMES = 90;
/** A probe fails on this late frame: about a third of a second on the measured
 *  machines, where a full window of proof cost ten seconds of stutter. */
export const AUTO_PROBE_LATE_LIMIT = 3;
export const AUTO_PROBATION_S = 120;
export const AUTO_EVIDENCE_RUN_S = 600;
export const AUTO_MAX_FAIL_DOUBLINGS = 4;
export const AUTO_PROBES_PER_SESSION = 2;
export const AUTO_INCONCLUSIVE_PER_SESSION = 3;
/** Rendered frames after an exempt callback (a loading cover, a held world
 *  draw) that are neither read nor probed in: they still pay for the arrival. */
export const AUTO_FRAMES_CLEAR_OF_EXEMPTION = 300;
/** Fewer frames than this in a watch window is a stall or a pause, not a reading. */
const MIN_WINDOW_FRAMES = 60;

/** The frame clock's own clamp (main.ts caps its dt at a quarter second). */
const MAX_FRAME_PLAY_MS = 250;
/** An interval this long was not play: a hidden tab, a suspend, a long stall. */
const GAP_IS_NOT_PLAY_MS = 1000;

/** The play time one rendered interval is credited, in seconds, or -1 when the
 *  interval was no play at all and its readings must be dropped. */
export function frameCadencePlaySeconds(intervalMs: number): number {
  if (!(intervalMs > 0)) return 0;
  if (intervalMs >= GAP_IS_NOT_PLAY_MS) return -1;
  return Math.min(intervalMs, MAX_FRAME_PLAY_MS) / 1000;
}

export type FrameCadenceAutoPhase = 'observe' | 'held' | 'probe' | 'probation';

export interface FrameCadenceAutoState {
  phase: FrameCadenceAutoPhase;
  ceiling: FrameCeilingIntent;
  /** A held ceiling is a settled verdict (false: provisional, one probe owed). */
  confirmed: boolean;
  /** Settled for want of a probe (no budget left, or none allowed for too long):
   *  enough to release the governor, never enough to outlive the session. Its
   *  clean minute was measured AT the ceiling, so it does not say the ceiling
   *  is needed. */
  unprobed: boolean;
  /** Probes failed in a row: doubles the evidence run the next one needs. */
  failStreak: number;
  probesLeft: number;
  inconclusiveLeft: number;
  /** Seconds of play since the observation began. */
  observeS: number;
  /** The ceiling a failed probe, or a fallback on probation, returns to. */
  probeFrom: FrameCeilingIntent;
  probeConfirmedBefore: boolean;
  probeFrames: number;
  probeLate: number;
  probationS: number;
  /** Clean seconds in a provisional hold, toward its confirming probe. */
  cleanS: number;
  /** Seconds of play a provisional hold has lasted. */
  provisionalS: number;
  /** Checkpoints in a row that read flagrant. */
  flagrantStreak: number;
  /** The continuous evidence run of a confirmed hold. */
  evidenceS: number;
  recent: Uint8Array;
  recentAt: number;
  recentCount: number;
  recentLate: number;
  checkpointFrames: number;
  checkpointLate: number;
  checkpointSeconds: number;
  windowSeconds: number;
  windowFrames: number;
  windowLate: number;
  /** The late share behind the last decision (a window, a checkpoint or a probe). */
  lastShare: number;
  /** Session counters for the perf beacon. */
  descents: number;
  probesStarted: number;
  probesFailed: number;
  probesInconclusive: number;
  playS: number;
  /** Seconds of play before the first descent of the session, -1 for none. */
  firstCeilingS: number;
}

export interface FrameCadenceAutoRecord {
  ceiling: FrameCeilingIntent;
  confirmed: boolean;
  failStreak: number;
}

export function createFrameCadenceAuto(): FrameCadenceAutoState {
  return {
    phase: 'observe',
    ceiling: 0,
    confirmed: false,
    unprobed: false,
    failStreak: 0,
    probesLeft: AUTO_PROBES_PER_SESSION,
    inconclusiveLeft: AUTO_INCONCLUSIVE_PER_SESSION,
    observeS: 0,
    probeFrom: 0,
    probeConfirmedBefore: false,
    probeFrames: 0,
    probeLate: 0,
    probationS: 0,
    cleanS: 0,
    provisionalS: 0,
    flagrantStreak: 0,
    evidenceS: 0,
    recent: new Uint8Array(AUTO_RECENT_FRAMES),
    recentAt: 0,
    recentCount: 0,
    recentLate: 0,
    checkpointFrames: 0,
    checkpointLate: 0,
    checkpointSeconds: 0,
    windowSeconds: 0,
    windowFrames: 0,
    windowLate: 0,
    lastShare: 0,
    descents: 0,
    probesStarted: 0,
    probesFailed: 0,
    probesInconclusive: 0,
    playS: 0,
    firstCeilingS: -1,
  };
}

/** What is worth remembering of the state, for the wiring to store. */
export function frameCadenceAutoRecord(state: FrameCadenceAutoState): FrameCadenceAutoRecord {
  const probing = state.phase === 'probe' || state.phase === 'probation';
  return {
    ceiling: probing ? state.probeFrom : state.ceiling,
    // A probe, in flight or passed and on probation, says nothing yet about the
    // ceiling it left: the record stays the one behind it.
    confirmed: (probing ? state.probeConfirmedBefore : state.confirmed) && !state.unprobed,
    failStreak: state.failStreak,
  };
}

/** Start the session on a remembered verdict. A confirmed one starts with the
 *  quality released and owes no probe until a full evidence run. */
export function restoreFrameCadenceAuto(
  state: FrameCadenceAutoState,
  record: FrameCadenceAutoRecord,
): void {
  clearReadings(state);
  state.ceiling = record.ceiling;
  state.failStreak = Math.max(0, Math.min(AUTO_MAX_FAIL_DOUBLINGS, Math.floor(record.failStreak)));
  state.cleanS = 0;
  state.evidenceS = 0;
  state.unprobed = false;
  if (record.ceiling === 0) {
    state.phase = 'observe';
    state.confirmed = false;
    return;
  }
  state.phase = 'held';
  state.confirmed = record.confirmed;
  state.unprobed = false;
  state.provisionalS = 0;
}

/** The player changed what the verdict was formed on (a preset, the render
 *  scale, the display, the window's size class, choosing Auto again): observe
 *  from scratch, on the fast rule, with one probe given back. */
export function invalidateFrameCadenceAuto(state: FrameCadenceAutoState): void {
  clearReadings(state);
  state.phase = 'observe';
  state.ceiling = 0;
  state.confirmed = false;
  state.unprobed = false;
  state.failStreak = 0;
  state.observeS = 0;
  state.cleanS = 0;
  state.evidenceS = 0;
  state.probesLeft = Math.min(AUTO_PROBES_PER_SESSION, state.probesLeft + 1);
}

/**
 * An exempt span began or ended (a loading cover, a hidden tab, a held world
 * draw): the readings in flight straddle it and are dropped, the evidence run
 * is broken, and a probe in flight is cancelled as inconclusive. Returns true
 * when that changed the ceiling.
 */
export function resetFrameCadenceAutoWindow(state: FrameCadenceAutoState): boolean {
  clearReadings(state);
  state.evidenceS = 0;
  if (state.phase !== 'probe') return false;
  cancelProbe(state);
  return true;
}

/** The governor must hold its quality levels: a verdict is being formed. */
export function frameCadenceAutoHoldsQuality(state: FrameCadenceAutoState): boolean {
  if (state.phase === 'probe' || state.phase === 'probation') return true;
  return state.phase === 'held' && !state.confirmed;
}

function clearReadings(state: FrameCadenceAutoState): void {
  state.recentAt = 0;
  state.recentCount = 0;
  state.recentLate = 0;
  state.recent.fill(0);
  state.checkpointFrames = 0;
  state.checkpointLate = 0;
  state.checkpointSeconds = 0;
  state.windowSeconds = 0;
  state.windowFrames = 0;
  state.windowLate = 0;
}

/** The next ceiling down on this display, or the same one at the bottom. A step
 *  that changes nothing here (60 on a 60 Hz display) is skipped. */
export function autoStepDown(ceiling: FrameCeilingIntent, refreshHz: number): FrameCeilingIntent {
  if (ceiling === 0 && ceilingDivisor(refreshHz, 60) > 1) return 60;
  if (ceiling !== 30 && ceilingDivisor(refreshHz, 30) > 1) return 30;
  return ceiling;
}

export function autoStepUp(ceiling: FrameCeilingIntent, refreshHz: number): FrameCeilingIntent {
  if (ceiling === 30 && ceilingDivisor(refreshHz, 60) > 1) return 60;
  return 0;
}

export interface FrameCadenceAutoFrame {
  dtSeconds: number;
  /** The frame arrived late for the rhythm in force: a slot and a half of the
   *  display with no ceiling, its chosen slot missed under one. */
  late: boolean;
  refreshHz: number;
  /** The quality governor is still shedding: its turn, not ours. */
  governorShedding: boolean;
  /** The governor has restored its baseline quality and is idle. */
  governorAtBaseline: boolean;
  /** Out of combat for a while: a probe may cost a few frames now. */
  calm: boolean;
  /** Rendered frames since the last exempt callback. */
  framesSinceExempt: number;
}

function cancelProbe(state: FrameCadenceAutoState): void {
  state.phase = 'held';
  state.ceiling = state.probeFrom;
  state.confirmed = state.probeConfirmedBefore;
  state.probesInconclusive++;
  state.inconclusiveLeft--;
  // An inconclusive probe answered nothing, so it is not spent, up to a point.
  if (state.inconclusiveLeft > 0) state.probesLeft++;
  else state.probesLeft = 0;
  clearReadings(state);
}

function failProbe(state: FrameCadenceAutoState): void {
  state.phase = 'held';
  state.ceiling = state.probeFrom;
  state.confirmed = true;
  state.unprobed = false;
  state.failStreak = Math.min(AUTO_MAX_FAIL_DOUBLINGS, state.failStreak + 1);
  state.probesFailed++;
  state.cleanS = 0;
  state.evidenceS = 0;
  clearReadings(state);
}

function stepDown(state: FrameCadenceAutoState, refreshHz: number, fastRule: boolean): boolean {
  const down = autoStepDown(state.ceiling, refreshHz);
  if (down === state.ceiling) return false;
  // Two seconds of evidence are enough to act on and too little to settle on: a
  // stutter episode on a capable machine (streamed decor, a compile burst) reads
  // exactly like a weak one. Only the watch window, past the settle phase,
  // confirms on the spot; any other descent owes its confirming probe.
  if (fastRule) state.confirmed = false;
  else if (state.phase === 'observe') state.confirmed = state.observeS >= AUTO_SETTLE_S;
  if (!state.confirmed) state.provisionalS = 0;
  // A confirmation inherited from an unprobed hold is still unprobed one rung down.
  state.unprobed = state.unprobed && state.confirmed;
  state.flagrantStreak = 0;
  state.phase = 'held';
  state.ceiling = down;
  state.cleanS = 0;
  state.evidenceS = 0;
  state.descents++;
  if (state.firstCeilingS < 0) state.firstCeilingS = state.playS;
  clearReadings(state);
  return true;
}

/** No probe came: none left this session, or none could start for the whole
 *  bound (a long fight, a stream that never gave a clean minute). The hold
 *  settles so the governor gets its recovery back, but UNPROBED, which the
 *  record never calls confirmed. With no budget left it then stays for the
 *  session (only an invalidation gives a probe back): three cancelled probes
 *  can hold a capable machine until its next session, and nothing is stored. */
function settleUnprobedIfOverdue(state: FrameCadenceAutoState, noBudget: boolean): boolean {
  if (!noBudget && state.provisionalS < AUTO_PROVISIONAL_MAX_S) return false;
  state.confirmed = true;
  state.unprobed = true;
  return true;
}

function probeAllowed(state: FrameCadenceAutoState, frame: FrameCadenceAutoFrame): boolean {
  return (
    frame.calm &&
    !frame.governorShedding &&
    frame.framesSinceExempt >= AUTO_FRAMES_CLEAR_OF_EXEMPTION &&
    state.recentCount >= AUTO_RECENT_FRAMES &&
    state.recentLate / AUTO_RECENT_FRAMES < AUTO_CLEAN_SHARE
  );
}

function startProbe(state: FrameCadenceAutoState, refreshHz: number): void {
  state.probeFrom = state.ceiling;
  state.probeConfirmedBefore = state.confirmed;
  state.phase = 'probe';
  state.ceiling = autoStepUp(state.ceiling, refreshHz);
  state.probeFrames = 0;
  state.probeLate = 0;
  state.probesLeft--;
  state.probesStarted++;
  // The run that earned the probe is kept: a cancelled probe stays due.
  clearReadings(state);
}

function evidenceRunS(state: FrameCadenceAutoState): number {
  return AUTO_EVIDENCE_RUN_S * 2 ** Math.min(AUTO_MAX_FAIL_DOUBLINGS, state.failStreak);
}

/**
 * Feed one rendered frame (paced display only; the wiring feeds nothing when
 * the display is unread or rAF is uncapped). Returns true when the ceiling or
 * the remembered verdict changed.
 */
export function stepFrameCadenceAuto(
  state: FrameCadenceAutoState,
  frame: FrameCadenceAutoFrame,
): boolean {
  if (!(frame.dtSeconds > 0) || !(frame.refreshHz > 0)) return false;
  state.playS += frame.dtSeconds;

  if (state.phase === 'probe') {
    if (!frame.calm) {
      cancelProbe(state);
      return true;
    }
    state.probeFrames++;
    if (frame.late) state.probeLate++;
    if (state.probeLate >= AUTO_PROBE_LATE_LIMIT) {
      state.lastShare = state.probeLate / state.probeFrames;
      failProbe(state);
      return true;
    }
    if (state.probeFrames < AUTO_PROBE_FRAMES) return false;
    state.lastShare = state.probeLate / state.probeFrames;
    state.phase = 'probation';
    state.probationS = 0;
    clearReadings(state);
    return true;
  }

  if (state.phase === 'observe') state.observeS += frame.dtSeconds;
  if (state.phase === 'probation') state.probationS += frame.dtSeconds;
  // The frames after a loading cover still pay for the arrival: they are no
  // reading of what the machine holds, for a descent as for a probe.
  if (frame.framesSinceExempt < AUTO_FRAMES_CLEAR_OF_EXEMPTION) return false;

  const slot = state.recentAt;
  state.recentLate += (frame.late ? 1 : 0) - state.recent[slot];
  state.recent[slot] = frame.late ? 1 : 0;
  state.recentAt = (slot + 1) % AUTO_RECENT_FRAMES;
  if (state.recentCount < AUTO_RECENT_FRAMES) state.recentCount++;
  state.checkpointFrames++;
  state.checkpointSeconds += frame.dtSeconds;
  state.windowSeconds += frame.dtSeconds;
  state.windowFrames++;
  if (frame.late) {
    state.checkpointLate++;
    state.windowLate++;
  }

  let uneven = false;
  let fastRule = false;
  if (state.windowSeconds >= AUTO_WATCH_WINDOW_S) {
    const share = state.windowLate / Math.max(1, state.windowFrames);
    const enough = state.windowFrames >= MIN_WINDOW_FRAMES;
    state.windowSeconds = 0;
    state.windowFrames = 0;
    state.windowLate = 0;
    if (enough) {
      state.lastShare = share;
      uneven = share >= AUTO_UNEVEN_SHARE;
    }
  }

  const checkpoint = state.checkpointFrames >= AUTO_CHECKPOINT_FRAMES;
  const seconds = state.checkpointSeconds;
  const checkpointShare = state.checkpointLate / Math.max(1, state.checkpointFrames);
  const clean = checkpointShare < AUTO_CLEAN_SHARE;
  if (checkpoint) {
    state.checkpointFrames = 0;
    state.checkpointLate = 0;
    state.checkpointSeconds = 0;
  }
  if (checkpoint && state.recentCount >= AUTO_RECENT_FRAMES) {
    const share = state.recentLate / AUTO_RECENT_FRAMES;
    if (share >= AUTO_FLAGRANT_SHARE) {
      state.lastShare = share;
      state.flagrantStreak++;
      fastRule = !uneven;
      uneven = true;
    } else state.flagrantStreak = 0;
  }

  const provisional = state.phase === 'held' && !state.confirmed;
  if (checkpoint && provisional) state.provisionalS += seconds;

  if (uneven) {
    state.cleanS = 0;
    state.evidenceS = 0;
    // On probation the step up is ours to take back: no waiting for the governor.
    if (state.phase === 'probation') {
      failProbe(state);
      return true;
    }
    const governorHadItsTurn = state.flagrantStreak >= AUTO_FLAGRANT_CHECKPOINTS_BEFORE_GOVERNOR;
    if (frame.governorShedding && !governorHadItsTurn) return false;
    if (stepDown(state, frame.refreshHz, fastRule)) return true;
    // At the bottom rung there is nowhere to go, and the bound still applies: a
    // machine uneven even there must not keep the governor's recovery frozen.
    return provisional && settleUnprobedIfOverdue(state, false);
  }

  if (!checkpoint) return false;

  if (state.phase === 'probation') {
    if (state.probationS < AUTO_PROBATION_S) return false;
    // The step up held: it is the settled verdict now.
    state.failStreak = 0;
    state.cleanS = 0;
    state.evidenceS = 0;
    state.phase = state.ceiling === 0 ? 'observe' : 'held';
    state.confirmed = state.ceiling !== 0;
    state.unprobed = false;
    // A later descent from here is an ordinary one, not a first-minute one.
    state.observeS = AUTO_SETTLE_S;
    return true;
  }

  if (state.phase !== 'held') return false;

  if (!state.confirmed) {
    state.cleanS = clean ? state.cleanS + seconds : 0;
    const due = state.cleanS >= AUTO_CONFIRM_CLEAN_S;
    if (due && state.probesLeft > 0 && probeAllowed(state, frame)) {
      startProbe(state, frame.refreshHz);
      return true;
    }
    return settleUnprobedIfOverdue(state, due && state.probesLeft <= 0);
  }

  const evidence =
    checkpointShare < AUTO_EVIDENCE_SHARE && frame.governorAtBaseline && !frame.governorShedding;
  state.evidenceS = evidence ? state.evidenceS + seconds : 0;
  if (state.probesLeft <= 0 || state.evidenceS < evidenceRunS(state)) return false;
  if (!probeAllowed(state, frame)) return false;
  startProbe(state, frame.refreshHz);
  return true;
}
