import { describe, expect, it } from 'vitest';
import { frameGraphCanvasMetrics, frameGraphGeometry, MAX_VISIBLE_MS } from '../src/ui/perf_graph_painter';

const TARGET = 1000 / 60; // ~16.67ms

describe('frameGraphGeometry', () => {
  it('lays out one point per sample spanning the full width', () => {
    const geo = frameGraphGeometry([16, 16, 16, 16], TARGET, 100, 26);
    expect(geo.points).toHaveLength(4);
    expect(geo.points[0].x).toBe(0);
    expect(geo.points[3].x).toBeCloseTo(100);
  });

  it('auto-scales the ceiling to at least 2x target, capped at MAX_VISIBLE_MS', () => {
    // All-fast samples => ceiling pinned at 2x target.
    expect(frameGraphGeometry([8, 9, 10], TARGET, 100, 26).maxMs).toBeCloseTo(TARGET * 2);
    // A worse-than-2x sample raises the ceiling to that sample.
    expect(frameGraphGeometry([8, 50, 10], TARGET, 100, 26).maxMs).toBe(50);
    // A wild stall is clamped so normal variance stays legible.
    expect(frameGraphGeometry([8, 999, 10], TARGET, 100, 26).maxMs).toBe(MAX_VISIBLE_MS);
  });

  it('maps worse frame times to higher rows (smaller y, canvas origin top-left)', () => {
    const geo = frameGraphGeometry([8, 80], TARGET, 100, 26);
    expect(geo.points[1].y).toBeLessThan(geo.points[0].y); // 80ms sits above 8ms
    // Every point stays within the canvas height.
    for (const p of geo.points) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(26);
    }
  });

  it('places the target baseline inside the canvas', () => {
    const geo = frameGraphGeometry([16, 16], TARGET, 100, 26);
    expect(geo.baselineY).toBeGreaterThan(0);
    expect(geo.baselineY).toBeLessThan(26);
  });

  it('does not divide by zero on a single sample', () => {
    const geo = frameGraphGeometry([16], TARGET, 100, 26);
    expect(geo.points).toHaveLength(1);
    expect(Number.isFinite(geo.points[0].x)).toBe(true);
    expect(geo.points[0].x).toBe(0);
  });

  it('handles an empty sample list', () => {
    const geo = frameGraphGeometry([], TARGET, 100, 26);
    expect(geo.points).toEqual([]);
  });
});

describe('frameGraphCanvasMetrics', () => {
  it('scales the backing store by the device pixel ratio', () => {
    expect(frameGraphCanvasMetrics(320, 26, 2)).toEqual({ pxW: 640, pxH: 52, dpr: 2 });
    expect(frameGraphCanvasMetrics(120, 26, 1)).toEqual({ pxW: 120, pxH: 26, dpr: 1 });
  });

  it('clamps the device pixel ratio to 2 to bound backing-store memory', () => {
    expect(frameGraphCanvasMetrics(100, 26, 3).dpr).toBe(2);
  });

  it('falls back to 1x for a non-positive device pixel ratio', () => {
    expect(frameGraphCanvasMetrics(100, 26, 0).dpr).toBe(1);
  });

  it('never produces a zero-sized backing store', () => {
    const m = frameGraphCanvasMetrics(0, 0, 1);
    expect(m.pxW).toBeGreaterThanOrEqual(1);
    expect(m.pxH).toBeGreaterThanOrEqual(1);
  });
});
