import { beforeEach, describe, expect, it } from 'vitest';
import type { PerfSnapshot } from '../src/game/perf';
import { perfReporterInternalsForTest } from '../src/game/perf_reporter';
import { Settings } from '../src/game/settings';

function installBrowserGlobals(): void {
  const map = new Map<string, string>();
  (globalThis as any).__APP_VERSION__ = '0.9.0';
  (globalThis as any).__APP_BUILD_ID__ = 'testbuild';
  (globalThis as any).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
  (globalThis as any).location = { search: '?perfScenario=bench_dense_foliage' };
  (globalThis as any).window = { innerWidth: 1440, innerHeight: 900 };
}

function renderDiagnostics() {
  return {
    enabled: false,
    totalObjects: 0,
    estimatedDraws: 0,
    estimatedTriangles: 0,
    estimatedPoints: 0,
    programs: 0,
    programDelta: 0,
    textures: 0,
    textureDelta: 0,
    newMaterials: [],
    firstVisibleObjects: [],
    categories: {},
  };
}

function qualityBuckets(): NonNullable<PerfSnapshot['renderer']>['qualityBuckets'] {
  return {
    version: 14,
    bands: {
      resolution: { min: 0.6, baseline: 1, max: 1, roi: 0.88, cost: 'gpu', governable: true },
      grass: { min: 0.6, baseline: 0.88, max: 1, roi: 0.86, cost: 'gpu', governable: true },
      foliage: { min: 0.6, baseline: 0.9, max: 1, roi: 0.72, cost: 'gpu', governable: true },
      props: { min: 0.7, baseline: 0.88, max: 1, roi: 0.58, cost: 'mixed', governable: false },
      lighting: { min: 0.62, baseline: 0.9, max: 1, roi: 0.7, cost: 'gpu', governable: true },
      materials: { min: 0.75, baseline: 0.92, max: 1, roi: 0.78, cost: 'gpu', governable: false },
      waterSky: { min: 0.72, baseline: 0.92, max: 1, roi: 0.82, cost: 'gpu', governable: false },
      vfx: { min: 0.68, baseline: 0.92, max: 1, roi: 0.7, cost: 'mixed', governable: true },
      characters: { min: 0.9, baseline: 1, max: 1, roi: 1, cost: 'mixed', governable: false },
      weapons: { min: 1, baseline: 1, max: 1, roi: 1, cost: 'mixed', governable: false },
      worldStreaming: {
        min: 0.55,
        baseline: 0.88,
        max: 1,
        roi: 0.62,
        cost: 'cpu',
        governable: true,
      },
      ui: { min: 0.86, baseline: 1, max: 1, roi: 0.86, cost: 'cpu', governable: false },
    },
    baseline: {
      resolution: 1,
      grass: 0.88,
      foliage: 0.9,
      props: 0.88,
      lighting: 0.9,
      materials: 0.92,
      waterSky: 0.92,
      vfx: 0.92,
      characters: 1,
      weapons: 1,
      worldStreaming: 0.88,
      ui: 1,
    },
    levels: {
      resolution: 0.9,
      grass: 1,
      foliage: 1,
      props: 0.88,
      lighting: 1,
      materials: 0.92,
      waterSky: 0.92,
      vfx: 1,
      characters: 1,
      weapons: 1,
      worldStreaming: 0.88,
      ui: 1,
    },
    features: {
      composer: true,
      ao: true,
      standardMaterials: true,
      lowPlus: false,
      leanFoliage: false,
      terrainSplat: true,
      windSway: true,
      maxPointLights: 6,
      activePointLights: 6,
      shadowMap: 4096,
    },
  };
}

function prewarmStats(): NonNullable<NonNullable<PerfSnapshot['renderer']>['prewarm']> {
  return {
    elapsedMs: 3200,
    maxMs: 5000,
    createdViews: 36,
    candidateViews: 80,
    renderPasses: 10,
    programsBefore: 10,
    programsAfter: 18,
    texturesBefore: 40,
    texturesAfter: 52,
    compileMode: 'async',
    compileMs: 480,
    compileTimedOut: false,
    timedOut: false,
    remainingMs: 1800,
    budgetUsedRatio: 0.64,
    createdViewTypes: ['player:player', 'mob:forest_wolf'],
    manifestPlanned: 14,
    manifestEntries: [
      {
        id: 'views.required',
        category: 'views',
        priority: 10,
        required: true,
        status: 'completed',
        elapsedMs: 25,
        remainingMsAfter: 4975,
        passes: 0,
        programsBefore: 10,
        programsAfter: 10,
        programDelta: 0,
        texturesBefore: 40,
        texturesAfter: 40,
        textureDelta: 0,
        detail: 'created=12',
      },
      {
        id: 'textures.scene',
        category: 'world',
        priority: 50,
        required: true,
        status: 'completed',
        elapsedMs: 120,
        remainingMsAfter: 4200,
        passes: 0,
        programsBefore: 10,
        programsAfter: 10,
        programDelta: 0,
        texturesBefore: 40,
        texturesAfter: 52,
        textureDelta: 12,
        detail: 'uploaded=12',
      },
    ],
    manifestCompleted: 12,
    manifestSkipped: 0,
    manifestTimedOut: 0,
    manifestFailed: 0,
    timedOutEntryIds: [],
    failedEntryIds: [],
    diagnosticsBaseline: null,
  };
}

function foliageCostStats(): Pick<
  NonNullable<PerfSnapshot['renderer']>['foliage'],
  | 'modelDraws'
  | 'modelVisibleDraws'
  | 'modelDrawsByLod'
  | 'modelVisibleDrawsByLod'
  | 'modelTriangles'
  | 'modelVisibleTriangles'
  | 'modelTrianglesByLod'
  | 'modelVisibleTrianglesByLod'
> {
  return {
    modelDraws: 96,
    modelVisibleDraws: 48,
    modelDrawsByLod: { core: 32, impostor: 12, dressing: 20 },
    modelVisibleDrawsByLod: { core: 24, impostor: 8, dressing: 16 },
    modelTriangles: 1_200_000,
    modelVisibleTriangles: 540_000,
    modelTrianglesByLod: { core: 900_000, impostor: 24_000, dressing: 80_000 },
    modelVisibleTrianglesByLod: { core: 420_000, impostor: 16_000, dressing: 64_000 },
  };
}

function snapshot(): PerfSnapshot {
  return {
    seconds: 80,
    frames: 4800,
    fps: 60,
    frameMs: { avg: 16.6, p50: 16, p95: 19, p99: 28, max: 52, long50: 1 },
    windows: {
      last10s: {
        seconds: 10,
        frames: 600,
        fps: 60,
        frameMs: { avg: 16.6, p50: 16, p95: 18, p99: 24, max: 40, long50: 0 },
      },
      last30s: {
        seconds: 30,
        frames: 1800,
        fps: 60,
        frameMs: { avg: 16.6, p50: 16, p95: 19, p99: 28, max: 52, long50: 1 },
      },
    },
    mainMs: { renderer: { count: 1, avg: 5, p95: 5, max: 5 } },
    renderer: {
      graphicsConfigVersion: 14,
      tier: 'high',
      qualityBuckets: qualityBuckets(),
      autoGovernor: true,
      budget: {
        targetFps: 60,
        minRenderScaleDesktop: 0.7,
        minRenderScaleMobile: 0.6,
        maxRenderScale: 1,
        dropFrameMs: 22,
        urgentFrameMs: 32,
        recoverFrameMs: 15,
        dropStep: 0.1,
        urgentDropStep: 0.15,
        recoverStep: 0.05,
        recoverStableSeconds: 7,
        cooldownSeconds: 1.35,
      },
      renderScale: 1,
      effectiveRenderScale: 0.9,
      renderBudget: {
        enabled: true,
        mode: 'stable',
        reason: 'stable',
        pressure: 0.4,
        frameMsEma: 16.7,
        submitMsEma: 1,
        externalFrameCap: false,
        stallPressure: 0,
        recentSubmitStalls: 0,
        lastSubmitStallMs: 0,
        stallHoldSeconds: 0,
        stableSeconds: 0,
        cooldownSeconds: 0,
        levels: { grass: 1, foliage: 1, vfx: 1, lighting: 1, resolution: 0.9 },
        caps: {
          targetCalls: 330,
          urgentCalls: 500,
          targetTriangles: 1100000,
          urgentTriangles: 1750000,
          targetGrassTufts: 2850,
          urgentGrassTufts: 4500,
          minGrassLevel: 0.6,
          minFoliageLevel: 0.6,
          minVfxLevel: 0.68,
          minLightingLevel: 0.62,
        },
      },
      pixelRatio: 1.5,
      width: 1440,
      height: 900,
      calls: 500,
      triangles: 300000,
      geometries: 120,
      textures: 80,
      programs: 30,
      views: 40,
      foliage: {
        modelQuality: 1,
        modelBuckets: 64,
        modelVisibleBuckets: 48,
        modelBucketsByLod: { core: 32, impostor: 12, dressing: 20 },
        modelVisibleByLod: { core: 24, impostor: 8, dressing: 16 },
        ...foliageCostStats(),
        grassEnabled: true,
        grassQuality: 1,
        grassActiveRadius: 82,
        grassChunks: 48,
        grassReadyChunks: 48,
        grassVisibleChunks: 42,
        grassQueuedChunks: 0,
        grassTufts: 12000,
        grassVisibleTufts: 9800,
        grassBuiltChunks: 52,
        grassDisposedChunks: 4,
        grassLastBuildMs: 1.2,
        grassBuildMs: 55,
        grassCacheLimit: 96,
      },
      glVendor: 'Apple',
      glRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro)',
      contextLost: 0,
      contextRestored: 0,
      phaseMs: {
        setup: { count: 1, avg: 1, p95: 1, max: 1 },
        entities: { count: 1, avg: 1, p95: 1, max: 1 },
        world: { count: 1, avg: 1, p95: 1, max: 1 },
        nameplates: { count: 1, avg: 1, p95: 1, max: 1 },
        submit: { count: 1, avg: 1, p95: 1, max: 1 },
        total: { count: 1, avg: 5, p95: 5, max: 5 },
      },
      renderDiagnostics: renderDiagnostics(),
      prewarm: prewarmStats(),
    },
    hud: null,
    assets: { preload: { tasks: 0, waitMs: 0, complete: true }, byType: {}, files: [] },
    network: null,
    input: {
      intents: 0,
      lastKind: '',
      lastIntentAge: -1,
      intentToFrame: { count: 0, avg: 0, p95: 0, max: 0 },
      intentToSend: { count: 0, avg: 0, p95: 0, max: 0 },
      sendToEcho: { count: 0, avg: 0, p95: 0, max: 0 },
      intentToVisible: { count: 0, avg: 0, p95: 0, max: 0 },
    },
    browser: {
      longTasks: { count: 2, totalMs: 120, avg: 60, p95: 80, max: 80, lastAge: 1000 },
      memory: {
        usedJSHeapSize: 1,
        totalJSHeapSize: 2,
        jsHeapSizeLimit: 3,
        usedMB: 100,
        limitMB: 4096,
      },
      visibilityState: 'visible',
    },
    device: {
      dpr: 2,
      viewport: '1440x900',
      mobileTouch: false,
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
      hardwareConcurrency: 12,
      deviceMemory: 8,
      maxTouchPoints: 0,
    },
  };
}

beforeEach(() => installBrowserGlobals());

describe('perf reporter payload', () => {
  it('summarizes renderer performance without copying the full user agent', () => {
    const settings = new Settings();
    const body = perfReporterInternalsForTest.payloadFromSnapshot(
      snapshot(),
      settings,
      'sess1',
      42,
    )!;

    expect(body.releaseVersion).toBe('0.9.0');
    expect(body.buildId).toBe('testbuild');
    // The default graphicsPreset is MEDIUM: a fresh Settings() with no stored preset
    // reports medium; first-run device detection (main.ts) would persist a device tier, but
    // this unit constructs Settings directly with no persisted value.
    expect(body.graphicsPreset).toBe('medium');
    expect(body.graphicsConfigVersion).toBe(14);
    expect(body.gfxTier).toBe('high');
    expect(body.autoGovernor).toBe(true);
    expect(body.effectiveRenderScale).toBe(0.9);
    expect(body.browserFamily).toBe('safari');
    expect(body.osFamily).toBe('macos');
    expect(body.glRendererBucket).toBe('apple-m3-pro');
    expect(body.source).toBe('benchmark');
    expect(body.zoneOrScenario).toBe('bench_dense_foliage');
    expect(JSON.stringify(body.rawSummary)).not.toContain('Safari/605');
    expect((body.rawSummary as { graphicsConfigVersion?: number }).graphicsConfigVersion).toBe(14);
    expect(
      (body.rawSummary as { rendererQualityBuckets?: { levels?: { foliage?: number } } })
        .rendererQualityBuckets?.levels?.foliage,
    ).toBe(1);
    expect(
      (body.rawSummary as { rendererQualityBuckets?: { levels?: { weapons?: number } } })
        .rendererQualityBuckets?.levels?.weapons,
    ).toBe(1);
    expect(
      (body.rawSummary as { rendererPrewarmSummary?: { manifestPlanned?: number } })
        .rendererPrewarmSummary?.manifestPlanned,
    ).toBe(14);
    expect(
      (body.rawSummary as { rendererPrewarmSummary?: { entries?: unknown[] } })
        .rendererPrewarmSummary?.entries,
    ).toHaveLength(2);
    expect(
      (body.rawSummary as { rendererPrewarm?: { manifestEntries?: unknown[] } }).rendererPrewarm
        ?.manifestEntries,
    ).toHaveLength(2);
    expect(
      (body.rawSummary as { rendererFoliage?: { modelVisibleTrianglesByLod?: { core?: number } } })
        .rendererFoliage?.modelVisibleTrianglesByLod?.core,
    ).toBe(420_000);
  });

  it('keeps local dev trace frames and long-task correlation in raw summary', () => {
    const settings = new Settings();
    const snap = snapshot();
    snap.devTrace = {
      enabled: true,
      worstFrameLimit: 40,
      minFrameMs: 33,
      frames: [
        {
          atMs: 1200,
          frameMs: 80,
          scoreMs: 80,
          reasons: ['frame-gap'],
          mainMs: { renderer: 20, hud: 2, events: 0, sim: 0 },
          renderer: {
            calls: 200,
            triangles: 300000,
            textures: 80,
            programs: 30,
            views: 40,
            renderScale: 1,
            effectiveRenderScale: 0.9,
            renderBudget: {
              enabled: true,
              mode: 'stable',
              reason: 'stable',
              pressure: 0.4,
              frameMsEma: 16.7,
              submitMsEma: 1,
              externalFrameCap: false,
              stallPressure: 0,
              recentSubmitStalls: 0,
              lastSubmitStallMs: 0,
              stallHoldSeconds: 0,
              stableSeconds: 0,
              cooldownSeconds: 0,
              levels: { grass: 1, foliage: 1, vfx: 1, lighting: 1, resolution: 0.9 },
              caps: {
                targetCalls: 330,
                urgentCalls: 500,
                targetTriangles: 1100000,
                urgentTriangles: 1750000,
                targetGrassTufts: 2850,
                urgentGrassTufts: 4500,
                minGrassLevel: 0.6,
                minFoliageLevel: 0.6,
                minVfxLevel: 0.68,
                minLightingLevel: 0.62,
              },
            },
            qualityBuckets: qualityBuckets(),
            pixelRatio: 1.5,
            width: 1440,
            height: 900,
            foliage: {
              modelQuality: 1,
              modelBuckets: 64,
              modelVisibleBuckets: 48,
              modelBucketsByLod: { core: 32, impostor: 12, dressing: 20 },
              modelVisibleByLod: { core: 24, impostor: 8, dressing: 16 },
              ...foliageCostStats(),
              grassEnabled: true,
              grassQuality: 1,
              grassActiveRadius: 82,
              grassChunks: 48,
              grassReadyChunks: 48,
              grassVisibleChunks: 42,
              grassQueuedChunks: 0,
              grassTufts: 12000,
              grassVisibleTufts: 9800,
              grassBuiltChunks: 52,
              grassDisposedChunks: 4,
              grassLastBuildMs: 1.2,
              grassBuildMs: 55,
              grassCacheLimit: 96,
            },
            lastFrame: null,
          },
          browser: {
            longTaskCount: 1,
            longTaskTotalMs: 70,
            longTaskLastAgeMs: 15,
            memoryUsedMb: 100,
          },
        },
      ],
      spans: [
        {
          atMs: 1190,
          startMs: 1110,
          endMs: 1190,
          durationMs: 80,
          name: 'renderer.sync',
          kind: 'external',
          detail: { views: 42 },
        },
      ],
      longTasks: [
        {
          startMs: 1100,
          endMs: 1170,
          durationMs: 70,
          name: 'self',
          entryType: 'longtask',
          attribution: [],
          nearestFrameAtMs: 1200,
          nearestFrameMs: 80,
          nearestFrameDeltaMs: 65,
          nearestSpanName: 'renderer.sync',
          nearestSpanMs: 80,
          nearestSpanDeltaMs: 0,
        },
      ],
    };

    const body = perfReporterInternalsForTest.payloadFromSnapshot(snap, settings, 'sess1', 42)!;

    const rawSummary = body.rawSummary as {
      devTrace: {
        frames: Array<{ renderer: { calls: number } }>;
        spans: Array<{ name: string; detail?: { views?: number } }>;
        longTasks: Array<{ nearestFrameMs?: number }>;
      };
    };
    expect(rawSummary.devTrace.frames[0].renderer.calls).toBe(200);
    expect(rawSummary.devTrace.spans[0].name).toBe('renderer.sync');
    expect(rawSummary.devTrace.spans[0].detail?.views).toBe(42);
    expect(rawSummary.devTrace.longTasks[0].nearestFrameMs).toBe(80);
    expect(
      (body.rawSummary as { rendererFoliage?: { grassVisibleChunks?: number } }).rendererFoliage
        ?.grassVisibleChunks,
    ).toBe(42);
    expect(
      (body.rawSummary as { rendererBudget?: { levels?: { grass?: number } } }).rendererBudget
        ?.levels?.grass,
    ).toBe(1);
    expect(
      (body.rawSummary as { rendererQualityBuckets?: { features?: { windSway?: boolean } } })
        .rendererQualityBuckets?.features?.windSway,
    ).toBe(true);
    expect(
      (body.rawSummary as { rendererDiagnostics?: { enabled?: boolean } }).rendererDiagnostics
        ?.enabled,
    ).toBe(false);
  });
});

describe('gpuBucket software classification', () => {
  const { gpuBucket } = perfReporterInternalsForTest;

  it('buckets WARP and other software rasterizers as software (WARP was missed before)', () => {
    // WARP: the Windows D3D11 software fallback Chromium 141 switched to after removing SwiftShader.
    expect(
      gpuBucket('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)'),
    ).toBe('software');
    expect(gpuBucket('Google SwiftShader')).toBe('software');
    expect(gpuBucket('Mesa/X.org llvmpipe (LLVM 15.0.6, 256 bits)')).toBe('software');
  });

  it('keeps real GPUs in their own hardware buckets', () => {
    expect(
      gpuBucket(
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 (0x00002204) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      ),
    ).toBe('nvidia');
    expect(
      gpuBucket(
        'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00003EA0) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      ),
    ).toBe('intel-uhd');
  });
});
