import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PerfSnapshot } from '../src/game/perf';
import { diagnosePerfSnapshot, formatPerfDiagnosisMarkdown } from '../src/game/perf_diagnosis_core';

function digest(value = 0) {
  return { count: 600, avg: value, p95: value, max: value };
}

function baseSnapshot(): PerfSnapshot {
  return {
    seconds: 20,
    frames: 1200,
    fps: 60,
    frameMs: { avg: 16, p50: 16, p95: 16, p99: 18, max: 22, long50: 0 },
    windows: {
      last10s: {
        seconds: 10,
        frames: 600,
        fps: 60,
        frameMs: { avg: 16, p50: 16, p95: 16, p99: 18, max: 22, long50: 0 },
      },
      last30s: {
        seconds: 20,
        frames: 1200,
        fps: 60,
        frameMs: { avg: 16, p50: 16, p95: 16, p99: 18, max: 22, long50: 0 },
      },
      worst10s: null,
    },
    mainMs: {
      renderer: digest(5),
      hud: digest(1),
      events: digest(1),
      sim: digest(1),
    },
    renderer: {
      graphicsConfigVersion: 1,
      tier: 'high',
      qualityBuckets: {
        version: 1,
        bands: {} as never,
        baseline: {} as never,
        levels: {} as never,
        features: {
          composer: true,
          ao: true,
          standardMaterials: true,
          lowPlus: false,
          leanFoliage: false,
          terrainSplat: true,
          windSway: true,
          maxPointLights: 8,
          activePointLights: 4,
          shadowMap: 2048,
          iosMemoryProfile: false,
        },
      },
      autoGovernor: true,
      budget: {} as never,
      renderScale: 1,
      effectiveRenderScale: 1,
      renderBudget: {
        enabled: true,
        mode: 'stable',
        reason: 'stable',
        pressure: 0.2,
        frameMsEma: 16,
        submitMsEma: 4,
        externalFrameCap: false,
        stallPressure: 0,
        recentSubmitStalls: 0,
        lastSubmitStallMs: 0,
        stallHoldSeconds: 0,
        stableSeconds: 20,
        cooldownSeconds: 0,
        levels: { grass: 1, foliage: 1, vfx: 1, lighting: 1, resolution: 1 },
        caps: {
          targetCalls: 620,
          urgentCalls: 860,
          targetTriangles: 4_500_000,
          urgentTriangles: 6_500_000,
          targetGrassTufts: 6000,
          urgentGrassTufts: 8500,
          minGrassLevel: 0.6,
          minFoliageLevel: 0.6,
          minVfxLevel: 0.68,
          minLightingLevel: 0.62,
        },
      },
      pixelRatio: 1.5,
      width: 1440,
      height: 900,
      calls: 300,
      triangles: 1_000_000,
      geometries: 200,
      textures: 100,
      programs: 40,
      views: 80,
      pooledVisuals: 20,
      foliage: {} as never,
      glVendor: 'NVIDIA',
      glRenderer: 'ANGLE (NVIDIA, GeForce RTX 3060, D3D11)',
      contextLost: 0,
      contextRestored: 0,
      phaseMs: {
        setup: digest(0.5),
        entities: digest(2),
        world: digest(2),
        nameplates: digest(0.5),
        submit: digest(4),
        total: digest(9),
      },
      renderDiagnostics: {} as never,
      nightAmount: 0,
      prewarm: null,
      gpuQueue: {
        units: 0,
        totalSyncMs: 0,
        worstSyncMs: 0,
        slowest: [],
        pending: 0,
        active: null,
        waitingTails: [],
        stallCount: 0,
        stalls: [],
      },
    },
    hud: { hotDomWrites: 10, hotDomSkippedWrites: 90, hotDomSkipRate: 0.9 },
    assets: {
      preload: { tasks: 20, waitMs: 1000, complete: true },
      byType: {},
      files: [],
    },
    network: null,
    netPipeline: null,
    heapSawtooth: null,
    hitchForensics: [],
    input: {
      intents: 20,
      lastKind: 'move',
      lastIntentAge: 10,
      intentToFrame: digest(8),
      intentToSend: digest(10),
      sendToEcho: digest(40),
      intentToVisible: digest(18),
    },
    browser: {
      longTasks: { count: 0, totalMs: 0, avg: 0, p95: 0, max: 0, lastAge: -1 },
      memory: null,
      visibilityState: 'visible',
    },
    device: {
      dpr: 1.5,
      viewport: '1440x900',
      mobileTouch: false,
      userAgent: 'test',
      hardwareConcurrency: 8,
      deviceMemory: 8,
      maxTouchPoints: 0,
    },
  };
}

function makeSlow(snapshot: PerfSnapshot): void {
  snapshot.fps = 30;
  snapshot.frameMs.p95 = 40;
  snapshot.windows.last10s.fps = 30;
  snapshot.windows.last10s.frameMs.p95 = 40;
  snapshot.windows.last10s.frameMs.long50 = 4;
}

describe('diagnosePerfSnapshot', () => {
  it('returns a clear healthy result when no threshold fires', () => {
    const diagnosis = diagnosePerfSnapshot(baseSnapshot());
    expect(diagnosis.status).toBe('healthy');
    expect(diagnosis.score).toBe(100);
    expect(diagnosis.findings).toEqual([]);
  });

  it('attributes GPU pressure to the dominant measured scene category', () => {
    const snapshot = baseSnapshot();
    makeSlow(snapshot);
    const renderer = snapshot.renderer;
    if (!renderer) throw new Error('renderer fixture missing');
    renderer.calls = 930;
    renderer.triangles = 7_000_000;
    renderer.phaseMs.submit.p95 = 24;
    renderer.phaseMs.total.p95 = 30;
    renderer.renderBudget.reason = 'submit';
    renderer.renderBudget.recentSubmitStalls = 1;
    snapshot.census = {
      atMs: 1,
      tier: 'high',
      playerPosition: { x: 0, y: 0, z: 0 },
      cameraPosition: { x: 0, y: 8, z: -4 },
      baseline: { calls: 930, triangles: 7_000_000, points: 0, lines: 0 },
      shadow: { measured: true, calls: 120, triangles: 900_000, callsShare: 0.13 },
      rows: [
        {
          category: 'foliage',
          roots: 1,
          visibleRoots: 1,
          calls: 500,
          triangles: 5_500_000,
          points: 0,
          callsShare: 0.54,
          trianglesShare: 0.79,
        },
      ],
      residual: { calls: 20, triangles: 1000 },
      programs: 50,
      textures: 120,
      geometries: 220,
      renders: 5,
    };

    const diagnosis = diagnosePerfSnapshot(snapshot, '?diagnostics=1');
    expect(diagnosis.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining(['gpu-submit-bound', 'scene-draw-pressure']),
    );
    const scene = diagnosis.findings.find((finding) => finding.id === 'scene-draw-pressure');
    expect(scene?.evidence.join(' ')).toContain('foliage');
    expect(scene?.sourceFiles).toContain('src/render/foliage.ts');
  });

  it('turns hitch counters into source-specific fixes', () => {
    const snapshot = baseSnapshot();
    snapshot.hitches = {
      frames: 600,
      hitches: 6,
      byCause: { 'shader-compile': 3, 'texture-upload': 1, 'view-create': 2, other: 0 },
      programGrowthFrames: 3,
      programsAdded: 8,
      recent: [],
    };

    const diagnosis = diagnosePerfSnapshot(snapshot);
    expect(diagnosis.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining(['hitch-shader-compile', 'hitch-texture-upload', 'hitch-view-create']),
    );
    expect(
      diagnosis.findings.find((finding) => finding.id === 'hitch-shader-compile')?.sourceFiles,
    ).toContain('src/render/material_clone_hooks.ts');
  });

  it('does not label unattributed history critical when the measured recent window is healthy', () => {
    const snapshot = baseSnapshot();
    snapshot.hitches = {
      frames: 600,
      hitches: 80,
      byCause: { 'shader-compile': 0, 'texture-upload': 0, 'view-create': 0, other: 80 },
      programGrowthFrames: 0,
      programsAdded: 0,
      recent: [],
    };

    const diagnosis = diagnosePerfSnapshot(snapshot);
    expect(diagnosis.status).toBe('healthy');
    expect(diagnosis.score).toBe(100);
    expect(diagnosis.findings.some((finding) => finding.id === 'hitch-other')).toBe(false);

    makeSlow(snapshot);
    expect(
      diagnosePerfSnapshot(snapshot).findings.some((finding) => finding.id === 'hitch-other'),
    ).toBe(true);
  });
  it('requires a recurring or materially long view-create event before assigning blame', () => {
    const snapshot = baseSnapshot();
    snapshot.hitches = {
      frames: 600,
      hitches: 1,
      byCause: { 'shader-compile': 0, 'texture-upload': 0, 'view-create': 1, other: 0 },
      programGrowthFrames: 0,
      programsAdded: 0,
      recent: [
        {
          atMs: 10_000,
          frameMs: 33.4,
          submitMs: 10.4,
          programDelta: 0,
          textureDelta: 0,
          createdViews: 1,
          cause: 'view-create',
        },
      ],
    };

    expect(diagnosePerfSnapshot(snapshot).score).toBe(100);

    snapshot.hitches.recent[0].frameMs = 50;
    expect(
      diagnosePerfSnapshot(snapshot).findings.some((finding) => finding.id === 'hitch-view-create'),
    ).toBe(true);

    snapshot.hitches.recent[0].frameMs = 33.4;
    snapshot.hitches.hitches = 2;
    snapshot.hitches.byCause['view-create'] = 2;
    expect(
      diagnosePerfSnapshot(snapshot).findings.some((finding) => finding.id === 'hitch-view-create'),
    ).toBe(true);
  });

  it('separates simulation CPU cost from online snapshot delivery', () => {
    const snapshot = baseSnapshot();
    makeSlow(snapshot);
    snapshot.mainMs.sim.p95 = 14;
    snapshot.network = { connected: true, snapInterval: 160, lastSnapAge: 620, alpha: 1 };
    snapshot.input.sendToEcho.p95 = 220;

    const diagnosis = diagnosePerfSnapshot(snapshot);
    expect(diagnosis.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining(['sim-cpu', 'network-latency']),
    );
  });

  it('reports one enriched finding for browser long tasks', () => {
    const snapshot = baseSnapshot();
    makeSlow(snapshot);
    snapshot.browser.longTasks = {
      count: 4,
      totalMs: 400,
      avg: 100,
      p95: 90,
      max: 160,
      lastAge: 10,
    };
    const diagnosis = diagnosePerfSnapshot(snapshot);
    expect(diagnosis.findings).toHaveLength(1);
    expect(diagnosis.findings.map((finding) => finding.id)).toEqual(['main-thread-long-tasks']);
    expect(diagnosis.findings.some((finding) => finding.id === 'system-browser-stalls')).toBe(
      false,
    );
  });

  it('pins shadow and CPU attribution thresholds to their owning source modules', () => {
    const snapshot = baseSnapshot();
    makeSlow(snapshot);
    const renderer = snapshot.renderer;
    if (!renderer) throw new Error('renderer fixture missing');
    snapshot.census = {
      atMs: 1,
      tier: 'high',
      playerPosition: { x: 0, y: 0, z: 0 },
      cameraPosition: { x: 0, y: 8, z: -4 },
      baseline: { calls: 300, triangles: 1_000_000, points: 0, lines: 0 },
      shadow: { measured: true, calls: 120, triangles: 400_000, callsShare: 0.4 },
      rows: [],
      residual: { calls: 0, triangles: 0 },
      programs: 40,
      textures: 100,
      geometries: 200,
      renders: 2,
    };
    renderer.phaseMs.world.p95 = 7.9;
    expect(
      diagnosePerfSnapshot(snapshot).findings.some((item) => item.id === 'renderer-world-cpu'),
    ).toBe(false);

    renderer.phaseMs.world.p95 = 8;
    renderer.phaseMs.entities.p95 = 8;
    renderer.phaseMs.nameplates.p95 = 4;
    snapshot.mainMs.hud.p95 = 6;
    snapshot.mainMs.events.p95 = 5;
    const diagnosis = diagnosePerfSnapshot(snapshot);
    expect(diagnosis.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        'shadow-pass-pressure',
        'renderer-world-cpu',
        'renderer-entities-cpu',
        'renderer-nameplates-cpu',
        'hud-cpu',
        'event-cpu',
      ]),
    );
    expect(
      diagnosis.findings.find((finding) => finding.id === 'renderer-nameplates-cpu')?.sourceFiles,
    ).toContain('src/render/nameplate_painter.ts');
  });

  it('reports failed startup assets with critical severity and loader ownership', () => {
    const snapshot = baseSnapshot();
    snapshot.assets.byType.gltf = {
      count: 0,
      failed: 1,
      avgMs: 0,
      p95Ms: 0,
      maxMs: 0,
      bytes: 0,
      slowest: [],
    };
    const diagnosis = diagnosePerfSnapshot(snapshot);
    const finding = diagnosis.findings.find((item) => item.id === 'asset-startup');
    expect(finding?.severity).toBe('critical');
    expect(finding?.evidence.join(' ')).toContain('gltf');
    expect(finding?.sourceFiles).toContain('src/render/assets/loader.ts');
  });

  it('separates expensive snapshot application from network delivery', () => {
    const snapshot = baseSnapshot();
    snapshot.network = { connected: true, snapInterval: 80, lastSnapAge: 80, alpha: 1 };
    snapshot.netPipeline = {
      snapshots: 200,
      resets: 0,
      approxBytesTotal: 100_000,
      entCountTotal: 1000,
      keepCountTotal: 1000,
      parseMs: { count: 200, p50: 2, p95: 8, max: 12 },
      applyMs: { count: 200, p50: 3, p95: 7, max: 11 },
      gapMs: { count: 199, p50: 50, p95: 80, max: 100 },
      snapshotsPerRaf: { r0: 100, r1: 90, r2: 10, r3plus: 0 },
    };
    const diagnosis = diagnosePerfSnapshot(snapshot);
    const finding = diagnosis.findings.find((item) => item.id === 'snapshot-apply-cpu');
    expect(finding?.severity).toBe('warning');
    expect(finding?.evidence.join(' ')).toContain('15 ms');
    expect(finding?.sourceFiles).toContain('src/net/net_pipeline_stats.ts');
    expect(diagnosis.findings.some((item) => item.id === 'network-latency')).toBe(false);
  });
  it('formats a shareable report with evidence, fixes, source paths, and raw data', () => {
    const snapshot = baseSnapshot();
    snapshot.hitches = {
      frames: 600,
      hitches: 1,
      byCause: { 'shader-compile': 1, 'texture-upload': 0, 'view-create': 0, other: 0 },
      programGrowthFrames: 1,
      programsAdded: 2,
      recent: [],
    };
    const diagnosis = diagnosePerfSnapshot(snapshot);
    const report = formatPerfDiagnosisMarkdown(diagnosis, snapshot, {
      capturedAt: '2026-08-08T12:34:56.000Z',
    });
    expect(report).toContain('# World of ClaudeCraft performance diagnosis');
    expect(report).toContain('Captured:');
    expect(report).not.toContain('2026-08-08T12:34:56.000Z');
    expect(report).toContain('Top finding:');
    expect(report).toContain('600 measured frames');
    expect(report).toContain('Evidence:');
    expect(report).toContain('Code fix:');
    expect(report).toContain('src/render/renderer.ts');
    expect(report).toContain('## Raw snapshot');
  });

  it('keeps rendered diagnosis and report copy behind the locale catalog', () => {
    const core = readFileSync(resolve(process.cwd(), 'src/game/perf_diagnosis_core.ts'), 'utf8');
    const presentation = readFileSync(
      resolve(process.cwd(), 'src/game/perf_diagnosis_i18n.ts'),
      'utf8',
    );

    expect(core).toContain(
      'return localizePerfDiagnosis({ status, score, headline, summary, findings }, snapshot)',
    );
    expect(core).not.toContain("toLocaleString('en-US')");
    expect(presentation).toContain('tPlural(');
    expect(presentation).toContain('.summary.findings');
    expect(presentation).toContain('formatNumber(value, PERCENT)');
  });
});
