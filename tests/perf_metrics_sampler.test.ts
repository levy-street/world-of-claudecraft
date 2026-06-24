import { describe, expect, it } from 'vitest';
import { createMetricsSampler, type SamplerDeps } from '../src/ui/perf_metrics_sampler';

// Fakes for the injected sources. The sampler is a pure function of these, so the
// test needs no browser globals (it injects the environment probes too).
function fakeRenderer(over: Partial<ReturnType<SamplerDeps['renderer']['perfStats']>> = {}) {
  return {
    perfStats: () => ({
      calls: 120, triangles: 80_000, geometries: 40, textures: 22, programs: 9,
      effectiveRenderScale: 0.9, glRenderer: 'FakeGPU 9000', ...over,
    }),
  };
}

const fakeMeter = {
  fps: () => 58, frameTimeMs: () => 17.2, lowFps: (pct: number) => (pct === 1 ? 48 : 41),
  graphSamples: () => [16, 17, 18, 16], hitches: () => 2,
};

function makeDeps(over: Partial<SamplerDeps> = {}): SamplerDeps {
  return {
    renderer: fakeRenderer(),
    meter: fakeMeter,
    getOnline: () => null,
    getEntityCount: () => 37,
    getEchoMs: () => 0,
    getJitterMs: () => 0,
    getApm: () => 0,
    // Inject env probes so the test is deterministic + browser-free.
    readMemory: () => null,
    readConnectionType: () => null,
    isBackgrounded: () => false,
    ...over,
  };
}

describe('createMetricsSampler', () => {
  it('carries frame-meter + renderer + world fields through', () => {
    const sample = createMetricsSampler(makeDeps())();
    expect(sample.fps).toBe(58);
    expect(sample.frameTimeMs).toBeCloseTo(17.2);
    expect(sample.fps1Low).toBe(48);
    expect(sample.fps01Low).toBe(41);
    expect(sample.frameSamples).toEqual([16, 17, 18, 16]);
    expect(sample.hitches).toBe(2);
    expect(sample.drawCalls).toBe(120);
    expect(sample.triangles).toBe(80_000);
    expect(sample.geometries).toBe(40);
    expect(sample.textures).toBe(22);
    expect(sample.programs).toBe(9);
    expect(sample.renderScale).toBe(0.9);
    expect(sample.gpu).toBe('FakeGPU 9000');
    expect(sample.entities).toBe(37);
  });

  it('nulls every network row when offline', () => {
    const sample = createMetricsSampler(makeDeps({ getOnline: () => null }))();
    expect(sample.online).toBe(false);
    expect(sample.connected).toBe(true); // offline world is "connected" to itself
    expect(sample.pingMs).toBeNull();
    expect(sample.jitterMs).toBeNull();
    expect(sample.snapshotHz).toBeNull();
  });

  it('surfaces network rows when online with a measured echo', () => {
    const sample = createMetricsSampler(makeDeps({
      getOnline: () => ({ connected: true, snapInterval: 50 }),
      getEchoMs: () => 42,
      getJitterMs: () => 6,
    }))();
    expect(sample.online).toBe(true);
    expect(sample.connected).toBe(true);
    expect(sample.pingMs).toBe(42);
    expect(sample.jitterMs).toBe(6);
    expect(sample.snapshotHz).toBe(20); // 1000 / 50ms
  });

  it('hides ping/jitter until an echo is measured (echo <= 0) but keeps snapshot', () => {
    const sample = createMetricsSampler(makeDeps({
      getOnline: () => ({ connected: false, snapInterval: 100 }),
      getEchoMs: () => 0,
    }))();
    expect(sample.online).toBe(true);
    expect(sample.connected).toBe(false);
    expect(sample.pingMs).toBeNull();
    expect(sample.jitterMs).toBeNull();
    expect(sample.snapshotHz).toBe(10);
  });

  it('reports memory only when the probe returns a reading', () => {
    expect(createMetricsSampler(makeDeps({ readMemory: () => null }))().memoryUsedMb).toBeNull();
    const withMem = createMetricsSampler(makeDeps({
      readMemory: () => ({ usedMb: 256, limitMb: 4096 }),
    }))();
    expect(withMem.memoryUsedMb).toBe(256);
    expect(withMem.memoryLimitMb).toBe(4096);
  });

  it('passes through connection type + backgrounded probes', () => {
    const sample = createMetricsSampler(makeDeps({
      readConnectionType: () => '4g',
      isBackgrounded: () => true,
    }))();
    expect(sample.connectionType).toBe('4g');
    expect(sample.backgrounded).toBe(true);
  });

  it('nulls renderScale + gpu when the renderer omits them', () => {
    const sample = createMetricsSampler(makeDeps({
      renderer: fakeRenderer({ effectiveRenderScale: null, glRenderer: null }),
    }))();
    expect(sample.renderScale).toBeNull();
    expect(sample.gpu).toBeNull();
  });
});
