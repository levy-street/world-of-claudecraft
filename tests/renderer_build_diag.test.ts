// The Renderer constructor's build-phase telemetry, extracted out of
// renderer.ts. It exists to localize which build phase tips the iOS WebKit
// memory ceiling, so the marks matter more than the console line: the boot
// profiler reads them on production devices where the console line is silent.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRendererBuildDiag } from '../src/render/renderer_build_diag';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('renderer build diag', () => {
  it('measures each phase from the end of the previous one', () => {
    const marks: Array<[string, number, number]> = [];
    vi.spyOn(performance, 'measure').mockImplementation(((
      name: string,
      options: { start: number; end: number },
    ) => {
      marks.push([name, options.start, options.end]);
      return undefined as unknown as PerformanceMeasure;
    }) as typeof performance.measure);
    vi.spyOn(console, 'info').mockImplementation(() => {});

    let clock = 100;
    const bd = createRendererBuildDiag(() => clock);
    clock = 140;
    bd('scene');
    clock = 155;
    bd('weather-post');

    expect(marks.map(([name]) => name)).toEqual([
      'woc:load:renderer-ctor/scene',
      'woc:load:renderer-ctor/weather-post',
    ]);
    expect(marks[0].slice(1)).toEqual([100, 140]);
    // The second segment starts where the first ended, never at the run start.
    expect(marks[1].slice(1)).toEqual([140, 155]);
  });

  it('logs the per-phase and cumulative wall time on the dev channel', () => {
    vi.spyOn(performance, 'measure').mockImplementation(
      (() => undefined) as unknown as typeof performance.measure,
    );
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    let clock = 0;
    const bd = createRendererBuildDiag(() => clock);
    clock = 12;
    bd('scene');
    clock = 30;
    bd('weather-post');
    expect(info).toHaveBeenNthCalledWith(1, '[build-diag] scene +12ms (total 12ms)');
    expect(info).toHaveBeenNthCalledWith(2, '[build-diag] weather-post +18ms (total 30ms)');
  });
});
