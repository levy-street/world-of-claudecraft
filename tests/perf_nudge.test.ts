import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The assembler under test composes three independent signals; the toast and
// the boot-notice memo are mocked (each has its own suite), while the
// perf-doctor analyzer runs REAL so the ids the toast receives come from the
// same rules the beacon reports.
vi.mock('../src/ui/perf_nudge_toast', () => ({ initPerfNudgeToast: vi.fn(() => true) }));
vi.mock('../src/game/software_render_notice', () => ({
  softwareNoticeShown: vi.fn(() => false),
  discreteNoticeShown: vi.fn(() => false),
}));

import type { PerfSnapshot } from '../src/game/perf';
import { initPerfNudge } from '../src/game/perf_nudge';
import { discreteNoticeShown, softwareNoticeShown } from '../src/game/software_render_notice';
import { initPerfNudgeToast } from '../src/ui/perf_nudge_toast';

const toast = vi.mocked(initPerfNudgeToast);
const noticeShown = vi.mocked(softwareNoticeShown);
const discreteShown = vi.mocked(discreteNoticeShown);

const CHECK_MS = 30_000;

interface SnapKnobs {
  glRenderer?: string;
  frames?: number;
  bad?: boolean;
  dpr?: number;
  pixelRatio?: number;
}

// Minimal analyzer-shaped snapshot; the assembler reads frames and hands the
// rest to analyzePerfSuggestions, so only those fields exist here.
function snap(knobs: SnapKnobs = {}): PerfSnapshot {
  const frameMs = knobs.bad
    ? { avg: 45, p50: 40, p95: 55, p99: 70, max: 120, long50: 10 }
    : { avg: 16, p50: 16, p95: 18, p99: 22, max: 30, long50: 0 };
  return {
    seconds: 60,
    frames: knobs.frames ?? 4000,
    fps: knobs.bad ? 22 : 60,
    frameMs,
    windows: {
      last10s: { seconds: 10, frames: knobs.bad ? 220 : 600, fps: knobs.bad ? 22 : 60, frameMs },
    },
    renderer: {
      tier: 'medium',
      pixelRatio: knobs.pixelRatio ?? 1,
      glRenderer: knobs.glRenderer ?? 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2)',
      contextLost: 0,
      contextRestored: 0,
    },
    browser: { longTasks: { count: 0, p95: 0, max: 0 }, memory: null },
    device: {
      dpr: knobs.dpr ?? 1,
      deviceMemory: 8,
      hardwareConcurrency: 8,
      maxTouchPoints: 0,
    },
  } as unknown as PerfSnapshot;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  toast.mockReturnValue(true);
  noticeShown.mockReturnValue(false);
  discreteShown.mockReturnValue(false);
  (globalThis as any).window = {
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
  };
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as any).window;
});

describe('initPerfNudge', () => {
  it('fires the toast exactly once for a persistent software session', () => {
    const report = vi.fn(() => snap({ glRenderer: 'Google SwiftShader' }));
    initPerfNudge({ perf: { report }, desktopShell: false });

    vi.advanceTimersByTime(CHECK_MS);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({
      suggestionIds: ['hardware-acceleration'],
      softwareNoticeAlreadyShown: false,
      discreteNoticeAlreadyShown: false,
      desktopShell: false,
    });

    // The condition persists, but the decision was made: polling has stopped,
    // so neither the toast nor the snapshot read runs again.
    const reads = report.mock.calls.length;
    vi.advanceTimersByTime(CHECK_MS * 10);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(report.mock.calls.length).toBe(reads);
  });

  it('waits for real gameplay frames before judging the session', () => {
    let frames = 5;
    const report = vi.fn(() => snap({ glRenderer: 'Google SwiftShader', frames }));
    initPerfNudge({ perf: { report }, desktopShell: false });

    vi.advanceTimersByTime(CHECK_MS);
    expect(toast).not.toHaveBeenCalled();

    frames = 4000;
    vi.advanceTimersByTime(CHECK_MS);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('never nudges a healthy session and keeps watching it', () => {
    const report = vi.fn(() => snap());
    initPerfNudge({ perf: { report }, desktopShell: false });

    vi.advanceTimersByTime(CHECK_MS * 5);
    expect(toast).not.toHaveBeenCalled();
    // Still polling: a machine-local cause appearing later must still be seen.
    expect(report).toHaveBeenCalledTimes(5);
  });

  it('does not spend the one nudge on non-arm diagnostics', () => {
    // A bad high-DPI session emits 'high-dpi', which is fleet-only; the
    // session's single toast stays available for a later machine-local cause.
    let current = snap({ bad: true, dpr: 2, pixelRatio: 2 });
    const report = vi.fn(() => current);
    initPerfNudge({ perf: { report }, desktopShell: false });

    vi.advanceTimersByTime(CHECK_MS * 2);
    expect(toast).not.toHaveBeenCalled();

    current = snap({ glRenderer: 'Google SwiftShader' });
    vi.advanceTimersByTime(CHECK_MS);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('threads the boot-notice memo and desktop shell flag into the toast', () => {
    // Sampled at CHECK time, not at init: the predicate flips to true only
    // AFTER the poller is armed, so an implementation that snapshots it at
    // init would hand the toast false here and fail the exact-object pin.
    const report = vi.fn(() => snap({ glRenderer: 'Google SwiftShader' }));
    initPerfNudge({ perf: { report }, desktopShell: true });
    noticeShown.mockReturnValue(true);

    vi.advanceTimersByTime(CHECK_MS);
    expect(toast).toHaveBeenCalledWith({
      suggestionIds: ['hardware-acceleration'],
      softwareNoticeAlreadyShown: true,
      discreteNoticeAlreadyShown: false,
      desktopShell: true,
    });
  });

  it('threads the shell inactive-GPU notice memo into the toast', () => {
    // Same check-time contract for the shell verdict: it can land long after
    // the nudge is armed (the shell pushes on its own schedule), so the flip
    // happens after init and the check that fires next must still see it.
    const report = vi.fn(() => snap({ glRenderer: 'Google SwiftShader' }));
    initPerfNudge({ perf: { report }, desktopShell: true });
    discreteShown.mockReturnValue(true);

    vi.advanceTimersByTime(CHECK_MS);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ discreteNoticeAlreadyShown: true }),
    );
  });

  it('stops cleanly when the caller tears it down', () => {
    const report = vi.fn(() => snap({ glRenderer: 'Google SwiftShader' }));
    const stop = initPerfNudge({ perf: { report }, desktopShell: false });
    stop();
    vi.advanceTimersByTime(CHECK_MS * 3);
    expect(report).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
