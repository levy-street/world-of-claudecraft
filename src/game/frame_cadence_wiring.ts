// The thin consumer of the frame rate ceiling: it owns the frame loop's re-arm
// and answers "skip this callback?". main.ts calls it as the first statement of
// frame(), in place of its bare requestAnimationFrame, so a skipped callback
// returns before the frame clock is read and the next rendered frame
// integrates the real elapsed time, exactly as on a slower display.
//
// The gate view it is handed is the one main.ts filled on the PREVIOUS callback
// (the arm must stay the first statement, ahead of the gate refresh), so an
// exemption starts or ends one callback late. Bounded by one interval.
//
// One chain, by construction: frame() runs only from the callback armed here,
// and each run arms exactly once (a rAF, or, where the display shows no slots,
// a timer that calls frame() itself). Changing the intent never arms anything.

import { arrivalCoverActive } from '../render/arrival_cover';
import {
  cadencePlayerInCombat,
  governorIsAtBaseline,
  governorIsShedding,
  setChosenCadence,
} from '../render/chosen_cadence';
import {
  createRefreshEstimator,
  noteRefreshDelta,
  type RefreshVerdict,
  resetRefreshEstimatorWindow,
} from './display_refresh_estimator_core';
import {
  AUTO_CHECKPOINT_FRAMES,
  createFrameCadenceAuto,
  type FrameCadenceAutoFrame,
  type FrameCadenceAutoPhase,
  frameCadenceAutoHoldsQuality,
  frameCadenceAutoRecord,
  frameCadencePlaySeconds,
  invalidateFrameCadenceAuto,
  resetFrameCadenceAutoWindow,
  restoreFrameCadenceAuto,
  stepFrameCadenceAuto,
} from './frame_cadence_auto_core';
import {
  type FrameCadenceAutoMemory,
  localFrameCadenceAutoMemory,
} from './frame_cadence_auto_memory';
import { createFrameCadenceCalm, stepFrameCadenceCalm } from './frame_cadence_calm_core';
import {
  configureFrameCadence,
  createFrameCadence,
  type FrameCeilingIntent,
  frameCadenceActive,
  frameCadenceNoteExemptRender,
  frameCadenceShouldRender,
  frameCadenceSleepMs,
} from './frame_cadence_core';
import { surfaceClassChanged } from './frame_cadence_surface_core';
import {
  explicitCeilingIntent,
  FRAME_RATE_CAP_VALUES,
  type FrameRateCapReading,
  frameRateCapChoiceFromValue,
  frameRateCapReading,
} from './frame_rate_cap_setting';
import type { FrameHealthCadence } from './perf_frame_health_core';
import { SETTINGS_CHANGE_EVENT, Settings } from './settings';

/** The slice of the presentation gate input the ceiling yields to. */
export interface FrameCadenceGateView {
  hidden: boolean;
  desktopApp: boolean;
  graphicsRebuildPaused: boolean;
  worldDrawHeld: boolean;
}

export interface FrameCadenceDeps {
  requestFrame: (cb: FrameRequestCallback) => void;
  setTimer: (cb: () => void, ms: number) => void;
  /** The clock the timer's lateness is measured on (performance.now). */
  now: () => number;
  /** A loading curtain covers the world: frames are cheap there and the
   *  preparation lanes advance per frame, so skipping would lengthen loading. */
  coverActive: () => boolean;
  /** Tell the renderer the chosen interval (0 for none), its miss share, and
   *  whether the governor must hold its quality levels. */
  publish: (targetIntervalMs: number, missShare: number, holdQuality: boolean) => void;
  /** The quality governor is still shedding (the automatic mode waits for it). */
  governorShedding: () => boolean;
  /** The governor restored its baseline quality: the automatic mode's headroom evidence. */
  governorAtBaseline: () => boolean;
  /** The player is in a fight: the automatic mode never probes then. */
  inCombat: () => boolean;
  /** The drawn surface in device pixels, 0 when unknown. */
  surfacePixels: () => number;
  /** The automatic mode's remembered verdict, keyed by what would invalidate it. */
  autoMemory: FrameCadenceAutoMemory;
}

export interface FrameCadenceSnapshot {
  /** Whether the automatic mode resolves the intent. */
  auto: boolean;
  /** The estimator has seen enough callbacks since its last reset for `unknown`
   *  to mean "no display rhythm" rather than "not read yet". */
  displayRead: boolean;
  /** The automatic mode is holding the governor's recovery (a verdict is forming). */
  autoHoldsQuality: boolean;
  /** Where the automatic mode stands, 'off' under an explicit choice. */
  autoPhase: FrameCadenceAutoPhase | 'off';
  autoConfirmed: boolean;
  autoFailStreak: number;
  /** The late share behind the automatic mode's last decision. */
  autoLateShare: number;
  autoDescents: number;
  autoProbes: number;
  autoProbesFailed: number;
  autoProbesInconclusive: number;
  /** Seconds of play before the session's first automatic descent, -1 for none. */
  autoFirstCeilingS: number;
  intent: FrameCeilingIntent;
  verdict: RefreshVerdict;
  refreshHz: number;
  divisor: number;
  targetIntervalMs: number;
  missShare: number;
  rendered: number;
  skipped: number;
}

/** Every this many rendered frames, one interval is finished on bare rAF skips
 *  even in timer mode, so an `unpaced` verdict can be taken back. */
const UNPACED_REPROBE_FRAMES = 300;
/** Per-timer decay of the remembered timer lateness: the maximum of the last
 *  ten timers or so. An overestimate makes every sleep end early and the rest of
 *  the interval is then spent on zero-length timers, so it must not linger. */
const TIMER_LATENESS_DECAY = 0.9;
/** Callbacks an unread display is given on bare rAF skips before the limiter
 *  starts sleeping: several estimator recomputes' worth. */
const UNREAD_BEFORE_SLEEP = 240;

export function parseFrameCeilingIntent(search: string): FrameCeilingIntent | null {
  const raw = new URLSearchParams(search).get('fpscap');
  if (raw === null) return null;
  if (raw === '30') return 30;
  if (raw === '60') return 60;
  // Anything else is no override at all: the stored choice and its listener stay.
  return raw === 'display' ? 0 : null;
}

export class FrameCadenceWiring {
  private readonly estimator = createRefreshEstimator();
  private readonly cadence = createFrameCadence();
  private readonly autoState = createFrameCadenceAuto();
  private readonly snapshotOut: FrameCadenceSnapshot = {
    auto: false,
    displayRead: false,
    autoHoldsQuality: false,
    autoPhase: 'off',
    autoConfirmed: false,
    autoFailStreak: 0,
    autoLateShare: 0,
    autoDescents: 0,
    autoProbes: 0,
    autoProbesFailed: 0,
    autoProbesInconclusive: 0,
    autoFirstCeilingS: -1,
    intent: 0,
    verdict: 'unknown',
    refreshHz: 0,
    divisor: 1,
    targetIntervalMs: 0,
    missShare: 0,
    rendered: 0,
    skipped: 0,
  };
  private intent: FrameCeilingIntent = 0;
  private auto = false;
  private autoRestored = false;
  /** The player left Auto for an explicit choice: choosing it again re-evaluates. */
  private leftAuto = false;
  private readonly calm = createFrameCadenceCalm();
  private framesSinceExempt = 0;
  private refreshClass = 0;
  private surfaceRef = 0;
  private surfacePollIn = 0;
  private settingsSignature: string | null = null;
  private lastRenderAt = 0;
  private frameCb: FrameRequestCallback | null = null;
  private lastCallbackAt = 0;
  private lastWasIdle = false;
  private armedByTimer = false;
  private wasExempt = false;
  private rendered = 0;
  private skipped = 0;
  private reprobing = false;
  private unreadCallbacks = 0;
  private callbacksSinceEstimatorReset = 0;
  /** Whether the callback in flight has armed its successor yet. */
  armedThisCallback = false;
  private readonly autoFrame: FrameCadenceAutoFrame = {
    dtSeconds: 0,
    late: false,
    refreshHz: 0,
    governorShedding: false,
    governorAtBaseline: false,
    calm: false,
    framesSinceExempt: 0,
  };
  private timerDueAt = 0;
  private timerLateMs = 0;
  private readonly onTimer = (): void => {
    // A timer fires late, never early, and by a lot where the host's timer
    // resolution is coarse (measured on Windows: frames landing a slot late).
    // The observed lateness, held as a slowly decaying maximum, comes off the
    // next sleep, and a wake that is still early simply sleeps the remainder.
    const late = Math.max(0, this.deps.now() - this.timerDueAt);
    // Capped at half an interval, so a sleep is never under the other half: one
    // throttled tick of a second would otherwise hold the sleep at zero for
    // hundreds of timers, each waking early, skipping and re-arming.
    this.timerLateMs = Math.min(
      this.cadence.targetIntervalMs / 2,
      Math.max(late, this.timerLateMs * TIMER_LATENESS_DECAY),
    );
    this.frameCb?.(this.deps.now());
  };

  constructor(private readonly deps: FrameCadenceDeps) {}

  /** An explicit ceiling. It always wins: the automatic mode is switched off. */
  setIntent(intent: FrameCeilingIntent): void {
    if (this.auto) this.leftAuto = true;
    this.auto = false;
    this.intent = intent;
  }

  /** Let the automatic mode resolve the ceiling from what the machine holds.
   *  Choosing it again after an explicit choice means "re-evaluate now". */
  setAuto(): void {
    if (this.auto) return;
    this.auto = true;
    if (this.leftAuto) this.invalidateAuto(true);
    this.leftAuto = false;
    this.intent = this.autoState.ceiling;
  }

  /** A settings broadcast: a change to what the verdict was formed on (the
   *  memory owns which settings those are) re-opens the question. */
  noteSettingsChanged(): void {
    const signature = this.deps.autoMemory.settingsSignature();
    const before = this.settingsSignature;
    this.settingsSignature = signature;
    if (before !== null && before !== signature) this.invalidateAuto(true);
  }

  /** Forget the automatic verdict and observe again. `forget` also drops the
   *  stored one: the change happened under the same memory key. */
  private invalidateAuto(forget: boolean): void {
    invalidateFrameCadenceAuto(this.autoState);
    if (forget) this.deps.autoMemory.clear();
    this.autoRestored = false;
    if (this.auto) this.intent = 0;
  }

  /** Re-arm the loop and report whether this callback must do nothing. */
  armAndSkip(frame: FrameRequestCallback, now: number, gate: FrameCadenceGateView): boolean {
    this.armedThisCallback = false;
    this.frameCb = frame;
    const delta = now - this.lastCallbackAt;
    const crossedTimer = this.armedByTimer;
    this.armedByTimer = false;
    const exempt =
      (gate.hidden && gate.desktopApp) ||
      gate.graphicsRebuildPaused ||
      gate.worldDrawHeld ||
      this.deps.coverActive();
    if (gate.hidden || exempt !== this.wasExempt) {
      resetRefreshEstimatorWindow(this.estimator);
      this.dropAutoReadings();
      this.lastRenderAt = 0;
      this.callbacksSinceEstimatorReset = 0;
    } else {
      this.callbacksSinceEstimatorReset++;
      if (this.lastCallbackAt > 0 && !crossedTimer) {
        noteRefreshDelta(this.estimator, delta, this.lastWasIdle);
      }
    }
    this.wasExempt = exempt;
    this.lastCallbackAt = now;
    // The automatic ceiling only means something on a display whose slots can be
    // read; anywhere else Auto asks for nothing (an explicit choice still does).
    const paced = this.estimator.verdict === 'paced';
    const intent = this.auto && !paced ? 0 : this.intent;
    configureFrameCadence(this.cadence, intent, this.estimator.verdict, this.estimator.refreshMs);
    // Exempt callbacks are not paced, so nothing is published for them: the
    // governor must read a slow arrival frame as what it is.
    const holdQuality = this.auto && paced && frameCadenceAutoHoldsQuality(this.autoState);
    if (exempt) this.framesSinceExempt = 0;
    if (exempt) this.deps.publish(0, 0, holdQuality);
    else this.deps.publish(this.cadence.targetIntervalMs, this.cadence.missShare, holdQuality);
    if (exempt || !frameCadenceActive(this.cadence)) {
      if (exempt) frameCadenceNoteExemptRender(this.cadence, now);
      else {
        frameCadenceShouldRender(this.cadence, now);
        this.stepAuto(now, false);
      }
      this.lastWasIdle = false;
      if (!exempt) this.rendered++;
      this.deps.requestFrame(frame);
      this.armedThisCallback = true;
      return false;
    }
    const render = frameCadenceShouldRender(this.cadence, now);
    if (render) {
      this.rendered++;
      this.stepAuto(now, true);
    } else this.skipped++;
    this.lastWasIdle = !render;
    this.arm(frame, now, render, gate.hidden);
    return !render;
  }

  /** Feed the automatic mode one rendered frame. Only a paced display is a
   *  reading: without slots "late" has no meaning, so Auto stays where it is. */
  private stepAuto(now: number, underCeiling: boolean): void {
    const last = this.lastRenderAt;
    this.lastRenderAt = now;
    this.framesSinceExempt++;
    if (!this.auto) return;
    if (this.estimator.verdict !== 'paced') {
      if (this.autoState.recentCount > 0 || this.autoState.phase === 'probe') {
        this.dropAutoReadings();
      }
      return;
    }
    if (last === 0) return;
    const refreshMs = this.estimator.refreshMs;
    const refreshHz = 1000 / refreshMs;
    if (this.playerChangedTheSurface(refreshHz)) return;
    if (!this.autoRestored) {
      this.autoRestored = true;
      const remembered = this.deps.autoMemory.load(refreshHz);
      if (remembered !== null && remembered.ceiling !== 0) {
        restoreFrameCadenceAuto(this.autoState, remembered);
        this.intent = remembered.ceiling;
        return;
      }
    }
    // A web tab that hides stops rAF at once, and the resume callback still holds
    // the previous gate view, so the hidden span arrives here as one interval (an
    // OS suspend or a long stall likewise). It is no play time and no reading.
    // The 300-frame clearance is NOT restarted: it prices an arrival, and a gap
    // is not one (a machine whose defect is long stalls must still be read).
    const dtSeconds = frameCadencePlaySeconds(now - last);
    if (dtSeconds < 0) {
      this.dropAutoReadings();
      return;
    }
    this.autoFrame.dtSeconds = dtSeconds;
    this.autoFrame.late = underCeiling ? this.cadence.lastLate : now - last > refreshMs * 1.5;
    this.autoFrame.refreshHz = refreshHz;
    this.autoFrame.governorShedding = this.deps.governorShedding();
    this.autoFrame.governorAtBaseline = this.deps.governorAtBaseline();
    this.autoFrame.calm = stepFrameCadenceCalm(this.calm, this.deps.inCombat(), dtSeconds);
    this.autoFrame.framesSinceExempt = this.framesSinceExempt;
    if (!stepFrameCadenceAuto(this.autoState, this.autoFrame)) return;
    this.intent = this.autoState.ceiling;
    this.rememberVerdict(refreshHz);
  }

  /** Only a settled verdict outlives the session. A probe is a question, not an
   *  answer (the record is the verdict behind it), and a provisional descent is
   *  a few seconds of evidence: neither may pin the next session. */
  private rememberVerdict(refreshHz: number): void {
    const phase = this.autoState.phase;
    if (phase === 'probe' || phase === 'probation') return;
    const record = frameCadenceAutoRecord(this.autoState);
    if (record.ceiling !== 0 && !record.confirmed) return;
    this.deps.autoMemory.save(refreshHz, record);
  }

  /** Readings that straddle an exempt span, a hidden tab or an unread display
   *  are dropped, and a probe in flight there is cancelled. */
  private dropAutoReadings(): void {
    if (!resetFrameCadenceAutoWindow(this.autoState)) return;
    if (this.auto) this.intent = this.autoState.ceiling;
    if (this.estimator.refreshMs > 0) this.rememberVerdict(1000 / this.estimator.refreshMs);
  }

  /** Another display class, or a window of another size class: the verdict was
   *  formed on something else. The remembered one for a display seen before is
   *  kept (its key differs); a resize happened under the same key. */
  private playerChangedTheSurface(refreshHz: number): boolean {
    // The estimate is smoothed and can hover on a class edge (a VRR panel): the
    // class only changes once the reading is clearly inside another one.
    const held = this.refreshClass !== 0 && Math.abs(refreshHz - this.refreshClass) <= 4;
    const refreshClass = held ? this.refreshClass : Math.round(refreshHz / 5) * 5;
    const displayChanged = this.refreshClass !== 0 && refreshClass !== this.refreshClass;
    this.refreshClass = refreshClass;
    if (displayChanged) {
      this.invalidateAuto(false);
      return true;
    }
    if (--this.surfacePollIn > 0) return false;
    this.surfacePollIn = AUTO_CHECKPOINT_FRAMES;
    const pixels = this.deps.surfacePixels();
    if (this.surfaceRef === 0) this.surfaceRef = pixels;
    if (!surfaceClassChanged(this.surfaceRef, pixels)) return false;
    this.surfaceRef = pixels;
    this.invalidateAuto(true);
    return true;
  }

  snapshot(): FrameCadenceSnapshot {
    const out = this.snapshotOut;
    out.auto = this.auto;
    out.displayRead = this.callbacksSinceEstimatorReset >= UNREAD_BEFORE_SLEEP;
    out.autoHoldsQuality = this.auto && frameCadenceAutoHoldsQuality(this.autoState);
    out.autoPhase = this.auto ? this.autoState.phase : 'off';
    out.autoConfirmed = this.auto && this.autoState.confirmed && !this.autoState.unprobed;
    out.autoFailStreak = this.autoState.failStreak;
    out.autoLateShare = this.autoState.lastShare;
    out.autoDescents = this.autoState.descents;
    out.autoProbes = this.autoState.probesStarted;
    out.autoProbesFailed = this.autoState.probesFailed;
    out.autoProbesInconclusive = this.autoState.probesInconclusive;
    out.autoFirstCeilingS = this.autoState.firstCeilingS;
    out.intent = this.intent;
    out.verdict = this.estimator.verdict;
    out.refreshHz = this.estimator.refreshMs > 0 ? 1000 / this.estimator.refreshMs : 0;
    out.divisor = this.cadence.divisor;
    out.targetIntervalMs = this.cadence.targetIntervalMs;
    out.missShare = this.cadence.missShare;
    out.rendered = this.rendered;
    out.skipped = this.skipped;
    return out;
  }

  private arm(frame: FrameRequestCallback, now: number, rendered: boolean, hidden: boolean): void {
    // Paced: the skipped callback is the display's own slot, nothing to sleep.
    // Unpaced: a bare rAF re-fires at once, so sleeping is what stops a skipped
    // interval from spinning a core; the re-probe interval spins on purpose.
    const reprobe = rendered ? this.rendered % UNPACED_REPROBE_FRAMES === 0 : this.reprobing;
    this.reprobing = reprobe;
    // An unread display first gets bare rAF skips: a sleeping chain feeds the
    // estimator nothing (timer deltas are never ingested), so a paced display
    // would stay unread for good. Once enough callbacks showed no lattice, sleep.
    const unread = this.estimator.verdict === 'unknown';
    this.unreadCallbacks = unread ? this.unreadCallbacks + 1 : 0;
    // A hidden tab goes back to rAF, which the browser pauses there: a timer
    // chain would keep rendering a page nobody sees, once a second.
    const bareFrames = unread && this.unreadCallbacks < UNREAD_BEFORE_SLEEP;
    // Set only once the arm call returned: if it threw, the caller's catch must
    // still see "nothing armed" (a second rAF costs a frame, no arm is a dead client).
    if (this.cadence.paced || reprobe || bareFrames || hidden) {
      this.deps.requestFrame(frame);
      this.armedThisCallback = true;
      return;
    }
    // With no slots the timer itself starts the frame. Finishing an interval on
    // rAF skips is not free there: behind a busy GPU an idle callback waits for
    // the GPU like a real one, and each skip cost most of a frame (measured on
    // a Windows HD 530: a ceiling of 60 ran at 37 where the open loop ran at 52).
    const sleep = Math.max(0, frameCadenceSleepMs(this.cadence, now) - this.timerLateMs);
    this.timerDueAt = this.deps.now() + sleep;
    this.deps.setTimer(this.onTimer, sleep);
    this.armedByTimer = true;
    this.armedThisCallback = true;
  }
}

let shared: FrameCadenceWiring | null = null;
/** A persistent throw would log at display rate: once per session is enough. */
let reportedFailure = false;

/** What the ceiling is asked for at boot and on every settings broadcast. */
export interface FrameRateChoice {
  auto: boolean;
  intent: FrameCeilingIntent;
  fromUrl: boolean;
}

/** The stored setting value resolved against the session's `?fpscap=` override,
 *  which always wins and is never the automatic mode. */
export function resolveFrameRateChoice(storedValue: number, search: string): FrameRateChoice {
  const fromUrl = parseFrameCeilingIntent(search);
  if (fromUrl !== null) return { auto: false, intent: fromUrl, fromUrl: true };
  const intent = explicitCeilingIntent(frameRateCapChoiceFromValue(storedValue));
  return { auto: intent === null, intent: intent ?? 0, fromUrl: false };
}

function storedFrameRateCapValue(): number {
  try {
    return new Settings().get('frameRateCap');
  } catch {
    return FRAME_RATE_CAP_VALUES.display;
  }
}

function applyStoredChoice(wiring: FrameCadenceWiring, search: string): FrameRateChoice {
  const overridden = parseFrameCeilingIntent(search) !== null;
  const choice = resolveFrameRateChoice(
    overridden ? FRAME_RATE_CAP_VALUES.display : storedFrameRateCapValue(),
    search,
  );
  if (choice.auto) wiring.setAuto();
  else wiring.setIntent(choice.intent);
  return choice;
}

/**
 * The game client's one instance. The intent is the player's stored setting,
 * re-read on every settings broadcast (the row is live, and no rebuild key).
 * `?fpscap=30|60|display` overrides it for the session: the bench arm, and the
 * support kill switch. It also exposes a dev handle to toggle without a reload.
 */
export function sharedFrameCadence(): FrameCadenceWiring {
  if (shared) return shared;
  const wiring = new FrameCadenceWiring({
    requestFrame: (cb) => requestAnimationFrame(cb),
    setTimer: (cb, ms) => setTimeout(cb, ms),
    now: () => performance.now(),
    coverActive: arrivalCoverActive,
    publish: setChosenCadence,
    governorShedding: governorIsShedding,
    governorAtBaseline: governorIsAtBaseline,
    inCombat: cadencePlayerInCombat,
    surfacePixels: () =>
      typeof window === 'undefined'
        ? 0
        : window.innerWidth * window.innerHeight * (window.devicePixelRatio || 1) ** 2,
    autoMemory: localFrameCadenceAutoMemory,
  });
  const search = typeof location === 'undefined' ? '' : location.search;
  if (applyStoredChoice(wiring, search).fromUrl) {
    (globalThis as { __wocFrameCadence?: FrameCadenceWiring }).__wocFrameCadence = wiring;
    shared = wiring;
    return wiring;
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    wiring.noteSettingsChanged();
    window.addEventListener(SETTINGS_CHANGE_EVENT, () => {
      applyStoredChoice(wiring, '');
      wiring.noteSettingsChanged();
    });
  }
  // Last: a throw above must not leave a half-wired singleton behind.
  shared = wiring;
  return wiring;
}

/** frame()'s first statement in main.ts, in place of its bare re-arm. */
export function armFrameAndSkip(
  frame: FrameRequestCallback,
  now: number,
  gate: FrameCadenceGateView,
): boolean {
  // This replaced a bare requestAnimationFrame, which cannot throw. A throw in
  // here with nothing armed would freeze the client for good, so the loop's
  // survival never depends on the ceiling: re-arm plainly and render.
  let wiring: FrameCadenceWiring | null = null;
  try {
    wiring = sharedFrameCadence();
    return wiring.armAndSkip(frame, now, gate);
  } catch (err) {
    if (!wiring?.armedThisCallback) requestAnimationFrame(frame);
    if (!reportedFailure) {
      reportedFailure = true;
      console.error('[frame-cadence] the frame rate limit failed and is off', err);
    }
    return false;
  }
}

/** The perf beacon's `cadence` block (rawSummary): what tells a chosen ceiling
 *  from a struggling machine. A fresh small object per beacon, never per frame. */
export function frameCadenceBeaconBlock(): Record<string, number | string> {
  const s = sharedFrameCadence().snapshot();
  return {
    mode: s.auto ? 'auto' : 'manual',
    autoPhase: s.autoPhase,
    autoConfirmed: s.autoConfirmed ? 1 : 0,
    autoFailStreak: s.autoFailStreak,
    autoLateShare: Math.round(s.autoLateShare * 1000) / 1000,
    autoDescents: s.autoDescents,
    autoProbes: s.autoProbes,
    autoProbesFailed: s.autoProbesFailed,
    autoProbesInconclusive: s.autoProbesInconclusive,
    autoFirstCeilingS: Math.round(s.autoFirstCeilingS),
    intent: s.intent,
    verdict: s.verdict,
    refreshHz: Math.round(s.refreshHz),
    divisor: s.divisor,
    targetIntervalMs: Math.round(s.targetIntervalMs * 10) / 10,
    missShare: Math.round(s.missShare * 1000) / 1000,
    rendered: s.rendered,
    skipped: s.skipped,
  };
}

export interface FrameCadenceBeaconFields {
  frameCapIntent: FrameCeilingIntent;
  cadenceDivisor: number;
  refreshHz: number;
  targetFps: number;
}

/** The beacon's typed cadence fields, which the server stores as columns: the
 *  `cadence` block above is shed under a size squeeze, these are not. The
 *  target is the effective one, the ceiling's own rate while it is active. */
export function frameCadenceBeaconFieldsFrom(
  s: FrameCadenceSnapshot,
  budgetTargetFps: number,
): FrameCadenceBeaconFields {
  return {
    frameCapIntent: s.intent,
    cadenceDivisor: s.divisor,
    refreshHz: Math.round(s.refreshHz),
    targetFps: s.targetIntervalMs > 0 ? Math.round(1000 / s.targetIntervalMs) : budgetTargetFps,
  };
}

export function frameCadenceBeaconFields(budgetTargetFps: number): FrameCadenceBeaconFields {
  return frameCadenceBeaconFieldsFrom(sharedFrameCadence().snapshot(), budgetTargetFps);
}

/** One `?perf` overlay line (dev diagnostics, English like the rest of it). */
export function frameCadenceOverlayLine(): string {
  const s = sharedFrameCadence().snapshot();
  const phase = s.autoPhase === 'held' && s.autoHoldsQuality ? 'settling' : s.autoPhase;
  const cap = `${s.auto ? `auto-${phase} ` : ''}${s.intent === 0 ? 'display' : s.intent}`;
  const target =
    s.targetIntervalMs > 0 ? `${s.targetIntervalMs.toFixed(1)}ms /${s.divisor}` : 'inert';
  return `cap ${cap}  ${s.verdict} ${s.refreshHz.toFixed(1)}Hz  ${target}  miss ${(s.missShare * 100).toFixed(1)}%  skip ${s.skipped}`;
}

/** The options row's reading for a stored value, on the display as read now. */
export function frameRateCapRowReading(storedValue: number): FrameRateCapReading {
  const s = sharedFrameCadence().snapshot();
  const explicit = explicitCeilingIntent(frameRateCapChoiceFromValue(storedValue));
  // Auto reads what it is doing right now, which is only known while it runs.
  const intent = explicit ?? (s.auto ? s.intent : 0);
  return frameRateCapReading(intent, s.verdict, s.refreshHz, s.displayRead);
}

/** The chosen cadence for the frame-health readers, or null when there is none.
 *  A fresh small object per perf snapshot (1 Hz), never per frame. */
export function frameCadenceHealth(): FrameHealthCadence | null {
  const s = sharedFrameCadence().snapshot();
  if (!(s.targetIntervalMs > 0)) return null;
  return { targetIntervalMs: s.targetIntervalMs, missShare: s.missShare, auto: s.auto };
}
