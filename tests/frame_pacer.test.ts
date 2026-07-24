import { describe, expect, it } from 'vitest';
import {
  calibrateFramePacer,
  FRAME_PACER_CALIBRATION_CALLBACKS,
  FRAME_PACER_CALIBRATION_MAX_WAIT_MS,
  FramePacer,
  MOBILE_FRAME_RATE_CEILING_FPS,
  pacedFrameRateFor,
} from '../src/game/frame_pacer';

function stepAtRate(
  pacer: FramePacer,
  sourceFps: number,
  callbacks: number,
  startMs = 0,
  previousFrameWorkMs?: number,
): { nowMs: number; rendered: number; maxConsecutiveSkips: number } {
  let nowMs = startMs;
  let rendered = 0;
  let consecutiveSkips = 0;
  let maxConsecutiveSkips = 0;
  const intervalMs = 1000 / sourceFps;
  for (let i = 0; i < callbacks; i++) {
    nowMs += intervalMs;
    if (pacer.step(nowMs, previousFrameWorkMs).shouldRun) {
      rendered++;
      consecutiveSkips = 0;
    } else {
      consecutiveSkips++;
      maxConsecutiveSkips = Math.max(maxConsecutiveSkips, consecutiveSkips);
    }
  }
  return { nowMs, rendered, maxConsecutiveSkips };
}

function stepWithMissedVsyncWork(
  pacer: FramePacer,
  panelFps: number,
  callbacks: number,
  startMs: number,
  runIntervalMultiplier = 2,
  previousFrameWorkMs?: number,
): {
  nowMs: number;
  rendered: number;
  elapsedMs: number;
  maxConsecutiveSkips: number;
} {
  let nowMs = startMs;
  let rendered = 0;
  let consecutiveSkips = 0;
  let maxConsecutiveSkips = 0;
  let previousFrameRan = false;
  const panelIntervalMs = 1000 / panelFps;

  for (let i = 0; i < callbacks; i++) {
    nowMs += panelIntervalMs * (previousFrameRan ? runIntervalMultiplier : 1);
    const decision = pacer.step(nowMs, previousFrameWorkMs);
    previousFrameRan = decision.shouldRun;
    if (decision.shouldRun) {
      rendered++;
      consecutiveSkips = 0;
    } else {
      consecutiveSkips++;
      maxConsecutiveSkips = Math.max(maxConsecutiveSkips, consecutiveSkips);
    }
  }

  return { nowMs, rendered, elapsedMs: nowMs - startMs, maxConsecutiveSkips };
}

function observeAtRate(pacer: FramePacer, sourceFps: number, startMs = 0): number {
  let nowMs = startMs;
  for (let i = 0; i < FRAME_PACER_CALIBRATION_CALLBACKS; i++) {
    nowMs += 1000 / sourceFps;
    pacer.observe(nowMs);
    if (pacer.snapshot().estimatedRefreshFps > 0) break;
  }
  return nowMs;
}

function steadyCallbackGaps(
  pacer: FramePacer,
  sourceFps: number,
  callbacks: number,
  startMs: number,
) {
  const intervalMs = 1000 / sourceFps;
  const executed: number[] = [];
  let nowMs = startMs;
  for (let i = 0; i < callbacks; i++) {
    nowMs += intervalMs;
    if (pacer.step(nowMs).shouldRun) executed.push(i);
  }
  return executed.slice(1).map((index, i) => index - executed[i]);
}

describe('mobile frame pacer', () => {
  it('keeps the loading calibration window bounded', () => {
    expect(FRAME_PACER_CALIBRATION_CALLBACKS).toBe(13);
    expect(FRAME_PACER_CALIBRATION_MAX_WAIT_MS).toBe(500);
  });

  it('caps the configured mobile pacing policy at exactly 60 fps', () => {
    expect(MOBILE_FRAME_RATE_CEILING_FPS).toBe(60);
  });

  it('reuses one decision record across animation callbacks', () => {
    const pacer = new FramePacer({ enabled: false, maxFps: 60 });

    const first = pacer.step(0);
    const second = pacer.step(1000 / 60);

    expect(second).toBe(first);
    expect(second).toEqual({
      shouldRun: true,
      estimatedRefreshFps: 0,
      targetFps: 60,
      intentionallyPaced: false,
    });
  });

  it('cancels calibration at the wall-clock deadline when animation callbacks stop', async () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    const animationCallbacks = new Map<number, (timestamp: number) => void>();
    const timeoutCallbacks = new Map<number, () => void>();
    const cancelledFrames: number[] = [];
    const clearedTimeouts: number[] = [];
    const timeoutDelays: number[] = [];
    let nowMs = 100;
    let nextFrameId = 1;
    let nextTimeoutId = 1;

    const calibration = calibrateFramePacer(pacer, {
      now: () => nowMs,
      requestAnimationFrame: (callback) => {
        const id = nextFrameId++;
        animationCallbacks.set(id, callback);
        return id;
      },
      cancelAnimationFrame: (id) => {
        cancelledFrames.push(id);
        animationCallbacks.delete(id);
      },
      setTimeout: (callback, delayMs) => {
        const id = nextTimeoutId++;
        timeoutCallbacks.set(id, callback);
        timeoutDelays.push(delayMs);
        return id;
      },
      clearTimeout: (id) => {
        clearedTimeouts.push(id);
        timeoutCallbacks.delete(id);
      },
    });

    expect(animationCallbacks.size).toBe(1);
    expect(timeoutDelays).toEqual([FRAME_PACER_CALIBRATION_MAX_WAIT_MS]);

    nowMs += FRAME_PACER_CALIBRATION_MAX_WAIT_MS;
    timeoutCallbacks.get(1)?.();
    await calibration;

    expect(cancelledFrames).toEqual([1]);
    expect(clearedTimeouts).toEqual([]);
    expect(animationCallbacks.size).toBe(0);
    expect(pacer.snapshot().estimatedRefreshFps).toBe(0);
  });

  it('selects the highest panel divisor at or below the frame-rate ceiling', () => {
    expect(pacedFrameRateFor(60, 60)).toBeCloseTo(60);
    expect(pacedFrameRateFor(61.9, 60)).toBeCloseTo(61.9);
    expect(pacedFrameRateFor(72, 60)).toBeCloseTo(72);
    expect(pacedFrameRateFor(75, 60)).toBeCloseTo(75);
    expect(pacedFrameRateFor(89.9, 60)).toBeCloseTo(44.95);
    expect(pacedFrameRateFor(90, 60)).toBeCloseTo(45);
    expect(pacedFrameRateFor(120, 60)).toBeCloseTo(60);
    expect(pacedFrameRateFor(144, 60)).toBeCloseTo(48);
    expect(pacedFrameRateFor(165, 60)).toBeCloseTo(55);
  });

  it('uses hysteresis around the high-refresh engagement boundary', () => {
    expect(pacedFrameRateFor(86, 60)).toBeCloseTo(86);
    expect(pacedFrameRateFor(86, 60, true)).toBeCloseTo(43);
    expect(pacedFrameRateFor(83.9, 60, true)).toBeCloseTo(83.9);
  });

  it('keeps the configured mobile pacing policy above the 30 fps fairness floor', () => {
    for (let refreshFps = 30; refreshFps <= 480; refreshFps += 0.1) {
      expect(pacedFrameRateFor(refreshFps, MOBILE_FRAME_RATE_CEILING_FPS)).toBeGreaterThanOrEqual(
        30,
      );
    }
  });

  it('keeps executed frames on exact whole-panel-divisor spacing', () => {
    for (const [sourceFps, expectedGap] of [
      [90, 2],
      [120, 2],
      [144, 3],
      [165, 3],
      [240, 4],
      [360, 6],
    ] as const) {
      const pacer = new FramePacer({ enabled: true, maxFps: 60 });
      const calibratedAt = observeAtRate(pacer, sourceFps);
      const warmup = stepAtRate(pacer, sourceFps, 60, calibratedAt);
      const gaps = steadyCallbackGaps(pacer, sourceFps, 90, warmup.nowMs);
      expect(new Set(gaps), `${sourceFps} Hz cadence`).toEqual(new Set([expectedGap]));
    }
  });

  it('caps future high-refresh touch displays instead of rejecting sub-4ms callbacks', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    const calibratedAt = observeAtRate(pacer, 360);
    const warmup = stepAtRate(pacer, 360, 120, calibratedAt);
    const steady = stepAtRate(pacer, 360, 360, warmup.nowMs);

    expect(steady.rendered).toBeGreaterThanOrEqual(59);
    expect(steady.rendered).toBeLessThanOrEqual(61);
    expect(pacer.snapshot().targetFps).toBeCloseTo(60, 0);
  });

  it('renders every callback when pacing is disabled', () => {
    const pacer = new FramePacer({ enabled: false, maxFps: 60 });
    const result = stepAtRate(pacer, 120, 240);

    expect(result.rendered).toBe(240);
    expect(pacer.snapshot().intentionallyPaced).toBe(false);
  });

  it('decimates 120 Hz callbacks to a stable 60 fps cadence', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    const warmup = stepAtRate(pacer, 120, 30);
    const steady = stepAtRate(pacer, 120, 240, warmup.nowMs);
    const snapshot = pacer.snapshot();

    expect(steady.rendered).toBeGreaterThanOrEqual(119);
    expect(steady.rendered).toBeLessThanOrEqual(121);
    expect(snapshot.estimatedRefreshFps).toBeCloseTo(120, 0);
    expect(snapshot.targetFps).toBeCloseTo(60, 0);
    expect(snapshot.intentionallyPaced).toBe(true);
  });

  it('uses 45 fps on a 90 Hz panel instead of a juddering 60 fps pattern', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    const warmup = stepAtRate(pacer, 90, 30);
    const steady = stepAtRate(pacer, 90, 180, warmup.nowMs);
    const snapshot = pacer.snapshot();

    expect(steady.rendered).toBeGreaterThanOrEqual(89);
    expect(steady.rendered).toBeLessThanOrEqual(91);
    expect(snapshot.estimatedRefreshFps).toBeCloseTo(90, 0);
    expect(snapshot.targetFps).toBeCloseTo(45, 0);
  });

  it('holds pacing through calibration noise and releases below the hysteresis band', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    let nowMs = observeAtRate(pacer, 89.9);

    nowMs += 1_000;
    pacer.step(nowMs);
    for (let i = 0; i < 9; i++) {
      nowMs += 1000 / 86;
      pacer.observe(nowMs);
    }
    expect(pacer.snapshot().estimatedRefreshFps).toBeCloseTo(86, 0);
    expect(pacer.snapshot().targetFps).toBeCloseTo(43, 0);
    expect(pacer.snapshot().intentionallyPaced).toBe(true);

    nowMs += 1_000;
    pacer.step(nowMs);
    for (let i = 0; i < 9; i++) {
      nowMs += 1000 / 83;
      pacer.observe(nowMs);
    }
    expect(pacer.snapshot().estimatedRefreshFps).toBeCloseTo(83, 0);
    expect(pacer.snapshot().targetFps).toBeCloseTo(83, 0);
    expect(pacer.snapshot().intentionallyPaced).toBe(false);
  });

  it('keeps a 60 Hz source at 60 fps without unnecessary decimation', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    const result = stepAtRate(pacer, 60, 120);
    const snapshot = pacer.snapshot();

    expect(result.rendered).toBe(120);
    expect(snapshot.estimatedRefreshFps).toBeCloseTo(60, 0);
    expect(snapshot.targetFps).toBeCloseTo(60, 0);
    expect(snapshot.intentionallyPaced).toBe(false);
  });

  it('does not decimate an existing 30 fps browser or low-power cap', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    const result = stepAtRate(pacer, 30, 120);
    const snapshot = pacer.snapshot();

    expect(result.rendered).toBe(120);
    expect(snapshot.estimatedRefreshFps).toBeCloseTo(30, 0);
    expect(snapshot.targetFps).toBeCloseTo(30, 0);
    expect(snapshot.intentionallyPaced).toBe(false);
  });

  it('does not repeatedly recalibrate a trusted panel when work is below the target', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    const calibratedAt = observeAtRate(pacer, 120);
    const workloadLimited = stepWithMissedVsyncWork(pacer, 120, 1_200, calibratedAt, 4);
    const recovered = stepAtRate(pacer, 120, 90, workloadLimited.nowMs);
    const recoveredGaps = steadyCallbackGaps(pacer, 120, 120, recovered.nowMs);

    expect(1_200 - workloadLimited.rendered).toBeLessThanOrEqual(10);
    expect(workloadLimited.maxConsecutiveSkips).toBeLessThanOrEqual(1);
    expect(pacer.snapshot().estimatedRefreshFps).toBeCloseTo(120, 0);
    expect(pacer.snapshot().targetFps).toBeCloseTo(60, 0);
    expect(pacer.snapshot().intentionallyPaced).toBe(true);
    expect(new Set(recoveredGaps)).toEqual(new Set([2]));
  });

  it('preserves the trusted panel when measured work explains missed source callbacks', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    const calibratedAt = observeAtRate(pacer, 144);
    const workloadLimited = stepWithMissedVsyncWork(pacer, 144, 1_200, calibratedAt, 2, 7);
    const snapshot = pacer.snapshot();

    expect(workloadLimited.maxConsecutiveSkips).toBeLessThanOrEqual(2);
    expect(snapshot.estimatedRefreshFps).toBeCloseTo(144, 0);
    expect(snapshot.targetFps).toBeCloseTo(48, 0);
  });

  it('distinguishes 144 Hz workload misses from a real unpaced 72 Hz callback cap', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    const calibratedAt = observeAtRate(pacer, 144);
    const workloadLimited = stepWithMissedVsyncWork(pacer, 144, 1_200, calibratedAt, 2, 7);

    expect(pacer.snapshot().estimatedRefreshFps).toBeCloseTo(144, 0);
    expect(pacer.snapshot().targetFps).toBeCloseTo(48, 0);
    expect(workloadLimited.maxConsecutiveSkips).toBeLessThanOrEqual(2);

    const transition = stepAtRate(pacer, 72, 180, workloadLimited.nowMs, 6.9);
    const gaps = steadyCallbackGaps(pacer, 72, 180, transition.nowMs);
    const snapshot = pacer.snapshot();

    expect(snapshot.estimatedRefreshFps).toBeCloseTo(72, 0);
    expect(snapshot.targetFps).toBeCloseTo(72, 0);
    expect(snapshot.intentionallyPaced).toBe(false);
    expect(new Set(gaps)).toEqual(new Set([1]));
  });

  it.each([
    { workloadMultiplier: 4 / 3, cappedFps: 90, frameWorkMs: 8.3, targetFps: 45, expectedGap: 2 },
    { workloadMultiplier: 4, cappedFps: 30, frameWorkMs: 8.3, targetFps: 30, expectedGap: 1 },
  ])(
    'promotes a real $cappedFps Hz cap after learning the same workload-limited cadence',
    ({ workloadMultiplier, cappedFps, frameWorkMs, targetFps, expectedGap }) => {
      const pacer = new FramePacer({ enabled: true, maxFps: 60 });
      const calibratedAt = observeAtRate(pacer, 120);
      const workloadLimited = stepWithMissedVsyncWork(
        pacer,
        120,
        1_200,
        calibratedAt,
        workloadMultiplier,
      );

      expect(pacer.snapshot().estimatedRefreshFps).toBeCloseTo(120, 0);
      expect(pacer.snapshot().targetFps).toBeCloseTo(60, 0);
      expect(workloadLimited.maxConsecutiveSkips).toBeLessThanOrEqual(1);

      const transition = stepAtRate(pacer, cappedFps, 180, workloadLimited.nowMs, frameWorkMs);
      const gaps = steadyCallbackGaps(pacer, cappedFps, 180, transition.nowMs);
      const snapshot = pacer.snapshot();

      expect(snapshot.estimatedRefreshFps).toBeCloseTo(cappedFps, 0);
      expect(snapshot.targetFps).toBeCloseTo(targetFps, 0);
      expect(new Set(gaps)).toEqual(new Set([expectedGap]));
    },
  );

  it('requires uninterrupted frame-work headroom before promoting a real callback cap', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    const calibratedAt = observeAtRate(pacer, 120);
    const workloadLimited = stepWithMissedVsyncWork(pacer, 120, 1_200, calibratedAt, 4);
    const partialHeadroom = stepAtRate(pacer, 30, 7, workloadLimited.nowMs, 8.3);
    const stalledAt = partialHeadroom.nowMs + 75;

    expect(pacer.step(stalledAt, 8.3).shouldRun).toBe(true);
    const afterOneFreshSample = stepAtRate(pacer, 30, 1, stalledAt, 8.3);
    expect(pacer.snapshot().estimatedRefreshFps).toBeCloseTo(120, 0);

    const completedHeadroom = stepAtRate(pacer, 30, 7, afterOneFreshSample.nowMs, 8.3);
    const snapshot = pacer.snapshot();

    expect(completedHeadroom.maxConsecutiveSkips).toBe(0);
    expect(snapshot.estimatedRefreshFps).toBeCloseTo(30, 0);
    expect(snapshot.targetFps).toBeCloseTo(30, 0);
  });

  it('uses target-interval headroom when deciding whether to promote a learned cap', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    const calibratedAt = observeAtRate(pacer, 45);
    const workloadLimited = stepWithMissedVsyncWork(pacer, 45, 1_200, calibratedAt, 2);

    expect(pacer.snapshot().estimatedRefreshFps).toBeCloseTo(45, 0);
    const expensiveFrames = stepAtRate(pacer, 22.5, 16, workloadLimited.nowMs, 20);
    expect(pacer.snapshot().estimatedRefreshFps).toBeCloseTo(45, 0);

    stepAtRate(pacer, 22.5, 8, expensiveFrames.nowMs, 10);
    const promoted = pacer.snapshot();
    expect(promoted.estimatedRefreshFps).toBeCloseTo(22.5, 0);
    expect(promoted.targetFps).toBeCloseTo(22.5, 0);
  });

  it('does not revalidate after five incompatible callback samples', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    const calibratedAt = observeAtRate(pacer, 60);

    const transientNoise = stepAtRate(pacer, 120, 12, calibratedAt);

    expect(transientNoise.rendered).toBe(12);
    expect(pacer.snapshot().estimatedRefreshFps).toBeCloseTo(60, 0);
  });

  it('tolerates a delayed loading callback and still establishes trusted calibration', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    let nowMs = 0;
    for (let i = 0; i < FRAME_PACER_CALIBRATION_CALLBACKS; i++) {
      nowMs += i === 4 ? 75 : 1000 / 60;
      pacer.observe(nowMs);
    }

    expect(pacer.snapshot().estimatedRefreshFps).toBeCloseTo(60, 0);
    expect(pacer.snapshot().targetFps).toBeCloseTo(60, 0);
  });

  it('finishes trusted loading calibration after the sampler is suspended', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    let nowMs = 0;
    nowMs += 1000 / 144;
    pacer.observe(nowMs);
    nowMs += 1000 / 144;
    pacer.observe(nowMs);
    nowMs += 1_000;
    pacer.observe(nowMs);

    for (let i = 0; i < FRAME_PACER_CALIBRATION_CALLBACKS; i++) {
      nowMs += 1000 / 144;
      pacer.observe(nowMs);
      if (pacer.snapshot().estimatedRefreshFps > 0) break;
    }

    const snapshot = pacer.snapshot();
    const gaps = steadyCallbackGaps(pacer, 144, 45, nowMs);
    expect(snapshot.estimatedRefreshFps).toBeCloseTo(144, 0);
    expect(snapshot.targetFps).toBeCloseTo(48, 0);
    expect(new Set(gaps)).toEqual(new Set([3]));
  });

  it('carries timing remainder instead of drifting under callback jitter', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    const jitterMs = [7.7, 8.8, 8.1, 8.6, 8.2, 8.5];
    let nowMs = 0;
    let rendered = 0;

    for (let i = 0; i < 36; i++) {
      nowMs += jitterMs[i % jitterMs.length];
      pacer.step(nowMs);
    }
    const measuredMs = 5000;
    const endMs = nowMs + measuredMs;
    let i = 0;
    while (nowMs < endMs) {
      nowMs += jitterMs[i++ % jitterMs.length];
      if (pacer.step(nowMs).shouldRun) rendered++;
    }

    expect(rendered).toBeGreaterThanOrEqual(298);
    expect(rendered).toBeLessThanOrEqual(302);
  });

  it('preserves loading-screen panel calibration when frame work misses source callbacks', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    let nowMs = 0;
    for (let i = 0; i < 9; i++) {
      nowMs += 1000 / 144;
      pacer.observe(nowMs);
    }

    const workloadLimited = stepWithMissedVsyncWork(pacer, 144, 600, nowMs);
    const snapshot = pacer.snapshot();
    const effectiveFps = (workloadLimited.rendered * 1000) / workloadLimited.elapsedMs;

    expect(effectiveFps).toBeGreaterThanOrEqual(47);
    expect(effectiveFps).toBeLessThanOrEqual(49);
    expect(snapshot.estimatedRefreshFps).toBeCloseTo(144, 0);
    expect(snapshot.targetFps).toBeCloseTo(48, 0);
    expect(snapshot.intentionallyPaced).toBe(true);
  });

  it('recalibrates upward when the browser callback rate increases', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    const slow = stepAtRate(pacer, 60, 90);

    const transition = stepAtRate(pacer, 120, 60, slow.nowMs);
    const steady = stepAtRate(pacer, 120, 120, transition.nowMs);
    const snapshot = pacer.snapshot();

    expect(steady.rendered).toBeGreaterThanOrEqual(59);
    expect(steady.rendered).toBeLessThanOrEqual(61);
    expect(snapshot.estimatedRefreshFps).toBeCloseTo(120, 0);
    expect(snapshot.targetFps).toBeCloseTo(60, 0);
  });

  it('recalibrates upward when gameplay raises a trusted 60 Hz loading cadence to 120 Hz', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    let nowMs = 0;
    for (let i = 0; i < FRAME_PACER_CALIBRATION_CALLBACKS; i++) {
      nowMs += 1000 / 60;
      pacer.observe(nowMs);
    }

    const transition = stepAtRate(pacer, 120, 90, nowMs);
    const steady = stepAtRate(pacer, 120, 120, transition.nowMs);
    const snapshot = pacer.snapshot();

    expect(transition.maxConsecutiveSkips).toBeLessThanOrEqual(1);
    expect(steady.rendered).toBeGreaterThanOrEqual(59);
    expect(steady.rendered).toBeLessThanOrEqual(61);
    expect(snapshot.estimatedRefreshFps).toBeCloseTo(120, 0);
    expect(snapshot.targetFps).toBeCloseTo(60, 0);
    expect(snapshot.intentionallyPaced).toBe(true);
  });

  it('recalibrates when a trusted 30 Hz low-power cadence returns to 120 Hz', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    let nowMs = 0;
    for (let i = 0; i < FRAME_PACER_CALIBRATION_CALLBACKS; i++) {
      nowMs += 1000 / 30;
      pacer.observe(nowMs);
    }

    const transition = stepAtRate(pacer, 120, 90, nowMs);
    const steady = stepAtRate(pacer, 120, 120, transition.nowMs);
    const snapshot = pacer.snapshot();

    expect(transition.maxConsecutiveSkips).toBeLessThanOrEqual(1);
    expect(steady.rendered).toBeGreaterThanOrEqual(59);
    expect(steady.rendered).toBeLessThanOrEqual(61);
    expect(snapshot.estimatedRefreshFps).toBeCloseTo(120, 0);
    expect(snapshot.targetFps).toBeCloseTo(60, 0);
    expect(snapshot.intentionallyPaced).toBe(true);
  });

  it('revalidates a promoted callback cap when its rate changes again', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    const calibratedAt = observeAtRate(pacer, 120);
    const workloadLimited = stepWithMissedVsyncWork(pacer, 120, 1_200, calibratedAt, 4 / 3);
    const promoted = stepAtRate(pacer, 90, 180, workloadLimited.nowMs, 8.3);

    expect(pacer.snapshot().estimatedRefreshFps).toBeCloseTo(90, 0);
    const transition = stepAtRate(pacer, 80, 180, promoted.nowMs);
    const warmup = stepAtRate(pacer, 80, 120, transition.nowMs);
    const gaps = steadyCallbackGaps(pacer, 80, 180, warmup.nowMs);
    const snapshot = pacer.snapshot();

    expect(snapshot.estimatedRefreshFps).toBeCloseTo(80, 0);
    expect(snapshot.targetFps).toBeCloseTo(80, 0);
    expect(snapshot.intentionallyPaced).toBe(false);
    expect(new Set(gaps)).toEqual(new Set([1]));
  });

  it.each([
    { fromFps: 90, toFps: 80, targetFps: 80, expectedGap: 1 },
    { fromFps: 90, toFps: 48, targetFps: 48, expectedGap: 1 },
    { fromFps: 144, toFps: 132, targetFps: 44, expectedGap: 3 },
    { fromFps: 360, toFps: 320, targetFps: 320 / 6, expectedGap: 6 },
  ])(
    'revalidates a nearby $fromFps Hz to $toFps Hz transition',
    ({ fromFps, toFps, targetFps, expectedGap }) => {
      const pacer = new FramePacer({ enabled: true, maxFps: 60 });
      const calibratedAt = observeAtRate(pacer, fromFps);
      const sourceSteady = stepAtRate(pacer, fromFps, 60, calibratedAt);
      const transition = stepAtRate(pacer, toFps, 180, sourceSteady.nowMs);
      const warmup = stepAtRate(pacer, toFps, 120, transition.nowMs);
      const gaps = steadyCallbackGaps(pacer, toFps, 180, warmup.nowMs);
      const snapshot = pacer.snapshot();

      expect(snapshot.estimatedRefreshFps).toBeCloseTo(toFps, 0);
      expect(snapshot.targetFps).toBeCloseTo(targetFps, 0);
      expect(new Set(gaps)).toEqual(new Set([expectedGap]));
    },
  );

  it('revalidates a trusted high refresh rate after a sustained panel drop', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    let nowMs = 0;
    for (let i = 0; i < 9; i++) {
      nowMs += 1000 / 144;
      pacer.observe(nowMs);
    }

    const transition = stepAtRate(pacer, 60, 120, nowMs);
    const steady = stepAtRate(pacer, 60, 60, transition.nowMs);
    const snapshot = pacer.snapshot();

    expect(steady.rendered).toBe(60);
    expect(transition.maxConsecutiveSkips).toBeLessThanOrEqual(1);
    expect(snapshot.estimatedRefreshFps).toBeCloseTo(60, 0);
    expect(snapshot.targetFps).toBeCloseTo(60, 0);
    expect(snapshot.intentionallyPaced).toBe(false);
  });

  it('revalidates upward when faster gameplay callbacks are workload-limited', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    let nowMs = 0;
    for (let i = 0; i < 9; i++) {
      nowMs += 1000 / 60;
      pacer.observe(nowMs);
    }

    const workloadLimited = stepWithMissedVsyncWork(pacer, 90, 400, nowMs);
    const snapshot = pacer.snapshot();
    const effectiveFps = (workloadLimited.rendered * 1000) / workloadLimited.elapsedMs;

    expect(effectiveFps).toBeGreaterThanOrEqual(44);
    expect(effectiveFps).toBeLessThanOrEqual(46);
    expect(snapshot.estimatedRefreshFps).toBeCloseTo(90, 0);
    expect(snapshot.targetFps).toBeCloseTo(45, 0);
    expect(snapshot.intentionallyPaced).toBe(true);
  });

  it('recalibrates after the browser callback rate changes', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    const fast = stepAtRate(pacer, 120, 90);

    const transition = stepAtRate(pacer, 60, 60, fast.nowMs);
    const steady = stepAtRate(pacer, 60, 60, transition.nowMs);
    const snapshot = pacer.snapshot();

    expect(steady.rendered).toBe(60);
    expect(snapshot.estimatedRefreshFps).toBeCloseTo(60, 0);
    expect(snapshot.targetFps).toBeCloseTo(60, 0);
    expect(snapshot.intentionallyPaced).toBe(false);
  });

  it('revalidates fresh callback samples without an unpaced burst after suspension', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    const calibratedAt = observeAtRate(pacer, 90);
    const sourceSteady = stepAtRate(pacer, 90, 60, calibratedAt);
    const resumedAt = sourceSteady.nowMs + 1_000;

    expect(pacer.step(resumedAt).shouldRun).toBe(true);
    const freshSamples = stepAtRate(pacer, 60, 7, resumedAt);
    expect(freshSamples.rendered).toBe(5);

    const transition = stepAtRate(pacer, 60, 90, freshSamples.nowMs);
    const steady = stepAtRate(pacer, 60, 60, transition.nowMs);
    const snapshot = pacer.snapshot();

    expect(transition.maxConsecutiveSkips).toBeLessThanOrEqual(2);
    expect(steady.rendered).toBe(60);
    expect(snapshot.estimatedRefreshFps).toBeCloseTo(60, 0);
    expect(snapshot.targetFps).toBeCloseTo(60, 0);
    expect(snapshot.intentionallyPaced).toBe(false);
  });

  it('renders immediately and preserves trusted calibration after a suspended-tab gap', () => {
    const pacer = new FramePacer({ enabled: true, maxFps: 60 });
    const calibratedAt = observeAtRate(pacer, 120);
    const warmup = stepAtRate(pacer, 120, 30, calibratedAt);

    const resumed = pacer.step(warmup.nowMs + 1000);

    expect(resumed.shouldRun).toBe(true);
    expect(resumed.intentionallyPaced).toBe(true);
    expect(resumed.estimatedRefreshFps).toBeCloseTo(120, 0);

    const resumedCallbacks = stepAtRate(pacer, 120, 8, warmup.nowMs + 1000);
    expect(resumedCallbacks.rendered).toBe(4);
  });
});
