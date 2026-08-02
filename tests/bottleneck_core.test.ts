import { describe, expect, it } from 'vitest';
import {
  BOTTLENECK_VERDICTS,
  type BottleneckSignals,
  COMPILE_STALL_LONG_TASK_MS,
  COMPILE_STALL_PROGRAM_DELTA,
  classifyBottleneck,
} from '../src/render/bottleneck_core';

// A healthy 60 fps desktop baseline every case perturbs.
function signals(overrides: Partial<BottleneckSignals> = {}): BottleneckSignals {
  return {
    frameP95Ms: 14,
    targetFrameMs: 16.7,
    gpuFrameP95Ms: 8,
    submitP95Ms: 3,
    rendererCpuP95Ms: 6,
    mainOtherAvgMs: 2,
    longTaskP95Ms: 0,
    programDelta: 0,
    externalFrameCap: false,
    effectiveRenderScale: 1,
    ...overrides,
  };
}

describe('bottleneck_core verdict matrix', () => {
  it('reads a healthy session as balanced with high confidence', () => {
    const r = classifyBottleneck(signals());
    expect(r.verdict).toBe('balanced');
    expect(r.confidence).toBe('high');
  });

  it('compile stalls trump throughput verdicts (the ANGLE/D3D11 storm signature)', () => {
    const r = classifyBottleneck(
      signals({
        programDelta: COMPILE_STALL_PROGRAM_DELTA,
        longTaskP95Ms: COMPILE_STALL_LONG_TASK_MS,
        frameP95Ms: 45,
        gpuFrameP95Ms: 40, // even a GPU-heavy window reports the stalls first
      }),
    );
    expect(r.verdict).toBe('compile-stalls');
    expect(r.confidence).toBe('high');
  });

  it('program growth without long tasks is not a stall verdict', () => {
    const r = classifyBottleneck(signals({ programDelta: 30, longTaskP95Ms: 10 }));
    expect(r.verdict).toBe('balanced');
  });

  it('an external frame cap reads as vsync-capped, not as a bottleneck', () => {
    const r = classifyBottleneck(
      signals({ externalFrameCap: true, frameP95Ms: 34, targetFrameMs: 16.7 }),
    );
    expect(r.verdict).toBe('vsync-capped');
  });

  it('a slow frame dominated by GPU time is gpu-bound with high confidence', () => {
    const r = classifyBottleneck(
      signals({ frameP95Ms: 33, gpuFrameP95Ms: 30, targetFrameMs: 16.7 }),
    );
    expect(r.verdict).toBe('gpu-bound');
    expect(r.confidence).toBe('high');
  });

  it('notes when the governor is already shedding resolution', () => {
    const r = classifyBottleneck(
      signals({
        frameP95Ms: 33,
        gpuFrameP95Ms: 30,
        targetFrameMs: 16.7,
        effectiveRenderScale: 0.72,
      }),
    );
    expect(r.detail).toContain('shedding resolution');
  });

  it('a slow frame with idle GPU and heavy renderer CPU is render-cpu-bound', () => {
    const r = classifyBottleneck(
      signals({
        frameP95Ms: 36,
        targetFrameMs: 16.7,
        gpuFrameP95Ms: 8,
        rendererCpuP95Ms: 24,
        mainOtherAvgMs: 4,
      }),
    );
    expect(r.verdict).toBe('render-cpu-bound');
    expect(r.confidence).toBe('high');
  });

  it('a slow frame with idle GPU and heavy sim/hud time is cpu-main-bound (the crowd case)', () => {
    const r = classifyBottleneck(
      signals({
        frameP95Ms: 36,
        targetFrameMs: 16.7,
        gpuFrameP95Ms: 8,
        rendererCpuP95Ms: 9,
        mainOtherAvgMs: 14,
      }),
    );
    expect(r.verdict).toBe('cpu-main-bound');
  });

  it('without a GPU timer, a dominant submit span infers gpu-bound at low confidence', () => {
    const r = classifyBottleneck(
      signals({
        frameP95Ms: 40,
        targetFrameMs: 16.7,
        gpuFrameP95Ms: null,
        submitP95Ms: 22,
        rendererCpuP95Ms: 28,
        mainOtherAvgMs: 3,
      }),
    );
    expect(r.verdict).toBe('gpu-bound');
    expect(r.confidence).toBe('low');
    expect(r.detail).toContain('no GPU timer');
  });

  it('without a GPU timer, main-thread-heavy windows read cpu-main-bound', () => {
    const r = classifyBottleneck(
      signals({
        frameP95Ms: 40,
        targetFrameMs: 16.7,
        gpuFrameP95Ms: null,
        submitP95Ms: 2,
        rendererCpuP95Ms: 8,
        mainOtherAvgMs: 20,
      }),
    );
    expect(r.verdict).toBe('cpu-main-bound');
  });

  it('an empty window is unknown', () => {
    const r = classifyBottleneck(signals({ frameP95Ms: 0 }));
    expect(r.verdict).toBe('unknown');
  });

  it('every produced verdict is in the allowlisted beacon token set', () => {
    const cases: Partial<BottleneckSignals>[] = [
      {},
      { programDelta: 10, longTaskP95Ms: 120 },
      { externalFrameCap: true },
      { frameP95Ms: 33, gpuFrameP95Ms: 30 },
      { frameP95Ms: 36, gpuFrameP95Ms: 8, rendererCpuP95Ms: 24, mainOtherAvgMs: 4 },
      { frameP95Ms: 36, gpuFrameP95Ms: 8, rendererCpuP95Ms: 9, mainOtherAvgMs: 14 },
      { frameP95Ms: 40, gpuFrameP95Ms: null, submitP95Ms: 22, rendererCpuP95Ms: 28 },
      { frameP95Ms: 0 },
    ];
    for (const c of cases) {
      expect(BOTTLENECK_VERDICTS).toContain(classifyBottleneck(signals(c)).verdict);
    }
  });
});
