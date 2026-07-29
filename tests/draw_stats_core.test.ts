// Pins for src/render/draw_stats_core.ts: the composer-tier draw-stats
// accumulator and truthful logical-frame signal consumed by the governor.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createDrawStatsAccumulator,
  createLogicalFrameDrawStats,
  type DrawStatsCounters,
  governorDrawSignal,
} from '../src/render/draw_stats_core';
import { GFX_BUDGETS, GFX_CONFIG_VERSION } from '../src/render/gfx';
import { RenderBudgetGovernor } from '../src/render/render_budget';
import { assertAllocationStable } from './util/alloc_probe';

const counters = (
  calls: number,
  triangles: number,
  points: number,
  lines: number,
): DrawStatsCounters => ({ calls, triangles, points, lines });

describe('draw_stats_core', () => {
  it('owns post-processing counter setup, frame sampling, governor input, and resets', () => {
    let resets = 0;
    const info = {
      autoReset: true,
      render: counters(20, 1000, 2, 1),
      reset: () => {
        resets++;
        info.render.calls = 0;
        info.render.triangles = 0;
        info.render.points = 0;
        info.render.lines = 0;
      },
    };
    const logicalFrame = createLogicalFrameDrawStats(info);

    expect(info.autoReset).toBe(false);
    expect(logicalFrame.currentFrame()).toEqual(counters(0, 0, 0, 0));
    logicalFrame.beginFrame();
    info.render.calls += 675;
    info.render.triangles += 10_200_000;
    const measured = logicalFrame.beginFrame();

    expect(measured).toBe(logicalFrame.currentFrame());
    expect(measured).toEqual(counters(675, 10_200_000, 0, 0));
    expect(logicalFrame.governorSignal('high')).toBe(measured);

    info.render.calls += 37;
    info.render.triangles += 21_000;
    logicalFrame.discardOutOfBand();
    expect(resets).toBe(1);
    expect(info.render).toEqual(counters(0, 0, 0, 0));
    info.render.calls = 250;
    info.render.triangles = 180_000;
    expect(logicalFrame.beginFrame()).toEqual(counters(250, 180_000, 0, 0));
  });

  it('wires Renderer lifecycle consumers through the tested logical-frame session', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

    expect(source.match(/createLogicalFrameDrawStats\(this\.webgl\.info\)/g)).toHaveLength(1);
    expect(source).toMatch(
      /if \(GFX\.composer \|\| GFX\.gradePass\) \{[\s\S]{0,800}createLogicalFrameDrawStats\(this\.webgl\.info\)/,
    );
    expect(source.match(/this\.drawStats\.beginFrame\(\)/g)).toHaveLength(1);
    expect(source.match(/this\.drawStats\.currentFrame\(\)/g)).toHaveLength(2);
    expect(source.match(/this\.drawStats\.governorSignal\(GFX\.tier\)/g)).toHaveLength(1);
    expect(source.match(/this\.drawStats\.discardOutOfBand\(\)/g)).toHaveLength(1);
    expect(source).toMatch(
      /if \(this\.drawStats\) this\.drawStats\.beginFrame\(\);\n\s*this\.updateAdaptiveResolution\(dt\);/,
    );
    expect(source).toContain(
      'const drawStatsFrame = this.drawStats ? this.drawStats.currentFrame() : null;',
    );
    expect(source).toMatch(/calls: drawStatsFrame\s*\? drawStatsFrame\.calls/);
    expect(source).toMatch(/triangles: drawStatsFrame\s*\? drawStatsFrame\.triangles/);
    expect(source).toContain(
      'const drawSignal = this.drawStats ? this.drawStats.governorSignal(GFX.tier) : info.render;',
    );
    expect(source).toContain('sample.calls = drawSignal.calls');
    expect(source).toContain('sample.triangles =\n      drawSignal.triangles');
    expect(source).toContain('else this.webgl.info.reset();');
  });

  it('fills one caller-owned frame counter on the composer hot path', () => {
    const acc = createDrawStatsAccumulator();
    const read = counters(0, 0, 0, 0);
    const out = counters(0, 0, 0, 0);
    acc.beginFrame(read, out);
    expect(() =>
      assertAllocationStable(
        () => {
          read.calls++;
          read.triangles += 10;
          return acc.beginFrame(read, out);
        },
        64,
        'draw stats frame',
      ),
    ).not.toThrow();
  });

  it('accumulates across passes: consecutive monotonic reads become per-frame deltas', () => {
    const acc = createDrawStatsAccumulator();
    acc.beginFrame(counters(0, 0, 0, 0)); // baseline capture, return discarded
    // Two frames of a composer session with autoReset off: the counter runs
    // monotonically 0 -> 412 -> 799 across all passes of each frame.
    const first = acc.beginFrame(counters(412, 300100, 17, 5));
    expect(first).toEqual(counters(412, 300100, 17, 5));
    const second = acc.beginFrame(counters(799, 512400, 40, 9));
    expect(second).toEqual(counters(387, 212300, 23, 4));
    // The regression traps: the raw monotonic total and the legacy final-pass value.
    expect(second.calls).not.toBe(799);
    expect(second.calls).not.toBe(1);
  });

  it('excludes an out-of-band render from the next frame delta', () => {
    const acc = createDrawStatsAccumulator();
    acc.beginFrame(counters(0, 0, 0, 0)); // baseline capture
    // A NON-ZERO in-band baseline first, so the exclusion has an observable
    // effect: a no-op noteOutOfBand would leave this baseline armed and clamp
    // the post-reset delta below to zero instead of 250.
    acc.beginFrame(counters(500, 400000, 20, 6));
    // A screenshot renders 37 calls / 21k triangles out of band (the counter
    // reads 537 at that point); the renderer reports the discarded reading and
    // resets the WebGL counter to zero right after.
    acc.noteOutOfBand(counters(537, 421000, 23, 7));
    // The next in-band frame accumulates from the reset counter.
    const frame = acc.beginFrame(counters(250, 180000, 12, 2));
    expect(frame).toEqual(counters(250, 180000, 12, 2));
  });

  it('guard flip: without noteOutOfBand the out-of-band render contaminates the delta', () => {
    const acc = createDrawStatsAccumulator();
    acc.beginFrame(counters(0, 0, 0, 0)); // baseline capture
    acc.beginFrame(counters(500, 400000, 20, 6)); // same in-band baseline as above
    // Same screenshot and frame, but nobody excludes and nobody resets: the
    // monotonic counter reads 500 + 37 + 250 = 787 at the next frame start,
    // and the out-of-band 37 contaminates the delta.
    const frame = acc.beginFrame(counters(787, 601000, 35, 9));
    expect(frame).toEqual(counters(287, 201000, 15, 3));
    expect(frame.calls).not.toBe(250);
  });

  it('passes accurate measured logical-frame counters to the governor on every tier', () => {
    const input = counters(641, 2400123, 9, 4);
    for (const tier of ['low', 'medium', 'high', 'ultra', 'insane'] as const) {
      const out = governorDrawSignal(tier, input);
      expect(out).toBe(input);
      expect(out).toEqual({ calls: 641, triangles: 2400123, points: 9, lines: 4 });
    }
  });

  it('lets the measured High scene sample trigger draw-pressure quality shedding', () => {
    const governor = new RenderBudgetGovernor({
      tier: 'high',
      budget: GFX_BUDGETS.high,
      enabled: true,
    });
    governor.reset(1, 0.7, 1);
    governor.update({
      dt: 0.6,
      frameMs: 16,
      totalMs: 16,
      submitMs: 5,
      calls: 150,
      triangles: 250000,
      grassVisibleTufts: 900,
      grassVisibleChunks: 8,
      activeViews: 25,
      createdViews: 0,
      minRenderScale: 0.7,
      maxRenderScale: 1,
    });

    const draw = governorDrawSignal('high', counters(675, 10_200_000, 0, 0));
    expect(draw.calls).toBe(675);
    expect(draw.triangles).toBe(10_200_000);
    const state = governor.update({
      dt: 1 / 60,
      frameMs: 18.9,
      totalMs: 18.9,
      submitMs: 5,
      calls: draw.calls,
      triangles: draw.triangles,
      grassVisibleTufts: 900,
      grassVisibleChunks: 8,
      activeViews: 25,
      createdViews: 0,
      minRenderScale: 0.7,
      maxRenderScale: 1,
    });

    expect(state.mode).toBe('degrading');
    expect(state.reason).toBe('draw');
    expect(state.caps.urgentTriangles).toBe(6_500_000);
    expect(state.pressure).toBe(2.27);
    expect(state.levels.foliage).toBe(0.76);
  });

  it('discards the first-frame baseline instead of reporting the seed as a delta', () => {
    const acc = createDrawStatsAccumulator();
    // The counter already reads 5000 when the accumulator first samples it
    // (e.g. renders that predate the first sync).
    const discarded = acc.beginFrame(counters(5000, 3700000, 60, 20));
    expect(discarded).toEqual(counters(0, 0, 0, 0));
    // The first real frame adds 300 calls / 200k triangles.
    const first = acc.beginFrame(counters(5300, 3900000, 75, 26));
    expect(first).toEqual(counters(300, 200000, 15, 6));
    expect(first.calls).not.toBe(5300);
  });

  it('pins the config version that segments the expanded graphics profiles', () => {
    // v21 separates the staged per-system graphics controls and expanded
    // profile bytes from v20 fleet comparisons.
    expect(GFX_CONFIG_VERSION).toBe(21);
  });

  it('clamps a backward counter jump at zero, per field, and recovers', () => {
    const acc = createDrawStatsAccumulator();
    acc.beginFrame(counters(0, 0, 0, 0)); // baseline capture
    acc.beginFrame(counters(799, 640000, 30, 8));
    // Context restore zeroes the WebGL counters; the next read lands below
    // the baseline. The delta must clamp at zero, never go negative.
    const clamped = acc.beginFrame(counters(12, 9000, 2, 1));
    expect(clamped).toEqual(counters(0, 0, 0, 0));
    // The clamp is per field: one field advancing while another regresses
    // reports only the advancing field.
    const mixed = acc.beginFrame(counters(13, 4000, 6, 0));
    expect(mixed).toEqual(counters(1, 0, 4, 0));
    // Recovery: the baseline re-armed at the restored counter values.
    const recovered = acc.beginFrame(counters(263, 194000, 16, 5));
    expect(recovered).toEqual(counters(250, 190000, 10, 5));
  });
});
