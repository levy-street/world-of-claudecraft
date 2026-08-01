import { describe, expect, it } from 'vitest';
import {
  attributionMetrics,
  formatAttributionTable,
  frameTimeMs,
} from '../scripts/lib/perf_attrib_math.mjs';

describe('performance attribution math', () => {
  it('converts FPS to milliseconds per frame', () => {
    expect(frameTimeMs(100)).toBe(10);
    expect(frameTimeMs(125)).toBe(8);
  });

  it('reports positive savings when an override improves FPS', () => {
    expect(attributionMetrics(100, 125)).toEqual({
      fps: 125,
      deltaFps: 25,
      gpuMsSaved: 2,
    });
  });

  it('reports negative savings when an override slows the frame', () => {
    expect(attributionMetrics(100, 80)).toEqual({
      fps: 80,
      deltaFps: -20,
      gpuMsSaved: -2.5,
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid FPS evidence: %s',
    (fps) => {
      expect(() => frameTimeMs(fps)).toThrow('positive finite FPS');
      expect(() => attributionMetrics(fps, 100)).toThrow('positive finite FPS');
      expect(() => attributionMetrics(100, fps)).toThrow('positive finite FPS');
      expect(() => formatAttributionTable(fps, [])).toThrow('positive finite FPS');
    },
  );

  it('formats control and attributed rows as a fixed-width table', () => {
    expect(
      formatAttributionTable(100, [
        { knob: 'faster', fps: 125 },
        { knob: 'slower', fps: 80 },
      ]),
    ).toBe(
      [
        'knob          fps   delta fps  GPU ms/frame saved',
        'control     100.0         0.0               0.000',
        'faster      125.0       +25.0              +2.000',
        'slower       80.0       -20.0              -2.500',
      ].join('\n'),
    );
  });
});
