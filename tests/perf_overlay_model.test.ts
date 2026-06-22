import { describe, expect, it } from 'vitest';
import {
  buildPerfOverlayView, DEFAULT_PERF_BG, DEFAULT_PERF_BG_RGB, DEFAULT_PERF_FG, DEFAULT_PERF_FG_RGB,
  defaultMetricsMap, FrameMeter, hexToRgb, METRIC_REGISTRY, metricsPreset,
  overlayFractionFromPixel, overlayPixelPosition, PERF_COLOR_THEMES, PERF_METRIC_GROUPS, PERF_METRIC_KEYS,
  perfMetricGroups, rgbaFromHex,
  type MetricsSample, type PerfMetricKey, type PerfOverlayViewConfig,
} from '../src/ui/perf_overlay_model';

function sample(over: Partial<MetricsSample> = {}): MetricsSample {
  return {
    fps: 60, frameTimeMs: 16.6, fps1Low: 50, fps01Low: 40, frameSamples: [16, 17, 16, 18, 15],
    online: true, connected: true, pingMs: 40, jitterMs: 5, snapshotHz: 20, connectionType: '4g',
    drawCalls: 300, triangles: 1_200_000, geometries: 80, textures: 50, programs: 20, renderScale: 1, gpu: 'Test GPU',
    memoryUsedMb: 400, memoryLimitMb: 2048, hitches: 0, entities: 12, apm: 30, backgrounded: false,
    ...over,
  };
}

function viewCfg(over: Partial<PerfOverlayViewConfig> = {}): PerfOverlayViewConfig {
  return { metrics: defaultMetricsMap(), thresholds: true, graph: true, ...over };
}

function allMetrics(): Record<PerfMetricKey, boolean> {
  return metricsPreset('everything');
}

describe('perf overlay metric registry', () => {
  it('defaults to the FPS + frame-time + ping trio only', () => {
    const m = defaultMetricsMap();
    expect(m.fps).toBe(true);
    expect(m.frameTime).toBe(true);
    expect(m.ping).toBe(true);
    expect(m.triangles).toBe(false);
    expect(m.memory).toBe(false);
  });

  it('exposes every registry key in PERF_METRIC_KEYS without duplicates', () => {
    expect(PERF_METRIC_KEYS.length).toBe(METRIC_REGISTRY.length);
    expect(new Set(PERF_METRIC_KEYS).size).toBe(PERF_METRIC_KEYS.length);
  });

  it('presets bulk-set visibility (minimal=fps only, everything=all on)', () => {
    const minimal = metricsPreset('minimal');
    expect(minimal.fps).toBe(true);
    expect(minimal.frameTime).toBe(false);
    expect(Object.values(allMetrics()).every(Boolean)).toBe(true);
  });

  it('renders the APM metric (input group) as an integer, off by default', () => {
    expect(defaultMetricsMap().apm).toBe(false);
    const apm = METRIC_REGISTRY.find((d) => d.key === 'apm');
    expect(apm?.group).toBe('input');
    expect(apm?.read(sample({ apm: 42 }))).toEqual({ kind: 'int', v: 42 });
  });
});

describe('perf metric grouping', () => {
  it('buckets every registry metric into exactly one group, losing none', () => {
    const grouped = perfMetricGroups();
    const groupedKeys = grouped.flatMap((g) => g.chips.map((c) => c.key));
    // every metric appears exactly once across all groups
    expect(groupedKeys.slice().sort()).toEqual(PERF_METRIC_KEYS.slice().sort());
    expect(new Set(groupedKeys).size).toBe(groupedKeys.length);
  });

  it('emits groups in PERF_METRIC_GROUPS order with the expected membership', () => {
    const grouped = perfMetricGroups();
    expect(grouped.map((g) => g.group.id)).toEqual(PERF_METRIC_GROUPS.map((g) => g.id));
    const byId = Object.fromEntries(grouped.map((g) => [g.group.id, g.chips.map((c) => c.key)]));
    expect(byId.frame).toEqual(['fps', 'frameTime', 'fps1Low', 'fps01Low', 'hitches']);
    expect(byId.network).toEqual(['ping', 'jitter', 'snapshot', 'connection']);
    expect(byId.renderer).toEqual(['drawCalls', 'triangles', 'geometries', 'textures', 'programs', 'renderScale', 'gpu']);
    expect(byId.system).toEqual(['memory', 'entities']);
  });

  it('preserves the label key for each chip from the registry', () => {
    const grouped = perfMetricGroups();
    const fps = grouped.flatMap((g) => g.chips).find((c) => c.key === 'fps')!;
    expect(fps.labelKey).toBe(METRIC_REGISTRY.find((d) => d.key === 'fps')!.labelKey);
  });
});

describe('buildPerfOverlayView', () => {
  it('emits only enabled, available rows in registry order', () => {
    const view = buildPerfOverlayView(sample(), viewCfg());
    expect(view.rows.map((r) => r.key)).toEqual(['fps', 'frameTime', 'ping']);
  });

  it('hides network rows when offline even if enabled', () => {
    const view = buildPerfOverlayView(sample({ online: false }), viewCfg({ metrics: allMetrics() }));
    const keys = view.rows.map((r) => r.key);
    expect(keys).not.toContain('ping');
    expect(keys).not.toContain('jitter');
    expect(keys).not.toContain('snapshot');
    // local metrics still present
    expect(keys).toContain('fps');
    expect(keys).toContain('entities');
  });

  it('hides Chromium-only rows when their source is null', () => {
    const view = buildPerfOverlayView(
      sample({ memoryUsedMb: null, memoryLimitMb: null, connectionType: null }),
      viewCfg({ metrics: allMetrics() }),
    );
    const keys = view.rows.map((r) => r.key);
    expect(keys).not.toContain('memory');
    expect(keys).not.toContain('connection');
  });

  it('color-codes FPS by threshold and respects the thresholds switch', () => {
    const sev = (fps: number, thresholds = true) =>
      buildPerfOverlayView(sample({ fps }), viewCfg({ thresholds })).rows.find((r) => r.key === 'fps')!.severity;
    expect(sev(72)).toBe('good');
    expect(sev(40)).toBe('warn');
    expect(sev(20)).toBe('bad');
    expect(sev(20, false)).toBe('none'); // thresholds off => no coloring
  });

  it('color-codes frame time the opposite direction (lower is better)', () => {
    const sev = (frameTimeMs: number) =>
      buildPerfOverlayView(sample({ frameTimeMs }), viewCfg()).rows.find((r) => r.key === 'frameTime')!.severity;
    expect(sev(10)).toBe('good');
    expect(sev(25)).toBe('warn');
    expect(sev(40)).toBe('bad');
  });

  it('drops the graph when disabled or with too few samples', () => {
    expect(buildPerfOverlayView(sample(), viewCfg({ graph: false })).graph).toBeNull();
    expect(buildPerfOverlayView(sample({ frameSamples: [16] }), viewCfg()).graph).toBeNull();
    expect(buildPerfOverlayView(sample(), viewCfg()).graph).not.toBeNull();
  });

  it('surfaces backgrounded + offline badges', () => {
    expect(buildPerfOverlayView(sample({ backgrounded: true }), viewCfg()).badges).toContain('backgrounded');
    expect(buildPerfOverlayView(sample({ online: true, connected: false }), viewCfg()).badges).toContain('offline');
    expect(buildPerfOverlayView(sample(), viewCfg()).badges).toEqual([]);
  });

  it('formats memory as a used/limit pair value descriptor', () => {
    const row = buildPerfOverlayView(sample(), viewCfg({ metrics: allMetrics() })).rows.find((r) => r.key === 'memory')!;
    expect(row.value).toEqual({ kind: 'memPair', usedMb: 400, limitMb: 2048 });
  });
});

describe('FrameMeter', () => {
  it('throttles repaints to roughly the configured interval', () => {
    const m = new FrameMeter();
    expect(m.step(1 / 60, 0)).toBe(false);      // first tick inside the gate
    expect(m.step(1 / 60, 100)).toBe(false);    // still < 250ms
    expect(m.step(1 / 60, 300)).toBe(true);     // gate elapsed
    expect(m.step(1 / 60, 400)).toBe(false);    // gate again
    expect(m.step(1 / 60, 600)).toBe(true);
  });

  it('smooths FPS toward the observed rate', () => {
    const m = new FrameMeter(300, 250, 60);
    for (let i = 0; i < 120; i++) m.step(1 / 30, i * 16); // sustained 30fps
    expect(m.fps()).toBeLessThan(40);
    expect(m.fps()).toBeGreaterThan(28);
    expect(m.frameTimeMs()).toBeGreaterThan(25);
  });

  it('reports lows only once enough samples exist', () => {
    const m = new FrameMeter();
    expect(m.lowFps(1)).toBeNull();
    for (let i = 0; i < 60; i++) m.step(1 / 60, i * 16);
    const low = m.lowFps(1);
    expect(low).not.toBeNull();
    expect(low!).toBeGreaterThan(0);
  });

  it('counts hitches and caps the sparkline length', () => {
    const m = new FrameMeter();
    for (let i = 0; i < 40; i++) m.step(1 / 60, i * 16); // smooth
    m.step(0.08, 1000); // one 80ms hitch
    expect(m.hitches()).toBe(1);
    expect(m.graphSamples(10).length).toBeLessThanOrEqual(10);
  });
});

describe('color helpers (shared by the overlay + graph painter)', () => {
  it('parses #rrggbb into an [r,g,b] tuple, case-insensitively', () => {
    expect(hexToRgb('#ffd76a', [0, 0, 0])).toEqual([255, 215, 106]);
    expect(hexToRgb('#08080d', [0, 0, 0])).toEqual([8, 8, 13]);
    expect(hexToRgb('#ABCDEF', [0, 0, 0])).toEqual([171, 205, 239]);
  });

  it('returns the caller-supplied fallback for a malformed hex', () => {
    expect(hexToRgb('red', [1, 2, 3])).toEqual([1, 2, 3]);
    expect(hexToRgb('#fff', [9, 9, 9])).toEqual([9, 9, 9]); // shorthand hex not supported
    expect(hexToRgb('', [4, 5, 6])).toEqual([4, 5, 6]);
  });

  it('builds an rgba() string with the given alpha, using the fallback on bad input', () => {
    expect(rgbaFromHex('#08080d', 0.55, DEFAULT_PERF_BG_RGB)).toBe('rgba(8, 8, 13, 0.55)');
    expect(rgbaFromHex('nope', 1, DEFAULT_PERF_FG_RGB)).toBe('rgba(255, 215, 106, 1)');
  });

  it('derives the default fg/bg + their rgb from the first theme so they never drift', () => {
    expect(DEFAULT_PERF_FG).toBe(PERF_COLOR_THEMES[0].fg);
    expect(DEFAULT_PERF_BG).toBe(PERF_COLOR_THEMES[0].bg);
    expect(DEFAULT_PERF_FG_RGB).toEqual(hexToRgb(PERF_COLOR_THEMES[0].fg, [0, 0, 0]));
    expect(DEFAULT_PERF_BG_RGB).toEqual(hexToRgb(PERF_COLOR_THEMES[0].bg, [0, 0, 0]));
  });
});

describe('free positioning math', () => {
  it('maps normalized positions to clamped on-screen pixels', () => {
    const tl = overlayPixelPosition(0, 0, 1000, 800, 120, 60);
    expect(tl).toEqual({ left: 8, top: 8 });
    const br = overlayPixelPosition(1, 1, 1000, 800, 120, 60);
    expect(br.left).toBe(1000 - 120 - 8);
    expect(br.top).toBe(800 - 60 - 8);
  });

  it('clamps out-of-range fractions into the viewport', () => {
    const over = overlayPixelPosition(5, -5, 1000, 800, 120, 60);
    expect(over.left).toBe(1000 - 120 - 8);
    expect(over.top).toBe(8);
  });

  it('round-trips pixel<->fraction near the center', () => {
    const px = overlayPixelPosition(0.5, 0.5, 1000, 800, 120, 60);
    const frac = overlayFractionFromPixel(px.left, px.top, 1000, 800, 120, 60);
    expect(frac.x).toBeCloseTo(0.5, 2);
    expect(frac.y).toBeCloseTo(0.5, 2);
  });

  // Drag-settle path (main.ts onPositionChange): a dropped pixel is converted to a
  // fraction, persisted, then re-projected to a pixel by reposition(). The two must
  // agree within rounding so the overlay never visibly snaps on drop.
  it('drag-settle does not visibly jump: fraction->pixel re-projects to the drop', () => {
    const vw = 1280, vh = 720, ow = 140, oh = 72;
    for (const [left, top] of [[8, 8], [600, 300], [1132, 640], [400, 8], [8, 640]] as const) {
      const frac = overlayFractionFromPixel(left, top, vw, vh, ow, oh);
      const px = overlayPixelPosition(frac.x, frac.y, vw, vh, ow, oh);
      expect(Math.abs(px.left - left)).toBeLessThanOrEqual(1);
      expect(Math.abs(px.top - top)).toBeLessThanOrEqual(1);
    }
  });

  it('drag-settle round-trip is stable across a window resize', () => {
    // Drop at 70%/40% on a large viewport, then re-project on a smaller one.
    const drop = overlayPixelPosition(0.7, 0.4, 1600, 900, 150, 70);
    const frac = overlayFractionFromPixel(drop.left, drop.top, 1600, 900, 150, 70);
    const resized = overlayPixelPosition(frac.x, frac.y, 1000, 600, 150, 70);
    // Still fully on-screen after the resize (clamped within margins).
    expect(resized.left).toBeGreaterThanOrEqual(8);
    expect(resized.left).toBeLessThanOrEqual(1000 - 150 - 8);
    expect(resized.top).toBeGreaterThanOrEqual(8);
    expect(resized.top).toBeLessThanOrEqual(600 - 70 - 8);
  });
});
