import { describe, expect, it } from 'vitest';
import { GpuFrameTimer } from '../src/render/gpu_timer';

class FakeTimerQueryContext {
  readonly QUERY_RESULT_AVAILABLE = 0x8867;
  readonly QUERY_RESULT = 0x8866;
  readonly extension = {
    TIME_ELAPSED_EXT: 0x88bf,
    GPU_DISJOINT_EXT: 0x8fbb,
  };
  extensionAvailable = true;
  disjoint = false;
  available = false;
  elapsedNs = 0;
  createCount = 0;
  beginCount = 0;
  endCount = 0;
  resultReadCount = 0;

  getExtension(): typeof this.extension | null {
    return this.extensionAvailable ? this.extension : null;
  }

  createQuery(): WebGLQuery {
    this.createCount++;
    return {} as WebGLQuery;
  }

  deleteQuery(): void {}

  beginQuery(): void {
    this.beginCount++;
  }

  endQuery(): void {
    this.endCount++;
  }

  getParameter(): boolean {
    return this.disjoint;
  }

  getQueryParameter(_query: WebGLQuery, pname: number): unknown {
    if (pname === this.QUERY_RESULT_AVAILABLE) return this.available;
    this.resultReadCount++;
    return this.elapsedNs;
  }
}

describe('GpuFrameTimer', () => {
  it('stays inert when timer queries are unsupported', () => {
    const gl = new FakeTimerQueryContext();
    gl.extensionAvailable = false;
    const timer = new GpuFrameTimer(gl, 2, 2);

    expect(timer.beginFrame(2)).toBe(false);
    expect(gl.createCount).toBe(0);
    expect(timer.snapshot().enabled).toBe(true);
    expect(timer.snapshot().supported).toBe(false);
  });

  it('reports disabled without touching WebGL when no context is supplied', () => {
    const timer = new GpuFrameTimer(null);
    expect(timer.snapshot()).toMatchObject({ enabled: false, supported: false, sampleCount: 0 });
  });

  it('samples at the configured cadence without reading unavailable results', () => {
    const gl = new FakeTimerQueryContext();
    const timer = new GpuFrameTimer(gl, 3, 2);

    expect(timer.beginFrame(1)).toBe(false);
    expect(timer.beginFrame(3)).toBe(true);
    timer.endFrame(true);
    expect(gl.beginCount).toBe(1);
    expect(gl.endCount).toBe(1);

    expect(timer.beginFrame(4)).toBe(false);
    expect(gl.resultReadCount).toBe(0);

    gl.available = true;
    gl.elapsedNs = 2_500_000;
    expect(timer.beginFrame(6)).toBe(true);
    expect(timer.snapshot()).toMatchObject({
      supported: true,
      sampleCount: 1,
      latestMs: 2.5,
      averageMs: 2.5,
      p95Ms: 2.5,
      maxMs: 2.5,
    });
  });

  it('discards invalid disjoint samples and reuses its fixed query ring', () => {
    const gl = new FakeTimerQueryContext();
    const timer = new GpuFrameTimer(gl, 1, 1);

    expect(timer.beginFrame(1)).toBe(true);
    timer.endFrame(true);
    gl.disjoint = true;
    expect(timer.beginFrame(2)).toBe(false);
    gl.disjoint = false;
    expect(timer.beginFrame(3)).toBe(true);
    timer.endFrame(true);
    expect(timer.snapshot()).toMatchObject({ sampleCount: 0, disjointCount: 1 });
    expect(gl.createCount).toBe(1);
  });
});
