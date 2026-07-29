import { describe, expect, it } from 'vitest';
import { RendererPhaseSampleWindow } from '../src/render/renderer_phase_samples_core';

describe('renderer phase sample window', () => {
  it('summarizes finite samples with the renderer percentile convention', () => {
    const samples = new RendererPhaseSampleWindow(8);
    for (const value of [3, 1, 5, 2]) samples.push(value);
    expect(samples.summarize()).toEqual({
      count: 4,
      avg: 2.75,
      p95: 5,
      max: 5,
    });
  });

  it('overwrites the oldest value at capacity without growing or shifting', () => {
    const samples = new RendererPhaseSampleWindow(3);
    for (const value of [1, 2, 3, 9]) samples.push(value);
    expect(samples.count).toBe(3);
    expect(samples.summarize()).toEqual({
      count: 3,
      avg: 4.67,
      p95: 9,
      max: 9,
    });
  });

  it('drops invalid samples and clamps stalls to the existing 250ms ceiling', () => {
    const samples = new RendererPhaseSampleWindow(3);
    samples.push(Number.NaN);
    samples.push(-1);
    samples.push(600);
    expect(samples.summarize()).toEqual({
      count: 1,
      avg: 250,
      p95: 250,
      max: 250,
    });
  });

  it('rejects invalid capacities', () => {
    expect(() => new RendererPhaseSampleWindow(0)).toThrow(RangeError);
    expect(() => new RendererPhaseSampleWindow(1.5)).toThrow(RangeError);
  });
});
