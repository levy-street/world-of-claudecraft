export const MOBILE_FRAME_RATE_CEILING_FPS = 60;

export interface FramePacerOptions {
  enabled: boolean;
  maxFps: number;
}

export interface FramePacerSnapshot {
  estimatedRefreshFps: number;
  targetFps: number;
  intentionallyPaced: boolean;
}

export interface FramePacerDecision extends FramePacerSnapshot {
  shouldRun: boolean;
}

const REFRESH_SAMPLE_COUNT = 30;
const REFRESH_CALIBRATION_SAMPLES = 8;
const REFRESH_CALIBRATION_SLACK_CALLBACKS = 4;
export const FRAME_PACER_CALIBRATION_CALLBACKS =
  REFRESH_CALIBRATION_SAMPLES + REFRESH_CALIBRATION_SLACK_CALLBACKS + 1;
export const FRAME_PACER_CALIBRATION_MAX_WAIT_MS = 500;
const MIN_REFRESH_INTERVAL_MS = 1;
const MAX_REFRESH_INTERVAL_MS = 50;
const SUSPEND_GAP_MS = 250;
const FRAME_RATE_TOLERANCE = 1.03;
const PACING_ENGAGEMENT_RATIO = 1.45;
const PACING_DISENGAGEMENT_RATIO = 1.4;
const PACING_ENGAGEMENT_EPSILON_FPS = 0.001;
const EARLY_FRAME_TOLERANCE_MS = 0.5;
const REFRESH_CHANGE_TOLERANCE = 0.12;
const TARGET_DIVISOR_RELATIVE_TOLERANCE = 0.01;
const REFRESH_CHANGE_CONFIRMATION_SAMPLES = 6;
const WORKLOAD_HEADROOM_CONFIRMATION_SAMPLES = 8;
const WORKLOAD_HEADROOM_RATIO = 0.75;
const compareNumbers = (a: number, b: number): number => a - b;

function median(values: readonly number[], scratch: number[]): number {
  scratch.length = values.length;
  for (let i = 0; i < values.length; i++) scratch[i] = values[i];
  scratch.sort(compareNumbers);
  const middle = Math.floor(scratch.length / 2);
  return scratch.length % 2 === 0 ? (scratch[middle - 1] + scratch[middle]) / 2 : scratch[middle];
}

export function pacedFrameRateFor(
  refreshFps: number,
  maxFps: number,
  pacingEngaged = false,
): number {
  if (!Number.isFinite(maxFps) || maxFps <= 0) return 0;
  if (!Number.isFinite(refreshFps) || refreshFps <= 0) return maxFps;
  const engagementRatio = pacingEngaged ? PACING_DISENGAGEMENT_RATIO : PACING_ENGAGEMENT_RATIO;
  if (refreshFps < maxFps * engagementRatio - PACING_ENGAGEMENT_EPSILON_FPS) return refreshFps;
  if (refreshFps <= maxFps * FRAME_RATE_TOLERANCE) return refreshFps;
  const divisor = Math.max(1, Math.ceil(refreshFps / (maxFps * FRAME_RATE_TOLERANCE)));
  return refreshFps / divisor;
}
function callbackRateMatchesTarget(refreshFps: number, targetFps: number): boolean {
  if (refreshFps <= 0 || targetFps <= 0) return false;
  const ratio = refreshFps / targetFps;
  const divisor = Math.round(ratio);
  if (divisor < 1) return false;
  const alignedRefreshFps = targetFps * divisor;
  return Math.abs(refreshFps / alignedRefreshFps - 1) <= TARGET_DIVISOR_RELATIVE_TOLERANCE;
}

export class FramePacer {
  private readonly enabled: boolean;
  private readonly maxFps: number;
  private lastCallbackMs: number | null = null;
  private remainderMs = 0;
  private calibrationGate = false;
  private collectCalibrationSample = false;
  private calibrationSourceRefreshFps = 0;
  private trustedRefreshFps = 0;
  private refreshMismatchSamples = 0;
  private workloadLimitedCallbackFps = 0;
  private workloadHeadroomSamples = 0;
  private refreshIntervalsMs: number[] = [];
  private readonly refreshMedianScratchMs: number[] = [];
  private estimatedRefreshFps = 0;
  private targetFps: number;
  private intentionallyPaced = false;
  private readonly stepDecision: FramePacerDecision;

  constructor(options: FramePacerOptions) {
    this.enabled = options.enabled;
    this.maxFps = Number.isFinite(options.maxFps) && options.maxFps > 0 ? options.maxFps : 60;
    this.targetFps = this.maxFps;
    this.stepDecision = {
      shouldRun: true,
      estimatedRefreshFps: 0,
      targetFps: this.targetFps,
      intentionallyPaced: false,
    };
  }

  snapshot(): FramePacerSnapshot {
    return {
      estimatedRefreshFps: this.estimatedRefreshFps,
      targetFps: this.targetFps,
      intentionallyPaced: this.intentionallyPaced,
    };
  }

  observe(nowMs: number): void {
    const callbackIntervalMs = this.captureCallbackInterval(nowMs);
    if (callbackIntervalMs === null || !this.recordRefreshInterval(callbackIntervalMs)) return;
    if (this.refreshIntervalsMs.length < REFRESH_CALIBRATION_SAMPLES) return;
    this.trustedRefreshFps = this.measuredRefreshFps();
    this.remainderMs = 0;
    this.calibrationGate = false;
    this.collectCalibrationSample = false;
    this.refreshMismatchSamples = 0;
    this.calibrationSourceRefreshFps = 0;
    this.workloadLimitedCallbackFps = 0;
    this.workloadHeadroomSamples = 0;
    this.updateRefreshEstimate();
  }

  step(nowMs: number, previousFrameWorkMs?: number): FramePacerDecision {
    if (!Number.isFinite(nowMs)) {
      this.workloadHeadroomSamples = 0;
      return this.decision(true);
    }
    const callbackIntervalMs = this.captureCallbackInterval(nowMs);
    if (callbackIntervalMs === null) {
      if (this.calibrationGate) this.collectCalibrationSample = false;
      return this.decision(true);
    }
    if (!this.enabled) return this.decision(true);
    if (this.calibrationGate) return this.stepCalibration(callbackIntervalMs);
    if (!this.recordRefreshInterval(callbackIntervalMs)) {
      this.workloadHeadroomSamples = 0;
      return this.decision(true);
    }

    if (this.refreshIntervalsMs.length < REFRESH_CALIBRATION_SAMPLES) {
      if (this.trustedRefreshFps > 0) {
        return this.stepPacing(callbackIntervalMs);
      }
      return this.decision(true);
    }
    const measuredRefreshFps = this.measuredRefreshFps();
    this.maybePromoteWorkloadLimitedCadence(measuredRefreshFps, previousFrameWorkMs);
    const hasTrustedRefresh = this.trustedRefreshFps > 0;
    const refreshRateShifted =
      hasTrustedRefresh &&
      Math.abs(measuredRefreshFps / this.trustedRefreshFps - 1) > REFRESH_CHANGE_TOLERANCE;
    const targetCadenceMisaligned =
      measuredRefreshFps > this.targetFps * (1 + TARGET_DIVISOR_RELATIVE_TOLERANCE) &&
      !callbackRateMatchesTarget(measuredRefreshFps, this.targetFps);
    const refreshChanged = hasTrustedRefresh && (refreshRateShifted || targetCadenceMisaligned);
    // A higher callback rate cannot be caused by a slow game frame, so always
    // revalidate it. Lower rates can be ambiguous: one clean probe distinguishes
    // a panel change from missed callbacks, then the observed workload-limited
    // rate suppresses repeat probes until callback throughput materially changes.
    const refreshIncreased = measuredRefreshFps > this.trustedRefreshFps;
    const knownWorkloadLimit =
      this.workloadLimitedCallbackFps > 0 &&
      Math.abs(measuredRefreshFps / this.workloadLimitedCallbackFps - 1) <=
        REFRESH_CHANGE_TOLERANCE;
    const incompatibleRate =
      refreshChanged &&
      !knownWorkloadLimit &&
      (refreshIncreased || !callbackRateMatchesTarget(measuredRefreshFps, this.targetFps));
    this.refreshMismatchSamples = incompatibleRate ? this.refreshMismatchSamples + 1 : 0;
    if (this.refreshMismatchSamples >= REFRESH_CHANGE_CONFIRMATION_SAMPLES) {
      this.beginCalibration(true, measuredRefreshFps);
      return this.decision(false);
    }
    this.updateRefreshEstimate(this.trustedRefreshFps || measuredRefreshFps);

    if (!this.intentionallyPaced) {
      this.remainderMs = 0;
      return this.decision(true);
    }

    return this.stepPacing(callbackIntervalMs);
  }

  private stepPacing(callbackIntervalMs: number): FramePacerDecision {
    const targetIntervalMs = 1000 / this.targetFps;
    this.remainderMs += callbackIntervalMs;
    if (this.remainderMs + EARLY_FRAME_TOLERANCE_MS < targetIntervalMs) {
      return this.decision(false);
    }
    this.remainderMs -= targetIntervalMs;
    if (this.remainderMs >= targetIntervalMs) this.remainderMs %= targetIntervalMs;
    return this.decision(true);
  }

  private decision(shouldRun: boolean): FramePacerDecision {
    this.stepDecision.shouldRun = shouldRun;
    this.stepDecision.estimatedRefreshFps = this.estimatedRefreshFps;
    this.stepDecision.targetFps = this.targetFps;
    this.stepDecision.intentionallyPaced = this.intentionallyPaced;
    return this.stepDecision;
  }

  private captureCallbackInterval(nowMs: number): number | null {
    if (!Number.isFinite(nowMs)) return null;
    if (this.lastCallbackMs === null) {
      this.lastCallbackMs = nowMs;
      return null;
    }
    const callbackIntervalMs = nowMs - this.lastCallbackMs;
    this.lastCallbackMs = nowMs;
    if (callbackIntervalMs <= 0 || callbackIntervalMs >= SUSPEND_GAP_MS) {
      this.remainderMs = 0;
      this.calibrationGate = this.enabled && this.trustedRefreshFps === 0;
      this.collectCalibrationSample = false;
      this.calibrationSourceRefreshFps = 0;
      this.workloadLimitedCallbackFps = 0;
      this.workloadHeadroomSamples = 0;
      this.refreshIntervalsMs = [];
      this.refreshMismatchSamples = 0;
      return null;
    }
    return callbackIntervalMs;
  }

  private recordRefreshInterval(callbackIntervalMs: number): boolean {
    if (
      callbackIntervalMs < MIN_REFRESH_INTERVAL_MS ||
      callbackIntervalMs > MAX_REFRESH_INTERVAL_MS
    ) {
      return false;
    }
    this.refreshIntervalsMs.push(callbackIntervalMs);
    if (this.refreshIntervalsMs.length > REFRESH_SAMPLE_COUNT) this.refreshIntervalsMs.shift();
    return true;
  }

  private measuredRefreshFps(): number {
    return this.refreshIntervalsMs.length > 0
      ? 1000 / median(this.refreshIntervalsMs, this.refreshMedianScratchMs)
      : 0;
  }

  private stepCalibration(callbackIntervalMs: number): FramePacerDecision {
    if (!this.collectCalibrationSample) {
      this.collectCalibrationSample = true;
      return this.decision(false);
    }
    this.collectCalibrationSample = false;
    if (!this.recordRefreshInterval(callbackIntervalMs)) {
      if (this.trustedRefreshFps === 0) {
        this.beginCalibration();
      } else {
        this.calibrationGate = false;
        this.collectCalibrationSample = false;
        this.calibrationSourceRefreshFps = 0;
      }
      return this.decision(true);
    }
    if (this.refreshIntervalsMs.length < REFRESH_CALIBRATION_SAMPLES) {
      return this.decision(true);
    }
    const previousTrustedRefreshFps = this.trustedRefreshFps;
    const calibratedRefreshFps = this.measuredRefreshFps();
    const confirmedExistingPanel =
      previousTrustedRefreshFps > 0 &&
      Math.abs(calibratedRefreshFps / previousTrustedRefreshFps - 1) <= REFRESH_CHANGE_TOLERANCE;
    this.workloadLimitedCallbackFps =
      confirmedExistingPanel && this.calibrationSourceRefreshFps > 0
        ? this.calibrationSourceRefreshFps
        : 0;
    this.calibrationSourceRefreshFps = 0;
    this.workloadHeadroomSamples = 0;
    this.trustedRefreshFps = calibratedRefreshFps;
    this.calibrationGate = false;
    this.updateRefreshEstimate();
    return this.decision(true);
  }

  private beginCalibration(nextSampleIsClean = false, sourceRefreshFps = 0): void {
    this.remainderMs = 0;
    this.refreshIntervalsMs = [];
    this.calibrationGate = true;
    this.collectCalibrationSample = nextSampleIsClean;
    this.calibrationSourceRefreshFps = sourceRefreshFps;
    this.refreshMismatchSamples = 0;
    this.workloadHeadroomSamples = 0;
  }

  private maybePromoteWorkloadLimitedCadence(
    measuredRefreshFps: number,
    previousFrameWorkMs: number | undefined,
  ): void {
    const matchesKnownWorkloadLimit =
      this.workloadLimitedCallbackFps > 0 &&
      Math.abs(measuredRefreshFps / this.workloadLimitedCallbackFps - 1) <=
        REFRESH_CHANGE_TOLERANCE;
    const hasMeasuredFrameWork =
      typeof previousFrameWorkMs === 'number' &&
      Number.isFinite(previousFrameWorkMs) &&
      previousFrameWorkMs >= 0;
    const trustedPanelIntervalMs = this.trustedRefreshFps > 0 ? 1000 / this.trustedRefreshFps : 0;
    const targetFrameIntervalMs = this.targetFps > 0 ? 1000 / this.targetFps : 0;
    const headroomLimitMs = Math.min(
      targetFrameIntervalMs * WORKLOAD_HEADROOM_RATIO,
      trustedPanelIntervalMs,
    );
    const hasHeadroom =
      matchesKnownWorkloadLimit &&
      hasMeasuredFrameWork &&
      headroomLimitMs > 0 &&
      previousFrameWorkMs <= headroomLimitMs;

    this.workloadHeadroomSamples = hasHeadroom ? this.workloadHeadroomSamples + 1 : 0;
    if (this.workloadHeadroomSamples < WORKLOAD_HEADROOM_CONFIRMATION_SAMPLES) return;

    // A clean probe can prove that slow callbacks came from missed panel refreshes,
    // but callback timing alone cannot identify a later real cap at the same rate.
    // Sustained cheap frames provide that distinction without inserting probe skips.
    this.trustedRefreshFps = measuredRefreshFps;
    this.workloadLimitedCallbackFps = 0;
    this.workloadHeadroomSamples = 0;
    this.refreshMismatchSamples = 0;
    this.remainderMs = 0;
  }

  private updateRefreshEstimate(
    refreshFps = this.trustedRefreshFps || this.measuredRefreshFps(),
  ): void {
    this.estimatedRefreshFps = refreshFps;
    this.targetFps = pacedFrameRateFor(
      this.estimatedRefreshFps,
      this.maxFps,
      this.intentionallyPaced,
    );
    this.intentionallyPaced = this.enabled && this.targetFps < this.estimatedRefreshFps - 0.5;
  }
}

export interface FramePacerCalibrationOptions<AnimationFrameHandle, TimeoutHandle> {
  now: () => number;
  requestAnimationFrame: (callback: (timestamp: number) => void) => AnimationFrameHandle;
  cancelAnimationFrame: (handle: AnimationFrameHandle) => void;
  setTimeout: (callback: () => void, delayMs: number) => TimeoutHandle;
  clearTimeout: (handle: TimeoutHandle) => void;
  maxWaitMs?: number;
}

export async function calibrateFramePacer<AnimationFrameHandle, TimeoutHandle>(
  framePacer: Pick<FramePacer, 'observe' | 'snapshot'>,
  options: FramePacerCalibrationOptions<AnimationFrameHandle, TimeoutHandle>,
): Promise<void> {
  const deadlineMs = options.now() + (options.maxWaitMs ?? FRAME_PACER_CALIBRATION_MAX_WAIT_MS);

  for (let i = 0; i < FRAME_PACER_CALIBRATION_CALLBACKS; i++) {
    const remainingWaitMs = deadlineMs - options.now();
    if (remainingWaitMs <= 0) break;

    const observedFrame = await new Promise<boolean>((resolve) => {
      let settled = false;
      let frameHandle: AnimationFrameHandle | undefined;
      const timeoutHandle = options.setTimeout(() => {
        if (settled) return;
        settled = true;
        if (frameHandle !== undefined) {
          options.cancelAnimationFrame(frameHandle);
        }
        resolve(false);
      }, remainingWaitMs);
      frameHandle = options.requestAnimationFrame((timestamp) => {
        if (settled) return;
        settled = true;
        options.clearTimeout(timeoutHandle);
        framePacer.observe(timestamp);
        resolve(true);
      });
    });

    if (!observedFrame || framePacer.snapshot().estimatedRefreshFps > 0) break;
  }
}
