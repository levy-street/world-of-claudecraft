// Phase 03 report-dimension pins on PerfMonitor itself: the ungated mainMs
// buckets, the arms that STAY gated, and the worst-10s window semantics
// (rulings R5 and finding 20). Lives beside tests/perf_monitor.test.ts, which
// is the phase's run-unmodified regression net; the browser-global stub is the
// same local-helper pattern that file documents.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerfMonitor } from '../src/game/perf';

function installBrowserGlobals(search = ''): { appendChild: ReturnType<typeof vi.fn> } {
  const appendChild = vi.fn();
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
      appendChild,
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
  return { appendChild };
}

function removeBrowserGlobals(): void {
  delete (globalThis as any).location;
  delete (globalThis as any).localStorage;
  delete (globalThis as any).window;
  delete (globalThis as any).document;
}

beforeEach(() => installBrowserGlobals());
afterEach(() => removeBrowserGlobals());

describe('perf monitor ungated mainMs buckets', () => {
  it('records bucket timings with the overlay disabled', () => {
    const perf = new PerfMonitor(null);
    expect(perf.enabled).toBe(false);
    for (let i = 0; i < 3; i++) perf.time('sim', () => {});
    perf.time('hud', () => {});
    const snap = perf.snapshot(1000);
    expect(snap.mainMs.sim.count).toBe(3);
    expect(snap.mainMs.hud.count).toBe(1);
    // An untouched bucket stays empty: the counts above come from the calls,
    // not from a blanket fill.
    expect(snap.mainMs.renderer.count).toBe(0);
    expect(snap.mainMs.events.count).toBe(0);
  });

  it('returns the timed function value and propagates its throw', () => {
    const perf = new PerfMonitor(null);
    expect(perf.time('events', () => 42)).toBe(42);
    expect(() =>
      perf.time('events', () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    // Both calls recorded even though the second threw (finally arm).
    expect(perf.snapshot(1000).mainMs.events.count).toBe(2);
  });

  it('records the same bucket through the allocation-free start and finish seam', () => {
    const perf = new PerfMonitor(null);
    const start = perf.startTime();
    perf.finishTime('renderer', start);
    expect(perf.snapshot(1000).mainMs.renderer.count).toBe(1);
  });

  it('keeps the overlay mount, input chain, and dev-trace spans gated while buckets record', () => {
    const { appendChild } = installBrowserGlobals();
    const perf = new PerfMonitor(null);
    perf.markInputIntent('move', 100);
    perf.markInputFrame(120);
    perf.time('sim', () => {});
    const snap = perf.snapshot(1000);
    // The bucket landed while every gated arm stayed dark.
    expect(snap.mainMs.sim.count).toBe(1);
    expect(snap.input.intents).toBe(0);
    expect(snap.input.intentToFrame.count).toBe(0);
    expect(appendChild).not.toHaveBeenCalled();
    expect(snap.devTrace).toBeUndefined();
  });

  it('still mounts the overlay and records inputs when ?perf is set', () => {
    const { appendChild } = installBrowserGlobals('?perf');
    const perf = new PerfMonitor(null);
    expect(perf.enabled).toBe(true);
    perf.markInputIntent('move', 100);
    expect(appendChild).toHaveBeenCalledTimes(1);
    expect(perf.snapshot(1000).input.intents).toBe(1);
  });
});

describe('perf monitor worst-10s window', () => {
  // Drives a hitch storm early in a long session: the cumulative percentiles
  // dilute it and the MAX_SAMPLES ring evicts it, but the retained worst-10s
  // window must still carry it at report time (finding 20).
  function stormThenHealthy(): PerfMonitor {
    const perf = new PerfMonitor(null);
    let t = 10_000;
    // 10 s of 200 ms frames with the 1 Hz tick interleaved.
    for (; t <= 20_000; t += 200) {
      perf.frame(0.2, t);
      if (t % 1000 === 0) perf.tick(t);
    }
    // Two healthy minutes at 16 ms; 7500 frames evict the storm from the ring.
    for (; t <= 140_000; t += 16) {
      perf.frame(0.016, t);
      if (t % 1000 < 16) perf.tick(t);
    }
    return perf;
  }

  it('retains the hitch storm the cumulative report dilutes and the ring evicts', () => {
    const perf = stormThenHealthy();
    const snap = perf.snapshot(140_000);
    expect(snap.windows.worst10s?.frameMs.p95).toBe(200);
    expect(snap.windows.worst10s?.atMs).toBeLessThanOrEqual(21_000);
    // The dilution the tracker exists to defeat: the storm is invisible in the
    // cumulative percentiles (evicted from the ring) and in the recent window.
    expect(snap.frameMs.p95).toBeLessThan(50);
    expect(snap.windows.last10s.frameMs.p95).toBeLessThan(50);
  });

  it('stays null before the first 1 Hz tick because snapshot is a pure read', () => {
    const perf = new PerfMonitor(null);
    for (let t = 0; t <= 2000; t += 200) perf.frame(0.2, t);
    expect(perf.snapshot(2000).windows.worst10s).toBeNull();
    perf.tick(2000);
    expect(perf.snapshot(2000).windows.worst10s?.frameMs.p95).toBe(200);
  });

  it('drains via the explicit reporter hook and restarts the interval fresh', () => {
    const perf = stormThenHealthy();
    expect(perf.snapshot(140_000).windows.worst10s?.frameMs.p95).toBe(200);
    perf.drainWorstWindow();
    expect(perf.snapshot(140_000).windows.worst10s).toBeNull();
    // The next interval retains the healthy regime, not the pre-drain storm.
    let t = 141_000;
    for (; t <= 146_000; t += 16) {
      perf.frame(0.016, t);
      if (t % 1000 < 16) perf.tick(t);
    }
    // Every post-drain frame is exactly 16 ms, so the retained window's p95
    // is exactly 16: the healthy regime, not the pre-drain 200 ms storm.
    expect(perf.snapshot(t).windows.worst10s?.frameMs.p95).toBe(16);
  });

  it('clears the worst window on reset alongside the other trackers', () => {
    const perf = stormThenHealthy();
    expect(perf.snapshot(140_000).windows.worst10s).not.toBeNull();
    perf.reset();
    expect(perf.snapshot(141_000).windows.worst10s).toBeNull();
  });
});

describe('perf monitor forensics state assembly', () => {
  // The day-night commit's claim: the forensics vector carries the dimensions
  // that separate a night hitch cluster (streetlamps lit, more active point
  // lights) from the same cluster at noon. Stub renderer, real assembly path.
  it('assembles the day-night and light dimensions from the renderer stats', () => {
    const perf = new PerfMonitor(null);
    const stats = {
      programs: 700,
      textures: 900,
      geometries: 800,
      calls: 1200,
      triangles: 9_000_000,
      views: 40,
      gpuQueue: { units: 3, totalSyncMs: 12.6, stallCount: 2 },
      effectiveRenderScale: 1,
      renderBudget: { mode: 'steady' },
      nightAmount: 0.85,
      qualityBuckets: { features: { activePointLights: 6 } },
      lastFrame: { biome: 'marsh', playerPosition: { x: 123.4, z: -55.6 }, activeViews: 33 },
    };
    perf.setRenderer({ perfStats: () => stats, setHitchLogEnabled: () => {} } as never);

    const state = (perf as never as { forensicsState(): Record<string, unknown> }).forensicsState();

    expect(state.nightAmount).toBe(0.85);
    expect(state.activePointLights).toBe(6);
    expect(state.programs).toBe(700);
    expect(state.gpuQueueSyncMs).toBe(13);
    // A wedged unit moves neither units nor sync time, so the stall counter is
    // the dimension that can bracket a hitch with a queue that stopped draining.
    expect(state.gpuQueueStalls).toBe(2);
    expect(state.biome).toBe('marsh');
    expect(state.px).toBe(123);
    expect(state.pz).toBe(-56);
    expect(state.activeViews).toBe(33);
  });
});
