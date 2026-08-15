// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PerfSnapshot } from '../src/game/perf';
import {
  localDiagnosticsCaptureEnabled,
  PerfDiagnosticsPanel,
} from '../src/game/perf_diagnostics_panel';

function digest(value = 0) {
  return { count: 600, avg: value, p95: value, max: value };
}

function snapshot(): PerfSnapshot {
  const frameMs = { avg: 16, p50: 16, p95: 16, p99: 18, max: 22, long50: 0 };
  return {
    seconds: 20,
    frames: 1200,
    fps: 60,
    frameMs,
    windows: {
      last10s: { seconds: 10, frames: 600, fps: 60, frameMs },
      last30s: { seconds: 20, frames: 1200, fps: 60, frameMs },
      worst10s: null,
    },
    mainMs: {
      renderer: digest(5),
      hud: digest(1),
      events: digest(1),
      sim: digest(1),
    },
    renderer: null,
    hud: null,
    assets: {
      preload: { tasks: 0, waitMs: 0, complete: true },
      byType: {},
      files: [],
    },
    network: null,
    netPipeline: null,
    heapSawtooth: null,
    hitchForensics: [],
    input: {
      intents: 0,
      lastKind: '',
      lastIntentAge: -1,
      intentToFrame: digest(),
      intentToSend: digest(),
      sendToEcho: digest(),
      intentToVisible: digest(),
    },
    browser: {
      longTasks: { count: 0, totalMs: 0, avg: 0, p95: 0, max: 0, lastAge: -1 },
      memory: null,
      visibilityState: 'visible',
    },
    device: {
      dpr: 1,
      viewport: '1280x720',
      mobileTouch: false,
      userAgent: 'test',
      hardwareConcurrency: 8,
      deviceMemory: 8,
      maxTouchPoints: 0,
    },
  };
}

function setVisibility(value: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  setVisibility('visible');
  history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('PerfDiagnosticsPanel', () => {
  it('wires the local collector and unattended offline launch path', () => {
    const vite = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    const main = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const launcher = readFileSync(
      resolve(process.cwd(), 'diagnostics/start-diagnostics.ps1'),
      'utf8',
    );
    const readme = readFileSync(resolve(process.cwd(), 'diagnostics/README.md'), 'utf8');

    expect(vite).toContain("'/__diagnostics/capture'");
    expect(vite).toContain("'/__diagnostics/latest'");
    expect(main).toContain("startupParams.get('diagnosticsAuto') === '1'");
    expect(launcher).toContain('diagnosticsAuto=1');
    expect(launcher).toContain('diagnosticsCapture=1');
    expect(launcher).toContain('[switch]$AllowSparseCheckoutMutation');
    expect(launcher).toContain('if (-not $AllowSparseCheckoutMutation)');
    expect(readme).toContain('-AllowSparseCheckoutMutation');
  });

  it('only enables unattended report capture on an explicit local URL', () => {
    expect(localDiagnosticsCaptureEnabled('?diagnosticsCapture=1', '127.0.0.1')).toBe(true);
    expect(localDiagnosticsCaptureEnabled('?diagnosticsCapture=1', 'localhost')).toBe(true);
    expect(localDiagnosticsCaptureEnabled('?diagnosticsCapture=1', 'example.com')).toBe(false);
    expect(localDiagnosticsCaptureEnabled('', '127.0.0.1')).toBe(false);
  });

  it('posts the completed report to the local collector when explicitly requested', async () => {
    history.replaceState(null, '', '/?diagnostics=1&diagnosticsCapture=1');
    setVisibility('visible');
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const post = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    const sample = snapshot();
    const panel = new PerfDiagnosticsPanel({
      startMeasurement: vi.fn(),
      snapshot: () => sample,
      runSceneCensus: vi.fn(() => null),
      desktopShell: false,
    });

    panel.setReady(true);
    panel.onMonitorReset();
    now += 15_000;
    panel.update(sample);
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));

    const [url, init] = post.mock.calls[0];
    expect(url).toBe('/__diagnostics/capture');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'text/markdown;charset=UTF-8' },
    });
    expect(String(init?.body)).toContain('# World of ClaudeCraft performance diagnosis');
  });

  it('excludes hidden-tab gaps from the required active gameplay time', () => {
    setVisibility('visible');
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const startMeasurement = vi.fn();
    const runSceneCensus = vi.fn(() => null);
    const sample = snapshot();
    const panel = new PerfDiagnosticsPanel({
      startMeasurement,
      snapshot: () => sample,
      runSceneCensus,
      desktopShell: false,
    });

    const start = [...document.querySelectorAll('button')].find(
      (item) => item.textContent === 'Start 15-second scan',
    );
    expect(document.body.textContent).toContain('Waiting for the game world');
    panel.setReady(true);
    expect(document.body.textContent).toContain('Waiting for the first playable frame');
    expect(document.body.textContent).not.toContain('Collecting representative frames');
    expect(start?.disabled).toBe(true);
    const census = [...document.querySelectorAll('button')].find(
      (item) => item.textContent === 'Refresh scene census',
    );
    expect(census?.disabled).toBe(true);

    panel.onMonitorReset();
    expect(document.body.textContent).toContain('Collecting active gameplay');
    expect(start?.disabled).toBe(true);
    expect(startMeasurement).not.toHaveBeenCalled();

    for (let second = 0; second < 4; second++) {
      now += 1000;
      panel.update(sample);
    }
    setVisibility('hidden');
    now += 12_000;
    setVisibility('visible');
    sample.windows.last10s.frames = 1;
    panel.update(sample);

    expect(runSceneCensus).not.toHaveBeenCalled();
    expect(startMeasurement).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('15 seconds remaining');

    now += 1000;
    panel.update(sample);
    expect(runSceneCensus).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('14 seconds remaining');

    sample.windows.last10s.frames = 30;
    now += 14_000;
    panel.update(sample);
    expect(runSceneCensus).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('No material performance problem detected');
    expect(document.body.textContent).toContain('No actionable threshold fired');
    const copy = [...document.querySelectorAll('button')].find(
      (item) => item.textContent === 'Copy clear report',
    );
    expect(copy?.disabled).toBe(false);
    expect(census?.disabled).toBe(false);
    expect(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(
      '100',
    );
  });

  it('refreshes only census data on the frozen completed snapshot', () => {
    setVisibility('visible');
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sample = snapshot();
    const snapshotRead = vi.fn(() => sample);
    const refreshedCensus: NonNullable<PerfSnapshot['census']> = {
      atMs: 1,
      tier: 'high',
      playerPosition: { x: 0, y: 0, z: 0 },
      cameraPosition: { x: 0, y: 8, z: -4 },
      baseline: { calls: 10, triangles: 100, points: 0, lines: 0 },
      shadow: { measured: true, calls: 1, triangles: 10, callsShare: 0.1 },
      rows: [],
      residual: { calls: 0, triangles: 0 },
      programs: 1,
      textures: 1,
      geometries: 1,
      renders: 1,
    };
    const runSceneCensus = vi.fn(() => refreshedCensus);
    const panel = new PerfDiagnosticsPanel({
      startMeasurement: vi.fn(),
      snapshot: snapshotRead,
      runSceneCensus,
      desktopShell: false,
    });
    panel.setReady(true);
    panel.onMonitorReset();
    now += 15_000;
    panel.update(sample);

    expect(snapshotRead).toHaveBeenCalledTimes(1);
    sample.windows.last10s.fps = 10;
    sample.windows.last10s.frameMs.p95 = 100;
    const refresh = [...document.querySelectorAll('button')].find(
      (item) => item.textContent === 'Refresh scene census',
    );
    refresh?.click();

    expect(runSceneCensus).toHaveBeenCalledTimes(2);
    expect(snapshotRead).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('No material performance problem detected');
  });

  it('resets retained measurements before every manual scan', () => {
    setVisibility('visible');
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const startMeasurement = vi.fn();
    const sample = snapshot();
    const panel = new PerfDiagnosticsPanel({
      startMeasurement,
      snapshot: () => sample,
      runSceneCensus: vi.fn(() => null),
      desktopShell: false,
    });
    panel.setReady(true);
    panel.onMonitorReset();

    now += 16_000;
    panel.update(sample);
    const start = [...document.querySelectorAll('button')].find(
      (item) => item.textContent === 'Scan another area',
    );
    start?.click();

    expect(startMeasurement).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('Collecting active gameplay');
    expect(start?.disabled).toBe(true);
  });

  it('fully collapses and expands the diagnostic body', () => {
    const panel = new PerfDiagnosticsPanel({
      startMeasurement: vi.fn(),
      snapshot,
      runSceneCensus: vi.fn(() => null),
      desktopShell: false,
    });
    panel.setReady(true);

    const minimize = [...document.querySelectorAll('button')].find(
      (item) => item.textContent === 'Minimize',
    );
    const status = document.querySelector<HTMLElement>('[role="status"]');
    const progress = document.querySelector<HTMLElement>('[role="progressbar"]');
    expect(progress?.getAttribute('aria-valuenow')).toBe('0');

    minimize?.click();
    expect(minimize?.textContent).toBe('Expand');
    expect(minimize?.getAttribute('aria-expanded')).toBe('false');
    expect(status?.hidden).toBe(true);
    expect(progress?.hidden).toBe(true);

    minimize?.click();
    expect(minimize?.textContent).toBe('Minimize');
    expect(status?.hidden).toBe(false);
    expect(progress?.hidden).toBe(false);
  });

  it('renders the completed diagnosis and report through the active locale catalog', async () => {
    history.replaceState(null, '', '/?diagnostics=1&lang=en_XA');
    vi.resetModules();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sample = snapshot();
    sample.fps = 30;
    sample.frameMs.p95 = 40;
    sample.windows.last10s.fps = 30;
    sample.windows.last10s.frameMs.p95 = 40;
    sample.windows.last10s.frameMs.long50 = 4;
    sample.mainMs.sim.p95 = 14;
    const { PerfDiagnosticsPanel: PseudoLocalizedPanel } = await import(
      '../src/game/perf_diagnostics_panel'
    );
    const diagnosisModule = await import('../src/game/perf_diagnosis_core');
    const panel = new PseudoLocalizedPanel({
      startMeasurement: vi.fn(),
      snapshot: () => sample,
      runSceneCensus: vi.fn(() => null),
      desktopShell: false,
    });

    panel.setReady(true);
    panel.onMonitorReset();
    now += 15_000;
    panel.update(sample);

    const root = document.querySelector<HTMLElement>('#woc-diagnostics-panel');
    const panelText = root?.textContent ?? '';
    const panelAria = root?.getAttribute('aria-label') ?? '';
    const buttons = [...(root?.querySelectorAll('button') ?? [])];
    const report = diagnosisModule.formatPerfDiagnosisMarkdown(
      diagnosisModule.diagnosePerfSnapshot(sample),
      sample,
    );

    expect(panelAria).toMatch(/^\[.*\]$/);
    expect(buttons).not.toHaveLength(0);
    expect(buttons.every((item) => /^\[.*\]$/.test(item.textContent ?? ''))).toBe(true);
    for (const rawEnglish of [
      'ClaudeCraft Performance Doctor',
      'Simulation work is consuming the frame',
      'A measured CPU phase is taking enough main-thread time',
      'Measured phase sim-cpu has a p95',
      'Repeat the scan while idle and while moving',
      'Profile the named phase',
      'actionable finding from the last 10 seconds',
    ]) {
      expect(panelText).not.toContain(rawEnglish);
      expect(report).not.toContain(rawEnglish);
    }
    expect(report).not.toContain('# World of ClaudeCraft performance diagnosis');
    expect(report).not.toContain('Top finding:');
    expect(report).not.toContain('Raw snapshot');
  });
});
