import { describe, expect, it } from 'vitest';
import {
  attributeFreezes,
  diffMetrics,
  frameStats,
  normalizeReport,
} from '../scripts/profiler/metrics.mjs';

describe('frameStats', () => {
  it('returns null for empty input', () => {
    expect(frameStats([])).toBeNull();
    expect(frameStats(undefined)).toBeNull();
  });

  it('computes mean FPS and percentiles from frame durations', () => {
    const steady = Array(100).fill(10); // 100 frames at 10ms => 100 fps
    const s = frameStats(steady);
    expect(s.frames).toBe(100);
    expect(s.fpsMean).toBe(100);
    expect(s.p95Ms).toBe(10);
    expect(s.maxMs).toBe(10);
    expect(s.stdevMs).toBe(0);
    expect(s.jankPct).toBe(0);
  });

  it('captures the 1%/0.1% lows that an average hides', () => {
    // 990 fast frames (8ms) + 10 slow frames (100ms): mean stays high, lows tank.
    const d = [...Array(990).fill(8), ...Array(10).fill(100)];
    const s = frameStats(d);
    expect(s.fpsMean).toBeGreaterThan(80); // average barely dented
    expect(s.fpsLow1).toBeLessThan(15); // worst 1% ~= 100ms frames => ~10 fps
    expect(s.long50).toBe(10);
    expect(s.stutter100).toBe(10);
    expect(s.maxMs).toBe(100);
    expect(s.jankPct).toBeGreaterThan(0);
  });

  it('judges jank against the supplied target budget', () => {
    const d = Array(100).fill(20); // 20ms = 50fps
    expect(frameStats(d, 60).jankPct).toBe(0); // 20 < 1.5*16.7
    expect(frameStats(d, 120).jankPct).toBe(100); // 20 > 1.5*8.3
  });
});

describe('attributeFreezes', () => {
  it('attributes hitches to shader compiles, view builds, or other', () => {
    const samples = [
      { dt: 8, programs: 100, createdViews: 0 },
      { dt: 200, programs: 103, createdViews: 0 }, // +3 programs => shader-compile
      { dt: 9, programs: 103, createdViews: 0 },
      { dt: 120, programs: 103, createdViews: 5 }, // +5 views => view-build
      { dt: 9, programs: 103, createdViews: 5 },
      { dt: 80, programs: 103, createdViews: 5, longTaskMs: 70 }, // long-task
      { dt: 70, programs: 103, createdViews: 5 }, // other (GC/upload)
    ];
    const a = attributeFreezes(samples, 8, 50);
    expect(a.hitchCount).toBe(4);
    expect(a.worstMs).toBe(200);
    expect(a.byCause['shader-compile']).toBe(1);
    expect(a.byCause['view-build']).toBe(1);
    expect(a.byCause['long-task']).toBe(1);
    expect(a.byCause.other).toBe(1);
    expect(a.worst[0].cause).toBe('shader-compile');
  });

  it('tags texture/geometry uploads as asset-upload (not shader-compile)', () => {
    const samples = [
      { dt: 8, programs: 50, createdViews: 0, textures: 900, geometries: 500 },
      { dt: 90, programs: 50, createdViews: 0, textures: 912, geometries: 504 }, // +12 tex => upload
    ];
    const a = attributeFreezes(samples, 8, 50);
    expect(a.byCause['asset-upload']).toBe(1);
    expect(a.worst[0].texDelta).toBe(12);
    expect(a.worst[0].geoDelta).toBe(4);
  });

  it('ignores frames below the hitch threshold', () => {
    const samples = [
      { dt: 8, programs: 1 },
      { dt: 10, programs: 1 },
      { dt: 12, programs: 1 },
    ];
    expect(attributeFreezes(samples, 8, 50).hitchCount).toBe(0);
  });
});

describe('normalizeReport', () => {
  it('flattens a perf report into stable comparable fields', () => {
    const report = {
      fps: 72.4,
      frameMs: { p95: 16.1, p99: 28.6, max: 50, long50: 2 },
      windows: { last10s: { fps: 73.1 } },
      mainMs: { sim: { avg: 0.6 }, renderer: { avg: 7 }, hud: { avg: 0.4 } },
      renderer: {
        tier: 'high',
        effectiveRenderScale: 1,
        calls: 1189,
        triangles: 4_000_000,
        programs: 179,
        views: 63,
        autoGovernor: true,
        phaseMs: { entities: { avg: 1 }, submit: { avg: 9.3 }, total: { avg: 10 } },
        foliage: {
          grassVisibleTufts: 2700,
          modelVisibleDraws: 170,
          modelVisibleTriangles: 2_600_000,
        },
        renderBudget: { mode: 'stable', reason: 'stable', pressure: 0.4 },
      },
      browser: {
        longTasks: { count: 1, p95: 60, max: 60 },
        memory: { usedMB: 300, limitMB: 4096 },
      },
    };
    const m = normalizeReport(report);
    expect(m.fps).toBe(72.4);
    expect(m.tier).toBe('high');
    expect(m.calls).toBe(1189);
    expect(m.phaseSubmitMs).toBe(9.3);
    expect(m.mainRendererMs).toBe(7);
    expect(m.heapUsedMb).toBe(300);
    expect(m.autoGovernor).toBe(true);
  });
});

describe('diffMetrics', () => {
  it('flags FPS up as better and frame-cost up as worse', () => {
    const before = { fps: 58.7, frameP95: 32.7, calls: 1344 };
    const after = { fps: 72.3, frameP95: 17.4, calls: 1189 };
    const d = diffMetrics(before, after);
    expect(d.fps.delta).toBeCloseTo(13.6, 1);
    expect(d.fps.better).toBe('better');
    expect(d.frameP95.better).toBe('better'); // p95 went down -> better
    expect(d.calls.better).toBe('better'); // fewer calls -> better
  });

  it('marks regressions as worse', () => {
    const d = diffMetrics({ fps: 80 }, { fps: 60 });
    expect(d.fps.better).toBe('worse');
    expect(d.fps.delta).toBe(-20);
  });
});
