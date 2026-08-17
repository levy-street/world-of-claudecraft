// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerfMonitor } from '../src/game/perf';
import { NumberSampleRing } from '../src/game/sample_ring';
import { Renderer } from '../src/render/renderer';

afterEach(() => {
  setVisibility('visible');
  window.history.replaceState(null, '', '/');
  localStorage.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function setVisibility(value: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  document.dispatchEvent(new Event('visibilitychange'));
}

function fakeRenderer() {
  return {
    setHitchLogEnabled: vi.fn(),
    resetDiagnosticSamples: vi.fn(),
    hitchStats: () => null,
    captureSceneCensus: () => null,
    perfStats: () => null,
  };
}

describe('PerfMonitor diagnostics capture boundaries', () => {
  it('starts only after the monitor post-entry reset', async () => {
    window.history.replaceState(null, '', '/?diagnostics=1');
    const perf = new PerfMonitor(null);
    const renderer = fakeRenderer();

    perf.setRenderer(renderer as unknown as Renderer);
    let start: HTMLButtonElement | undefined;
    await vi.waitFor(() => {
      start = [...document.querySelectorAll('button')].find(
        (item) => item.textContent === 'Start 15-second scan',
      ) as HTMLButtonElement | undefined;
      expect(start).toBeDefined();
    });
    expect(start?.disabled).toBe(true);
    expect(document.body.textContent).toContain('Waiting for the first playable frame');
    expect(document.body.textContent).not.toContain('Collecting representative frames');

    perf.reset();

    expect(renderer.resetDiagnosticSamples).toHaveBeenCalledTimes(1);
    expect(start?.disabled).toBe(true);
    expect(document.body.textContent).toContain('Collecting active gameplay');
  });

  it('restarts retained frame measurements after a hidden-tab interruption', async () => {
    window.history.replaceState(null, '', '/?diagnostics=1');
    setVisibility('visible');
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const perf = new PerfMonitor(null);
    const renderer = fakeRenderer();
    perf.setRenderer(renderer as unknown as Renderer);
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Waiting for the first playable frame');
    });
    perf.reset();

    for (let frame = 0; frame < 600; frame++) {
      now += 1000 / 60;
      perf.frame(1 / 60, now);
    }
    expect(perf.snapshot(now).windows.last10s.fps).toBeGreaterThan(58);

    setVisibility('hidden');
    now += 3000;
    setVisibility('visible');
    for (let frame = 0; frame < 300; frame++) {
      now += 1000 / 60;
      perf.frame(1 / 60, now);
    }

    const resumed = perf.snapshot(now);
    expect(renderer.resetDiagnosticSamples).toHaveBeenCalledTimes(2);
    expect(resumed.frames).toBe(300);
    expect(resumed.windows.last10s.fps).toBeGreaterThan(58);
    expect(resumed.windows.last10s.fps).toBeLessThan(62);
  });

  it('lazy-loads diagnostics and threads the real desktop-shell state from main', () => {
    const perfSource = readFileSync(resolve(process.cwd(), 'src/game/perf.ts'), 'utf8');
    const mainSource = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8');

    expect(perfSource).toContain("void import('./perf_diagnostics_panel')");
    expect(perfSource).not.toContain(
      "import { PerfDiagnosticsPanel } from './perf_diagnostics_panel'",
    );
    expect(perfSource).toContain('desktopShell: this.desktopShell');
    expect(mainSource).toContain('createPerfMonitor(null, DESKTOP_APP)');
  });
  it('clears old renderer phases before a second capture', () => {
    const rings = {
      setup: new NumberSampleRing(8),
      entities: new NumberSampleRing(8),
      world: new NumberSampleRing(8),
      nameplates: new NumberSampleRing(8),
      submit: new NumberSampleRing(8),
      total: new NumberSampleRing(8),
    };
    for (const ring of Object.values(rings)) {
      ring.push(100);
      ring.push(120);
    }
    const renderer = Object.create(Renderer.prototype) as Renderer;
    Object.assign(renderer as unknown as Record<string, unknown>, {
      phaseSamples: rings,
      hitchTracker: { reset: vi.fn() },
    });

    const before = (
      renderer as unknown as { rendererPhaseStats(): { submit: { p95: number } } }
    ).rendererPhaseStats();
    expect(before.submit.p95).toBe(120);

    renderer.resetDiagnosticSamples();
    for (const ring of Object.values(rings)) ring.push(2);

    const after = (
      renderer as unknown as { rendererPhaseStats(): { submit: { p95: number } } }
    ).rendererPhaseStats();
    expect(after.submit.p95).toBe(2);
  });
});
