import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PerfMonitor } from '../src/game/perf';
import type { NetPipelineSummary } from '../src/net/net_pipeline_stats';
import type { Renderer } from '../src/render/renderer';
import type { SceneCensusReport } from '../src/render/scene_census_core';

const MB = 1024 * 1024;

// PerfMonitor is a browser-host class; stub the handful of globals its
// constructor and snapshot() touch (the perf_reporter.test.ts pattern). The
// default stub leaves the overlay DISABLED: no ?perf, no stored woc_perf.
function installBrowserGlobals(search = ''): void {
  (globalThis as any).location = { search, hostname: 'localhost' };
  (globalThis as any).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  (globalThis as any).window = { devicePixelRatio: 2, innerWidth: 1440, innerHeight: 900 };
  (globalThis as any).document = {
    visibilityState: 'visible',
    body: {
      classList: { contains: () => false },
      appendChild: () => {},
    },
    createElement: () => ({
      style: {},
      addEventListener: () => {},
      appendChild: () => {},
    }),
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'test-agent', hardwareConcurrency: 8, maxTouchPoints: 0 },
    configurable: true,
    writable: true,
  });
}

function removeBrowserGlobals(): void {
  delete (globalThis as any).location;
  delete (globalThis as any).localStorage;
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (performance as any).memory;
}

function netPipelineFixture(): NetPipelineSummary {
  return {
    snapshots: 240,
    resets: 1,
    approxBytesTotal: 480_000,
    entCountTotal: 960,
    keepCountTotal: 3120,
    parseMs: { count: 240, p50: 0.4, p95: 1.2, max: 6.5 },
    applyMs: { count: 240, p50: 0.9, p95: 2.8, max: 11.2 },
    gapMs: { count: 239, p50: 50, p95: 78, max: 900 },
    snapshotsPerRaf: { r0: 410, r1: 280, r2: 24, r3plus: 6 },
  };
}

beforeEach(() => installBrowserGlobals());
afterEach(() => removeBrowserGlobals());

describe('perf monitor ungated net pipeline', () => {
  it('keeps netPipeline in the snapshot while the gated network block stays null when disabled', () => {
    const perf = new PerfMonitor(null);
    expect(perf.enabled).toBe(false);

    // both setters written; only the ungated one may land (ruling R9)
    perf.setNetwork({ connected: true, snapInterval: 50, lastSnapAge: 10, alpha: 1 });
    const summary = netPipelineFixture();
    perf.setNetPipelineSource({ summary: () => summary });

    const snap = perf.snapshot(1000);
    expect(snap.network).toBeNull();
    expect(snap.netPipeline).toEqual(summary);
    expect(snap.netPipeline?.gapMs.max).toBe(900);
  });

  it('clears netPipeline and the heap tracker on reset', () => {
    (performance as any).memory = {
      usedJSHeapSize: 100 * MB,
      totalJSHeapSize: 200 * MB,
      jsHeapSizeLimit: 4096 * MB,
    };
    const perf = new PerfMonitor(null);
    perf.setNetPipelineSource({ summary: () => netPipelineFixture() });
    perf.tick(1000);
    perf.tick(2000);
    // both blocks are live before the reset, so the nulls below are decisive
    expect(perf.snapshot(2000).netPipeline).not.toBeNull();
    expect(perf.snapshot(2000).heapSawtooth).not.toBeNull();

    perf.reset();
    expect(perf.snapshot(3000).netPipeline).toBeNull();
    expect(perf.snapshot(3000).heapSawtooth).toBeNull();
  });
});

describe('perf monitor heap sawtooth sampling', () => {
  it('samples the heap at 1 Hz from the ungated tick and serves the summary in the snapshot', () => {
    (performance as any).memory = {
      usedJSHeapSize: 100 * MB,
      totalJSHeapSize: 200 * MB,
      jsHeapSizeLimit: 4096 * MB,
    };
    const perf = new PerfMonitor(null);
    expect(perf.enabled).toBe(false);

    perf.tick(1000);
    (performance as any).memory.usedJSHeapSize = 130 * MB;
    // inside the 1 Hz throttle window: must NOT take a second sample
    perf.tick(1500);
    perf.tick(2000);

    const heap = perf.snapshot(2000).heapSawtooth;
    expect(heap?.samples).toBe(2);
    // 30 MB risen over the 1 s between the two 1 Hz samples
    expect(heap?.allocRateMbPerSec).toBe(30);
    expect(heap?.lastUsedMb).toBe(130);
  });

  it('yields a null heap block off Chromium where performance.memory is absent', () => {
    const perf = new PerfMonitor(null);
    perf.tick(1000);
    perf.tick(2000);
    perf.tick(3000);
    expect(perf.snapshot(3000).heapSawtooth).toBeNull();
  });
});

describe('perf monitor external dev-trace spans', () => {
  it('records external spans on the external kind when the dev trace is active', () => {
    installBrowserGlobals('?perfTrace=1');
    const perf = new PerfMonitor(null);
    perf.recordExternalSpan('net.parse', 0, 20, { approxBytes: 2048 });

    const spans = perf.snapshot(1000).devTrace?.spans ?? [];
    const external = spans.find((s) => s.name === 'net.parse');
    expect(external?.kind).toBe('external');
    expect(external?.durationMs).toBe(20);
    expect(external?.detail?.approxBytes).toBe(2048);
  });

  it('drops external spans silently when the dev trace is off', () => {
    const perf = new PerfMonitor(null);
    perf.recordExternalSpan('net.parse', 0, 20);
    expect(perf.snapshot(1000).devTrace).toBeUndefined();
  });
});

// Scene census + hitch wiring (src/render/scene_census_core.ts consumers). The
// fake renderer is a narrow structural mirror of the two members PerfMonitor
// touches plus perfStats (which snapshot() always reads).
describe('perf monitor scene census wiring', () => {
  function censusReport(): SceneCensusReport {
    return {
      atMs: 123,
      tier: 'ultra',
      playerPosition: { x: 1, y: 2, z: 3 },
      cameraPosition: { x: 1, y: 8, z: -3 },
      baseline: { calls: 51, triangles: 6404, points: 0, lines: 0 },
      shadow: { measured: true, calls: 12, triangles: 700, callsShare: 0.235 },
      rows: [
        {
          category: 'props',
          roots: 3,
          visibleRoots: 3,
          calls: 28,
          triangles: 5000,
          points: 0,
          callsShare: 0.549,
          trianglesShare: 0.781,
        },
      ],
      residual: { calls: 4, triangles: 4 },
      programs: 42,
      textures: 7,
      geometries: 9,
      renders: 5,
    };
  }

  function fakeRenderer() {
    return {
      hitchEnabled: [] as boolean[],
      setHitchLogEnabled(enabled: boolean) {
        this.hitchEnabled.push(enabled);
      },
      hitchStats: () => ({
        frames: 100,
        hitches: 2,
        byCause: { 'shader-compile': 1, 'texture-upload': 0, 'view-create': 0, other: 1 },
        programGrowthFrames: 1,
        programsAdded: 3,
        recent: [],
      }),
      captureSceneCensus: censusReport,
      perfStats: () => null,
    };
  }

  it('gates the renderer hitch log on the overlay enable state', () => {
    const offRenderer = fakeRenderer();
    const off = new PerfMonitor(offRenderer as unknown as Renderer);
    expect(off.enabled).toBe(false);
    expect(offRenderer.hitchEnabled).toEqual([false]);

    installBrowserGlobals('?perf');
    const onRenderer = fakeRenderer();
    const on = new PerfMonitor(null);
    on.setRenderer(onRenderer as unknown as Renderer);
    expect(on.enabled).toBe(true);
    expect(onRenderer.hitchEnabled).toEqual([true]);
  });

  it('runs the census through the renderer and serves census + hitches in the snapshot', () => {
    installBrowserGlobals('?perf');
    const perf = new PerfMonitor(fakeRenderer() as unknown as Renderer);
    expect(perf.snapshot(1000).census).toBeUndefined();

    const report = perf.runSceneCensus();
    expect(report?.baseline.calls).toBe(51);

    const snap = perf.snapshot(2000);
    expect(snap.census?.baseline.calls).toBe(51);
    expect(snap.census?.rows[0]?.category).toBe('props');
    expect(snap.hitches?.hitches).toBe(2);
    expect(snap.hitches?.byCause['shader-compile']).toBe(1);
  });

  it('drops the one self-inflicted frame sample after a census run', () => {
    installBrowserGlobals('?perf');
    const perf = new PerfMonitor(fakeRenderer() as unknown as Renderer);
    perf.frame(0.016, 1000);
    perf.runSceneCensus();
    // The burst inflates the next rAF gap; that sample must not be recorded.
    perf.frame(0.2, 1300);
    perf.frame(0.016, 1316);
    const snap = perf.snapshot(2000);
    expect(snap.frames).toBe(2);
    expect(snap.frameMs.max).toBeLessThan(50);
  });

  it('clears the stored census on reset', () => {
    installBrowserGlobals('?perf');
    const perf = new PerfMonitor(fakeRenderer() as unknown as Renderer);
    perf.runSceneCensus();
    expect(perf.snapshot(1000).census).toBeDefined();
    perf.reset();
    expect(perf.snapshot(2000).census).toBeUndefined();
  });

  it('returns null before a renderer exists and omits the optional fields', () => {
    const perf = new PerfMonitor(null);
    expect(perf.runSceneCensus()).toBeNull();
    const snap = perf.snapshot(1000);
    expect(snap.census).toBeUndefined();
    expect(snap.hitches).toBeUndefined();
  });
});
