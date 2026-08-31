import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerfMonitor, PerfSnapshot } from '../src/game/perf';
import { jitteredPerfReportDelay } from '../src/game/perf_report_schedule';
import { perfReporterInternalsForTest, startPerfReporter } from '../src/game/perf_reporter';
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
      iosMemoryProfile: false,
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
    textureUploads: 12,
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
        status: 'partial',
        elapsedMs: 120,
        remainingMsAfter: 4200,
        passes: 0,
        programsBefore: 10,
        programsAfter: 10,
        programDelta: 0,
        texturesBefore: 40,
        texturesAfter: 52,
        textureDelta: 12,
        workDone: 12,
        workPlanned: 20,
        detail: 'uploaded=12',
        budgetVariants: [
          {
            index: 0,
            levels: { grass: 1, foliage: 0.86, vfx: 0.92, lighting: 0.9, resolution: 0.9 },
            elapsedMs: 24,
            syncMs: 18,
            programsBefore: 10,
            programsAfter: 14,
            programDelta: 4,
            passes: 1,
          },
          {
            index: 1,
            levels: { grass: 0.86, foliage: 0.72, vfx: 0.84, lighting: 0.78, resolution: 0.9 },
            elapsedMs: 20,
            syncMs: 15,
            programsBefore: 14,
            programsAfter: 16,
            programDelta: 2,
            passes: 1,
          },
        ],
      },
    ],
    manifestCompleted: 12,
    manifestPartial: 1,
    manifestSkipped: 0,
    manifestTimedOut: 1,
    manifestFailed: 0,
    partialEntryIds: ['textures.scene'],
    timedOutEntryIds: ['vfx.weapon-skins'],
    failedEntryIds: [],
    // The dropped entry's second half. Without this, a report showing
    // vfx.weapon-skins as timed-out cannot say whether the world-side weapon
    // protection exists a minute into play or not at all.
    resume: {
      status: 'done' as const,
      plannedEntries: 1,
      plannedUnits: 3,
      startedUnits: 3,
      failedUnits: 1,
      failedUnitIds: ['vfx.weapon-skins:weapon-skins:compile'],
      entries: [
        {
          id: 'vfx.weapon-skins',
          lane: 'cosmetic' as const,
          planned: 3,
          started: 3,
          failed: 1,
        },
      ],
    },
    diagnosticsBaseline: null,
    compileUnits: [
      {
        id: 'programs.compile:0',
        lane: 'programs.compile',
        submittedAtMs: 100,
        syncEndAtMs: 112,
        settledAtMs: 140,
        failedAtMs: null,
        programsBefore: 10,
        programsAfter: 14,
        programDelta: 4,
        chargedLinks: 4,
        syncMs: 12,
        settledDurationMs: 28,
        statusAtReveal: 'settled' as const,
        roots: Array.from({ length: 32 }, (_, index) => `root-${index}`),
      },
    ],
    prewarmPacing: {
      available: true,
      source: 'default' as const,
      mode: 'adaptive' as const,
      linksPerSecond: null,
      burst: 8,
      compileBatchRoots: 32,
      hardMaxMs: 5000,
      chargedLinks: 4,
      scope: 'compile-unit-sync-prologue' as const,
      submitStop: {
        submissions: 1,
        usefulSettles: 1,
        zeroDeltaSettles: 0,
        zeroDeltaStreak: 0,
        syncEnds: 1,
        zeroDeltaSyncEnds: 0,
        elapsedMs: 42,
        sinceUsefulMs: 0,
        stopped: false,
        reason: null,
      },
      adaptive: {
        state: 'ramp' as const,
        windowLinks: 16,
        minWindowLinks: 8,
        maxWindowLinks: 32,
        maxWindowObserved: 16,
        estimatedLinksPerUnit: 4,
        inFlightLinks: 4,
        inFlightUnits: 1,
        peakInFlightLinks: 24,
        submittedUnits: 2,
        settledUnits: 1,
        failedUnits: 0,
        backoffCount: 0,
        noProgressCount: 0,
        lastSettlementMs: 120,
        transitions: [
          {
            atMs: 120,
            from: 'ramp' as const,
            to: 'steady' as const,
            reason: 'mid-settlement' as const,
            windowLinks: 16,
            inFlightLinks: 4,
          },
        ],
      },
    },
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
    hiddenPresentSkips: 0,
    hitchForensics: [],
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
      worst10s: null,
    },
    mainMs: { renderer: { count: 1, avg: 5, p95: 5, max: 5 } },
    renderer: {
      graphicsConfigVersion: 16,
      tier: 'high',
      currentZoneId: 'eastbrook_vale',
      qualityBuckets: qualityBuckets(),
      gpuQueue: {
        units: 2,
        totalSyncMs: 18.4,
        worstSyncMs: 12.1,
        // The texture unit is the cheap-looking one that actually cost the
        // frame: 6.3 ms of sync, 310 ms of lost frame. That inversion is why
        // the beacon carries both rankings.
        totalFrameGapMs: 329.2,
        worstFrameGapMs: 310.5,
        worstUnsharedFrameGapMs: 18.7,
        slowest: [
          {
            label: 'live-view-compile',
            priority: 30,
            syncMs: 12.1,
            wallMs: 40.2,
            atMs: 5000,
            waitMs: 2.4,
            frameGapMs: 18.7,
            sharedFrameGap: 1,
            deferredFrames: 0,
          },
          {
            label: 'texture-chunk',
            priority: 10,
            syncMs: 6.3,
            wallMs: 6.3,
            atMs: 5200,
            waitMs: 940.5,
            frameGapMs: 310.5,
            sharedFrameGap: 2,
            deferredFrames: 0,
          },
        ],
        blockiest: [
          {
            label: 'texture-chunk',
            priority: 10,
            syncMs: 6.3,
            wallMs: 6.3,
            atMs: 5200,
            waitMs: 940.5,
            frameGapMs: 310.5,
            sharedFrameGap: 2,
            deferredFrames: 0,
          },
          {
            label: 'live-view-compile',
            priority: 30,
            syncMs: 12.1,
            wallMs: 40.2,
            atMs: 5000,
            waitMs: 2.4,
            frameGapMs: 18.7,
            sharedFrameGap: 1,
            deferredFrames: 0,
          },
        ],
        pending: 0,
        active: null,
        waitingTails: [],
        stallCount: 0,
        stalls: [],
        worstWaitMs: 940.5,
        longestWaits: [
          {
            label: 'texture-chunk',
            priority: 10,
            waitMs: 940.5,
            blockedBy: 'preview:armory:skin',
            blockedByPriority: 10,
            waitedOnTailCap: true,
            tails: ['preview:armory:skin'],
          },
        ],
        admission: { enabled: false, deferred: 0, parks: 0 },
        recent: {
          windowMs: 30000,
          units: 2,
          totalSyncMs: 18.4,
          totalFrameGapMs: 329.2,
          worstSyncMs: 12.1,
          worstFrameGapMs: 310.5,
          worstWaitMs: 940.5,
          lanes: [
            {
              priority: 30,
              units: 1,
              worstWaitMs: 2.4,
              totalWaitMs: 2.4,
              worstSyncMs: 12.1,
              worstFrameGapMs: 18.7,
            },
            {
              priority: 10,
              units: 1,
              worstWaitMs: 940.5,
              totalWaitMs: 940.5,
              worstSyncMs: 6.3,
              worstFrameGapMs: 310.5,
            },
          ],
        },
      },
      nightAmount: 0,
      gpuPrep: {
        budget: {
          frameEmaMs: 16.7,
          headroomMs: 1.5,
          spentThisFrameMs: 0,
          legacy: false,
          degrading: false,
          kinds: [{ kind: 'touch', emaMs: 0.4, samples: 12 }],
          decisions: {
            'actionable-floor': 0,
            fits: 12,
            progress: 0,
            starvation: 0,
            legacy: 0,
            'first-sample': 1,
            cover: 0,
            'no-headroom': 3,
            'unknown-cap': 0,
            pressure: 0,
            'cover-not-arrival': 0,
          },
        },
        events: {
          total: 0,
          dropped: 0,
          counts: {
            'reveal-watchdog': 0,
            'reveal-soft-deadline': 0,
            'attach-watchdog': 0,
            'gate-timeout': 0,
            'submit-stop': 0,
            'live-program': 0,
            arrival: 0,
            'touch-unproven': 0,
          },
          events: [],
          reveal: {
            keysHeld: 0,
            rootsHeld: 0,
            rootsPiecewise: 0,
            rootsReach: 0,
            rootsAtWatchdog: 0,
            imminentHolds: 0,
          },
          gates: { spiritSpawnsRefused: 0 },
          portraits: {
            transferCaptures: 0,
            readbackCaptures: 0,
            canvasCaptures: 0,
            transferLatches: 0,
            readbackLatches: 0,
          },
        },
      },
      buildLedger: { kinds: {}, worstFrame: { ms: 0, count: 0, atMs: 0 }, slowest: [] },
      lookPieces: { pending: 0, completedPieces: 0, bandsRun: 0, deferred: 0, attached: 0 },
      zoneStreaming: { prepared: 1, pending: 0, last: null },
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
      shadowCadenceHalfRate: false,
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
      pooledVisuals: 4,
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
      entryDetailHorizon: {
        active: false,
        cap: 700,
        sceneryCap: null,
        targetFar: 700,
        nextCap: null,
        stableFrames: 0,
        armedAtMs: null,
        holdReason: 'inactive',
        transitions: [],
      },
    },
    hud: null,
    assets: { preload: { tasks: 0, waitMs: 0, complete: true }, byType: {}, files: [] },
    network: null,
    netPipeline: null,
    heapSawtooth: null,
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

beforeEach(() => {
  installBrowserGlobals();
  // The heavy streamed-prewarm lists ride an emit-ON-CHANGE gate whose state is
  // module-level (one per page, like the reporter itself). Reset it per case or
  // an earlier test's identical fixture silently gates the lists off in a later
  // one, and every length assertion below becomes order-dependent.
  perfReporterInternalsForTest.prewarmHeavyListGate.reset();
});

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
    expect(body.graphicsConfigVersion).toBe(16);
    expect(body.gfxTier).toBe('high');
    expect(body.autoGovernor).toBe(true);
    expect(body.effectiveRenderScale).toBe(0.9);
    expect(body.browserFamily).toBe('safari');
    expect(body.osFamily).toBe('macos');
    expect(body.glRendererBucket).toBe('apple-m3-pro');
    expect(body.source).toBe('benchmark');
    expect(body.zoneOrScenario).toBe('bench_dense_foliage');
    expect(JSON.stringify(body.rawSummary)).not.toContain('Safari/605');
    // hiddenPresentSkips ships in rawSummary (review reversal of the phase 4
    // decision): sends are skipped while hidden, but an after-restore session
    // still beacons cumulative numbers whose spans included minimized time,
    // and the counter is the only fleet-visible evidence of that residue. It
    // rides in rawSummary (the no-DDL home), never as a top-level column.
    expect((body.rawSummary as { hiddenPresentSkips?: number }).hiddenPresentSkips).toBe(0);
    expect((body.rawSummary as { graphicsConfigVersion?: number }).graphicsConfigVersion).toBe(16);
    // The entry reveal wait rides in rawSummary too (the fleet-side watch for the
    // establishing-shot bound): the counters verbatim, the waits from the ring.
    expect((body.rawSummary as { entryReveal?: unknown }).entryReveal).toEqual({
      keysHeld: 0,
      rootsHeld: 0,
      rootsAtWatchdog: 0,
      imminentHolds: 0,
      waits: [],
    });
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
    // The honest partial signal must survive into the report: a deadline or
    // prefetch-trimmed entry is 'partial' with its counts, never 'completed'.
    expect(
      (body.rawSummary as { rendererPrewarmSummary?: { manifestPartial?: number } })
        .rendererPrewarmSummary?.manifestPartial,
    ).toBe(1);
    expect(
      (body.rawSummary as { rendererPrewarmSummary?: { partialEntryIds?: string[] } })
        .rendererPrewarmSummary?.partialEntryIds,
    ).toEqual(['textures.scene']);
    const summaryEntries = (
      body.rawSummary as {
        rendererPrewarmSummary?: {
          entries?: {
            id?: string;
            status?: string;
            workDone?: number;
            workPlanned?: number;
            budgetVariants?: Record<string, unknown>[];
          }[];
        };
      }
    ).rendererPrewarmSummary?.entries;
    expect(summaryEntries).toHaveLength(2);
    expect(summaryEntries?.[1]).toMatchObject({
      id: 'textures.scene',
      status: 'partial',
      workDone: 12,
      workPlanned: 20,
    });
    expect(summaryEntries?.[1]?.budgetVariants).toEqual([
      {
        index: 0,
        levels: { grass: 1, foliage: 0.86, vfx: 0.92, lighting: 0.9, resolution: 0.9 },
        elapsedMs: 24,
        syncMs: 18,
        programsBefore: 10,
        programsAfter: 14,
        programDelta: 4,
        passes: 1,
      },
      {
        index: 1,
        levels: { grass: 0.86, foliage: 0.72, vfx: 0.84, lighting: 0.78, resolution: 0.9 },
        elapsedMs: 20,
        syncMs: 15,
        programsBefore: 14,
        programsAfter: 16,
        programDelta: 2,
        passes: 1,
      },
    ]);
    // The live stats object is NOT sent beside the summary. It was a second
    // copy of the same block under the ingest's 16 KB cap, and once its resume
    // getter started serializing, the copy the server rebuilds from a fixed key
    // set was no longer the only one carrying resume. Nothing reads the twin
    // back out of storage, so the summary is the whole payload: a new field
    // belongs in `rendererPrewarmSummary`, never in a restored twin.
    expect(body.rawSummary as Record<string, unknown>).not.toHaveProperty('rendererPrewarm');
    // The resume lane's outcome, which is the other half of "did this entry
    // run". `vfx.weapon-skins` reads timed-out above; only this block says its
    // units were handed to the lane, and that one of them failed, so the
    // world-side weapon protection is incomplete rather than merely late.
    const prewarmSummary = (body.rawSummary as { rendererPrewarmSummary?: Record<string, unknown> })
      .rendererPrewarmSummary;
    expect(prewarmSummary?.manifestSkipped).toBe(0);
    expect(prewarmSummary?.resume).toEqual({
      status: 'done',
      plannedEntries: 1,
      plannedUnits: 3,
      startedUnits: 3,
      failedUnits: 1,
      failedUnitIds: ['vfx.weapon-skins:weapon-skins:compile'],
      entries: [{ id: 'vfx.weapon-skins', lane: 'cosmetic', planned: 3, started: 3, failed: 1 }],
    });
    expect(prewarmSummary?.compileUnits).toEqual([
      {
        id: 'programs.compile:0',
        lane: 'programs.compile',
        submittedAtMs: 100,
        syncEndAtMs: 112,
        settledAtMs: 140,
        failedAtMs: null,
        programsBefore: 10,
        programsAfter: 14,
        programDelta: 4,
        chargedLinks: 4,
        syncMs: 12,
        settledDurationMs: 28,
        statusAtReveal: 'settled',
      },
    ]);
    expect(prewarmSummary?.prewarmPacing).toMatchObject({
      adaptive: {
        peakInFlightLinks: 24,
        transitions: [
          {
            atMs: 120,
            from: 'ramp',
            to: 'steady',
            reason: 'mid-settlement',
            windowLinks: 16,
            inFlightLinks: 4,
          },
        ],
      },
    });
    expect(
      (body.rawSummary as { rendererFoliage?: { modelVisibleTrianglesByLod?: { core?: number } } })
        .rendererFoliage?.modelVisibleTrianglesByLod?.core,
    ).toBe(420_000);
  });

  it('carries a nonzero hiddenPresentSkips into raw summary (the after-restore evidence)', () => {
    // A session minimized for a while and then restored: the skip counter is
    // what disambiguates its diluted-looking spans from a genuinely slow
    // machine, since no beacon goes out DURING the hidden span itself.
    const settings = new Settings();
    const snap = snapshot();
    snap.hiddenPresentSkips = 4321;
    const body = perfReporterInternalsForTest.payloadFromSnapshot(snap, settings, 'sess1', 42)!;
    expect((body.rawSummary as { hiddenPresentSkips?: number }).hiddenPresentSkips).toBe(4321);
  });

  it('bounds prewarm unit and variant telemetry without copying root labels', () => {
    const settings = new Settings();
    const snap = snapshot();
    const prewarm = snap.renderer?.prewarm;
    if (!prewarm || !prewarm.compileUnits?.[0]) throw new Error('fixture prewarm is incomplete');
    const baseUnit = prewarm.compileUnits[0];
    prewarm.compileUnits = Array.from({ length: 40 }, (_, index) => ({
      ...baseUnit,
      id: `programs.compile:${index}`,
      roots: Array.from({ length: 32 }, (_, rootIndex) => `root-${rootIndex}`),
    }));
    const variants = prewarm.manifestEntries[1]?.budgetVariants?.[0];
    if (!variants) throw new Error('fixture variants are incomplete');
    prewarm.manifestEntries[1].budgetVariants = Array.from({ length: 20 }, (_, index) => ({
      ...variants,
      index,
    }));

    const body = perfReporterInternalsForTest.payloadFromSnapshot(snap, settings, 'sess1', 42)!;
    const summary = (
      body.rawSummary as {
        rendererPrewarmSummary?: {
          compileUnits?: Record<string, unknown>[];
          entries?: { budgetVariants?: Record<string, unknown>[] }[];
        };
      }
    ).rendererPrewarmSummary;
    expect(summary?.compileUnits).toHaveLength(12);
    expect(summary?.compileUnits?.[0]).not.toHaveProperty('roots');
    expect(summary?.entries?.[1]?.budgetVariants).toHaveLength(8);
  });

  it('bounds adaptive transition telemetry at the literal 12-entry cap', () => {
    const settings = new Settings();
    const snap = snapshot();
    const adaptive = snap.renderer?.prewarm?.prewarmPacing?.adaptive;
    if (!adaptive || !adaptive.transitions[0])
      throw new Error('fixture adaptive pacing is incomplete');
    adaptive.transitions = Array.from({ length: 40 }, (_, index) => ({
      ...adaptive.transitions[0],
      atMs: index,
    }));

    const body = perfReporterInternalsForTest.payloadFromSnapshot(snap, settings, 'sess1', 42)!;
    const summary = (
      body.rawSummary as {
        rendererPrewarmSummary?: {
          prewarmPacing?: { adaptive?: { transitions?: Record<string, unknown>[] } };
        };
      }
    ).rendererPrewarmSummary;
    expect(summary?.prewarmPacing?.adaptive?.transitions).toHaveLength(12);
    // The MOST RECENT ones: a pacer's end state is what a report is read for,
    // and the fixture numbers each transition by index so this is decisive.
    expect(summary?.prewarmPacing?.adaptive?.transitions?.[0]?.atMs).toBe(28);
    expect(summary?.prewarmPacing?.adaptive?.transitions?.at(-1)?.atMs).toBe(39);
  });

  it('carries the four dropped browser longtask fields into raw summary (#2479)', () => {
    // longTaskCount and longTaskP95Ms already ship as top-level fields; these
    // four (totalMs, avg, max, lastAge) used to be silently dropped. max is
    // the independent corroboration of a multi-second stall, so it matters
    // most, but all four ride together in one raw-summary block.
    const settings = new Settings();
    const body = perfReporterInternalsForTest.payloadFromSnapshot(
      snapshot(),
      settings,
      'sess1',
      42,
    )!;

    expect(body.longTaskCount).toBe(2);
    expect(body.longTaskP95Ms).toBe(80);
    expect(
      (body.rawSummary as { browser?: { longTasks?: Record<string, number> } }).browser?.longTasks,
    ).toEqual({ totalMs: 120, avg: 60, max: 80, lastAge: 1000 });
  });

  it('carries the GPU queue block, active unit included, into raw summary (#3167)', () => {
    // A settled queue: only completed units, no running one. This is the arm
    // that used to be the ONLY arm, since a never-settling unit records nothing.
    const settings = new Settings();
    const settled = perfReporterInternalsForTest.payloadFromSnapshot(
      snapshot(),
      settings,
      'sess1',
      42,
    )!;
    const settledQueue = (settled.rawSummary as { rendererGpuQueue?: Record<string, unknown> })
      .rendererGpuQueue;
    expect(settledQueue).toMatchObject({
      units: 2,
      totalSyncMs: 18.4,
      worstSyncMs: 12.1,
      totalFrameGapMs: 329.2,
      worstFrameGapMs: 310.5,
      worstUnsharedFrameGapMs: 18.7,
      pending: 0,
      stallCount: 0,
      active: null,
      stalls: [],
    });
    expect(settledQueue?.slowest).toEqual([
      {
        label: 'live-view-compile',
        priority: 30,
        syncMs: 12.1,
        wallMs: 40.2,
        waitMs: 2.4,
        frameGapMs: 18.7,
        sharedFrameGap: 1,
      },
      {
        label: 'texture-chunk',
        priority: 10,
        syncMs: 6.3,
        wallMs: 6.3,
        waitMs: 940.5,
        frameGapMs: 310.5,
        sharedFrameGap: 2,
      },
    ]);
    // The interval arm, which is the only one two reports can be differenced
    // on: everything above it is cumulative or a lifetime maximum. The lane
    // rows are what say a cosmetic unit made a live-view one wait.
    expect(settledQueue?.recent).toEqual({
      windowMs: 30_000,
      units: 2,
      totalSyncMs: 18.4,
      totalFrameGapMs: 329.2,
      worstSyncMs: 12.1,
      worstFrameGapMs: 310.5,
      worstWaitMs: 940.5,
      lanes: [
        {
          priority: 30,
          units: 1,
          worstWaitMs: 2.4,
          totalWaitMs: 2.4,
          worstSyncMs: 12.1,
          worstFrameGapMs: 18.7,
        },
        {
          priority: 10,
          units: 1,
          worstWaitMs: 940.5,
          totalWaitMs: 940.5,
          worstSyncMs: 6.3,
          worstFrameGapMs: 310.5,
        },
      ],
    });
    expect(settledQueue?.worstWaitMs).toBe(940.5);
    // Attribution rides with the wait: the cost lists cannot carry it, because a
    // unit can wait a long time while costing nothing itself.
    expect(settledQueue?.longestWaits).toEqual([
      {
        label: 'texture-chunk',
        priority: 10,
        waitMs: 940.5,
        blockedBy: 'preview:armory:skin',
        blockedByPriority: 10,
        waitedOnTailCap: true,
        tails: ['preview:armory:skin'],
      },
    ]);
    // The frame-cost ranking inverts the sync ranking, which is the whole point
    // of shipping both: a sync-ordered beacon would bury the unit that hurt.
    expect(settledQueue?.blockiest).toEqual([
      {
        label: 'texture-chunk',
        priority: 10,
        syncMs: 6.3,
        wallMs: 6.3,
        waitMs: 940.5,
        frameGapMs: 310.5,
        sharedFrameGap: 2,
      },
      {
        label: 'live-view-compile',
        priority: 30,
        syncMs: 12.1,
        wallMs: 40.2,
        waitMs: 2.4,
        frameGapMs: 18.7,
        sharedFrameGap: 1,
      },
    ]);

    const snap = snapshot();
    snap.renderer!.gpuQueue = {
      units: 2,
      totalSyncMs: 18.4,
      worstSyncMs: 12.1,
      totalFrameGapMs: 0,
      worstFrameGapMs: 0,
      worstUnsharedFrameGapMs: 0,
      slowest: [],
      blockiest: [],
      pending: 7,
      active: { label: 'wedged-compile', priority: 40, ageMs: 91_000, atMs: 12_000 },
      waitingTails: [{ label: 'released-gate', priority: 30, ageMs: 5000, atMs: 11_000 }],
      stallCount: 1,
      stalls: [
        { label: 'wedged-compile', priority: 40, ageMs: 91_000, atMs: 12_000, settled: false },
      ],
      worstWaitMs: 0,
      longestWaits: [],
      admission: { enabled: false, deferred: 0, parks: 0 },
      recent: {
        windowMs: 30000,
        units: 0,
        totalSyncMs: 0,
        totalFrameGapMs: 0,
        worstSyncMs: 0,
        worstFrameGapMs: 0,
        worstWaitMs: 0,
        lanes: [],
      },
    };
    const wedged = perfReporterInternalsForTest.payloadFromSnapshot(snap, settings, 'sess1', 42)!;
    const wedgedQueue = (wedged.rawSummary as { rendererGpuQueue?: Record<string, unknown> })
      .rendererGpuQueue;
    // The wedge is the whole point: units stayed at 2, so only the active unit
    // and the stall say the queue has been blocked for a minute and a half.
    expect(wedgedQueue).toMatchObject({
      units: 2,
      pending: 7,
      stallCount: 1,
      active: { label: 'wedged-compile', priority: 40, ageMs: 91_000 },
      stalls: [{ label: 'wedged-compile', priority: 40, ageMs: 91_000, settled: false }],
    });
    // A released tail rides beside the active unit. Exact equality on purpose:
    // toMatchObject's subset semantics would pass even if atMs leaked through,
    // and dropping atMs (page-relative, fleet-meaningless) is the claim.
    expect((wedgedQueue as { waitingTails?: unknown[] }).waitingTails).toEqual([
      { label: 'released-gate', priority: 30, ageMs: 5000 },
    ]);
  });

  it('carries the always-on net pipeline and heap sawtooth blocks into raw summary', () => {
    const settings = new Settings();
    const snap = snapshot();
    snap.netPipeline = {
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
    snap.heapSawtooth = {
      samples: 60,
      seconds: 59,
      gcDropCount: 3,
      avgDropMb: 38.5,
      allocRateMbPerSec: 2.1,
      amplitudeMb: 42,
      lastUsedMb: 180,
    };

    const body = perfReporterInternalsForTest.payloadFromSnapshot(snap, settings, 'sess1', 42)!;

    const rawSummary = body.rawSummary as {
      netPipeline?: {
        snapshots: number;
        gapMs: { max: number };
        snapshotsPerRaf: { r3plus: number };
      };
      heapSawtooth?: { gcDropCount: number; allocRateMbPerSec: number };
    };
    expect(rawSummary.netPipeline?.snapshots).toBe(240);
    expect(rawSummary.netPipeline?.gapMs.max).toBe(900);
    expect(rawSummary.netPipeline?.snapshotsPerRaf.r3plus).toBe(6);
    expect(rawSummary.heapSawtooth?.gcDropCount).toBe(3);
    expect(rawSummary.heapSawtooth?.allocRateMbPerSec).toBe(2.1);
  });

  it('keeps offline null net pipeline and heap blocks as nulls in raw summary', () => {
    const settings = new Settings();
    const body = perfReporterInternalsForTest.payloadFromSnapshot(snapshot(), settings, 's', null)!;
    expect((body.rawSummary as { netPipeline?: unknown }).netPipeline).toBeNull();
    expect((body.rawSummary as { heapSawtooth?: unknown }).heapSawtooth).toBeNull();
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

describe('perf reporter report dimensions', () => {
  const { payloadFromSnapshot } = perfReporterInternalsForTest;

  // Only activeViews/visibleViews are read from the renderer frame by the
  // payload path; the rest of the large frame record is irrelevant here.
  function lastFrameWith(
    activeViews: number,
    visibleViews: number,
  ): NonNullable<PerfSnapshot['renderer']>['lastFrame'] {
    return { activeViews, visibleViews } as unknown as NonNullable<
      PerfSnapshot['renderer']
    >['lastFrame'];
  }

  it('emits the provider zone id as zoneOrScenario for gameplay sessions', () => {
    (globalThis as any).location = { search: '' };
    const body = payloadFromSnapshot(snapshot(), new Settings(), 'sess1', 42, {
      zoneId: 'dungeon:hollow_crypt',
      simEntities: 33,
    })!;
    expect(body.source).toBe('gameplay');
    expect(body.zoneOrScenario).toBe('dungeon:hollow_crypt');
    expect(body.simEntities).toBe(33);
  });

  it('keeps the benchmark perfScenario priority over the provider zone', () => {
    // installBrowserGlobals sets ?perfScenario=bench_dense_foliage.
    const body = payloadFromSnapshot(snapshot(), new Settings(), 'sess1', 42, {
      zoneId: 'eastbrook_vale',
      simEntities: 33,
    })!;
    expect(body.source).toBe('benchmark');
    expect(body.zoneOrScenario).toBe('bench_dense_foliage');
  });

  it('falls back to the gameplay label when the provider is absent or returns null', () => {
    (globalThis as any).location = { search: '' };
    const withoutProvider = payloadFromSnapshot(snapshot(), new Settings(), 'sess1', 42)!;
    expect(withoutProvider.zoneOrScenario).toBe('gameplay');
    expect(withoutProvider.simEntities).toBeNull();
    const nullProvider = payloadFromSnapshot(snapshot(), new Settings(), 'sess1', 42, null)!;
    expect(nullProvider.zoneOrScenario).toBe('gameplay');
    expect(nullProvider.simEntities).toBeNull();
  });

  it('emits the crowd bucket and raw view counts from the renderer frame', () => {
    const snap = snapshot();
    snap.renderer!.lastFrame = lastFrameWith(57, 31);
    const body = payloadFromSnapshot(snap, new Settings(), 'sess1', 42)!;
    expect(body.activeViews).toBe(57);
    expect(body.visibleViews).toBe(31);
    expect(body.crowdBucket).toBe('50-99');
  });

  it('null-guards a missing renderer frame into unknown crowd and null views', () => {
    const body = payloadFromSnapshot(snapshot(), new Settings(), 'sess1', 42)!;
    expect(body.activeViews).toBeNull();
    expect(body.visibleViews).toBeNull();
    expect(body.crowdBucket).toBe('unknown');
  });

  it('emits the worst-10s frame p95 from the retained window and null before one exists', () => {
    const snap = snapshot();
    snap.windows.worst10s = {
      atMs: 60_000,
      seconds: 10,
      frames: 200,
      fps: 20,
      frameMs: { avg: 60, p50: 40, p95: 180.5, p99: 220, max: 260, long50: 80 },
    };
    const body = payloadFromSnapshot(snap, new Settings(), 'sess1', 42)!;
    expect(body.worst10sFrameP95Ms).toBe(180.5);
    const empty = payloadFromSnapshot(snapshot(), new Settings(), 'sess1', 42)!;
    expect(empty.worst10sFrameP95Ms).toBeNull();
  });

  it('stamps schema version 2 on the payload', () => {
    const body = payloadFromSnapshot(snapshot(), new Settings(), 'sess1', 42)!;
    expect(body.schemaVersion).toBe(2);
  });
});

describe('perf reporter suggestion ids', () => {
  const { payloadFromSnapshot } = perfReporterInternalsForTest;

  it('emits an empty suggestion list for a healthy session', () => {
    (globalThis as any).location = { search: '' };
    const body = payloadFromSnapshot(snapshot(), new Settings(), 'sess1', 42)!;
    expect(body.suggestionIds).toEqual([]);
  });

  it('emits hardware-acceleration for a software-rendered session', () => {
    (globalThis as any).location = { search: '' };
    const snap = snapshot();
    snap.renderer!.glRenderer = 'Google SwiftShader';
    const body = payloadFromSnapshot(snap, new Settings(), 'sess1', 42)!;
    expect(body.suggestionIds).toEqual(['hardware-acceleration']);
  });

  it('emits integrated-gpu on a bad-frames iGPU session only outside the desktop shell', () => {
    (globalThis as any).location = { search: '' };
    const badSnap = (): PerfSnapshot => {
      const snap = snapshot();
      snap.renderer!.glRenderer =
        'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)';
      snap.windows.last10s = {
        seconds: 10,
        frames: 240,
        fps: 24,
        frameMs: { avg: 41, p50: 38, p95: 55, p99: 70, max: 120, long50: 12 },
      };
      return snap;
    };
    const web = payloadFromSnapshot(badSnap(), new Settings(), 'sess1', 42, null, false)!;
    expect(web.suggestionIds).toEqual(['integrated-gpu']);
    // Ruling R15: the desktop shell already forces the dGPU, so the same
    // snapshot reports no machine-local suggestion there.
    const shell = payloadFromSnapshot(badSnap(), new Settings(), 'sess1', 42, null, true)!;
    expect(shell.suggestionIds).toEqual([]);
  });
});

describe('perf reporter worst-window drain', () => {
  function installReporterFlowGlobals(fetchImpl: unknown): void {
    (globalThis as any).location = { search: '' };
    (globalThis as any).window = {
      innerWidth: 1440,
      innerHeight: 900,
      setTimeout: vi.fn((fn: () => void, ms: number) => setTimeout(fn, ms)),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    (globalThis as any).document = {
      visibilityState: 'visible',
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    (globalThis as any).sessionStorage = {
      getItem: () => 'reporter-test-session',
      setItem: () => {},
    };
    (globalThis as any).fetch = fetchImpl;
  }

  function fakePerf(): { perf: PerfMonitor; drainWorstWindow: ReturnType<typeof vi.fn> } {
    const drainWorstWindow = vi.fn();
    const perf = { report: () => snapshot(), drainWorstWindow } as unknown as PerfMonitor;
    return { perf, drainWorstWindow };
  }

  function lastScheduledDelay(): number | undefined {
    return (globalThis as any).window.setTimeout.mock.lastCall?.[1];
  }

  async function runFirstReport(fetchImpl: unknown): Promise<ReturnType<typeof vi.fn>> {
    installReporterFlowGlobals(fetchImpl);
    const { perf, drainWorstWindow } = fakePerf();
    const stop = startPerfReporter({
      perf,
      settings: new Settings(),
      tokenProvider: () => null,
      characterIdProvider: () => null,
    });
    try {
      const firstDelay = jitteredPerfReportDelay(75_000, 'reporter-test-session', 0);
      expect(firstDelay).toBeGreaterThan(75_000);
      await vi.advanceTimersByTimeAsync(75_000);
      expect(fetchImpl).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(firstDelay - 75_000 - 1);
      expect(fetchImpl).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      stop();
    }
    return drainWorstWindow;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).fetch;
    delete (globalThis as any).sessionStorage;
    delete (globalThis as any).document;
    delete (globalThis as any).window;
    delete (globalThis as any).location;
  });

  it('drains the worst window exactly once after a successful send', async () => {
    const drain = await runFirstReport(
      vi.fn(async () => ({ ok: true, status: 204, text: async () => '' })),
    );
    expect(drain).toHaveBeenCalledTimes(1);
  });

  it('keeps the worst window when the server rejects the report', async () => {
    const drain = await runFirstReport(
      vi.fn(async () => ({ ok: false, status: 500, text: async () => 'nope' })),
    );
    expect(drain).not.toHaveBeenCalled();
  });

  it('keeps the worst window when the send fails at the network layer', async () => {
    const drain = await runFirstReport(vi.fn(async () => Promise.reject(new Error('offline'))));
    expect(drain).not.toHaveBeenCalled();
  });

  it('arms the next deterministic sequence after a successful report', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204, text: async () => '' }));
    installReporterFlowGlobals(fetchImpl);
    const { perf } = fakePerf();
    const stop = startPerfReporter({
      perf,
      settings: new Settings(),
      tokenProvider: () => null,
      characterIdProvider: () => null,
    });
    try {
      await vi.advanceTimersByTimeAsync(
        jitteredPerfReportDelay(75_000, 'reporter-test-session', 0),
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(lastScheduledDelay()).toBe(
        jitteredPerfReportDelay(300_000, 'reporter-test-session', 1),
      );
    } finally {
      stop();
    }
  });

  it('advances the jitter sequence when a hidden retry sends no request', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204, text: async () => '' }));
    installReporterFlowGlobals(fetchImpl);
    (globalThis as any).document.visibilityState = 'hidden';
    const { perf } = fakePerf();
    const stop = startPerfReporter({
      perf,
      settings: new Settings(),
      tokenProvider: () => null,
      characterIdProvider: () => null,
    });
    try {
      await vi.advanceTimersByTimeAsync(
        jitteredPerfReportDelay(75_000, 'reporter-test-session', 0),
      );
      expect(fetchImpl).not.toHaveBeenCalled();
      const hiddenRetry = jitteredPerfReportDelay(300_000, 'reporter-test-session', 1);
      expect(lastScheduledDelay()).toBe(hiddenRetry);

      (globalThis as any).document.visibilityState = 'visible';
      await vi.advanceTimersByTimeAsync(hiddenRetry);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(lastScheduledDelay()).toBe(
        jitteredPerfReportDelay(300_000, 'reporter-test-session', 2),
      );
    } finally {
      stop();
    }
  });

  it('skips the send while the desktop shell is hidden, even though the page reads visible', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204, text: async () => '' }));
    installReporterFlowGlobals(fetchImpl);
    // The shell disables background throttling, so a minimized window still
    // reports 'visible' here: without the shell's own signal this session would
    // keep beaconing reports for frames it never drew.
    (globalThis as any).document.visibilityState = 'visible';
    let shellHidden = true;
    const { perf } = fakePerf();
    const stop = startPerfReporter({
      perf,
      settings: new Settings(),
      tokenProvider: () => null,
      characterIdProvider: () => null,
      shellHidden: () => shellHidden,
    });
    try {
      await vi.advanceTimersByTimeAsync(
        jitteredPerfReportDelay(75_000, 'reporter-test-session', 0),
      );
      expect(fetchImpl).not.toHaveBeenCalled();
      // Same retry cadence as the page-hidden skip: it IS the 'hidden' skip.
      const hiddenRetry = jitteredPerfReportDelay(300_000, 'reporter-test-session', 1);
      expect(lastScheduledDelay()).toBe(hiddenRetry);

      // Negative arm: nothing about the page changed, only the shell verdict,
      // and the report goes out.
      shellHidden = false;
      await vi.advanceTimersByTimeAsync(hiddenRetry);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(lastScheduledDelay()).toBe(
        jitteredPerfReportDelay(300_000, 'reporter-test-session', 2),
      );
    } finally {
      stop();
    }
  });

  it('sends normally when the shell hook is present and reports shown', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204, text: async () => '' }));
    installReporterFlowGlobals(fetchImpl);
    (globalThis as any).document.visibilityState = 'visible';
    const { perf } = fakePerf();
    const stop = startPerfReporter({
      perf,
      settings: new Settings(),
      tokenProvider: () => null,
      characterIdProvider: () => null,
      shellHidden: () => false,
    });
    try {
      await vi.advanceTimersByTimeAsync(
        jitteredPerfReportDelay(75_000, 'reporter-test-session', 0),
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it('advances the jitter sequence when renderer evidence is not ready', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204, text: async () => '' }));
    installReporterFlowGlobals(fetchImpl);
    let current = snapshot();
    current.renderer = null;
    const drainWorstWindow = vi.fn();
    const perf = {
      report: () => current,
      drainWorstWindow,
    } as unknown as PerfMonitor;
    const stop = startPerfReporter({
      perf,
      settings: new Settings(),
      tokenProvider: () => null,
      characterIdProvider: () => null,
    });
    try {
      await vi.advanceTimersByTimeAsync(
        jitteredPerfReportDelay(75_000, 'reporter-test-session', 0),
      );
      expect(fetchImpl).not.toHaveBeenCalled();
      const noRendererRetry = jitteredPerfReportDelay(300_000, 'reporter-test-session', 1);
      expect(lastScheduledDelay()).toBe(noRendererRetry);

      current = snapshot();
      await vi.advanceTimersByTimeAsync(noRendererRetry);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(lastScheduledDelay()).toBe(
        jitteredPerfReportDelay(300_000, 'reporter-test-session', 2),
      );
    } finally {
      stop();
    }
  });

  it('keeps the local development trace on its fixed fast cadence', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204, text: async () => '' }));
    installReporterFlowGlobals(fetchImpl);
    (globalThis as any).location = {
      search: '?perfTrace=1',
      hostname: '127.0.0.1',
    };
    const { perf } = fakePerf();
    const stop = startPerfReporter({
      perf,
      settings: new Settings(),
      tokenProvider: () => null,
      characterIdProvider: () => null,
    });
    try {
      await vi.advanceTimersByTimeAsync(9_999);
      expect(fetchImpl).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(lastScheduledDelay()).toBe(15_000);
    } finally {
      stop();
    }
  });

  // The heavy prewarm lists follow the same delivery rule as the worst window
  // above: consulted when the payload is built, committed only when the POST
  // lands. These arms drive the real send path rather than the payload builder,
  // because the split only matters across a failed request.
  async function postedPrewarmLists(fetchImpl: ReturnType<typeof vi.fn>): Promise<boolean[]> {
    installReporterFlowGlobals(fetchImpl);
    const { perf } = fakePerf();
    const stop = startPerfReporter({
      perf,
      settings: new Settings(),
      tokenProvider: () => null,
      characterIdProvider: () => null,
    });
    try {
      await vi.advanceTimersByTimeAsync(900_000);
    } finally {
      stop();
    }
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
    return fetchImpl.mock.calls.map((call) => {
      const body = JSON.parse((call[1] as { body: string }).body) as {
        rawSummary: { rendererPrewarmSummary?: { compileUnits?: unknown[] } };
      };
      return (body.rawSummary.rendererPrewarmSummary?.compileUnits?.length ?? 0) > 0;
    });
  }

  it('stops re-sending the prewarm lists once a report carrying them lands', async () => {
    const carried = await postedPrewarmLists(
      vi.fn(async () => ({ ok: true, status: 204, text: async () => '' })),
    );
    expect(carried[0]).toBe(true);
    expect(carried.slice(1).some(Boolean)).toBe(false);
  });

  it('re-sends the prewarm lists after the server rejects the report', async () => {
    const carried = await postedPrewarmLists(
      vi.fn(async () => ({ ok: false, status: 500, text: async () => 'nope' })),
    );
    expect(carried.every(Boolean)).toBe(true);
  });

  it('re-sends the prewarm lists after the send fails at the network layer', async () => {
    const carried = await postedPrewarmLists(
      vi.fn(async () => Promise.reject(new Error('offline'))),
    );
    expect(carried.every(Boolean)).toBe(true);
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

describe('perf reporter streamed-prewarm emit-on-change gate', () => {
  // The renderer RETAINS its boot prewarm snapshot, so without this gate every
  // 5-minute beacon re-sends the same few KB describing the same one-time work.
  // Measured, that repetition was most of the headroom under the server's 16 KB
  // raw-summary cap.
  // `delivered` stands in for the POST succeeding, which is what commits the
  // gate. Building a payload records nothing on its own (ruling R5's rule), so
  // an undelivered build below deliberately leaves the block still owed.
  function summaryOf(snap: ReturnType<typeof snapshot>, delivered = true) {
    const body = perfReporterInternalsForTest.payloadFromSnapshot(
      snap,
      new Settings(),
      'sess-gate',
      42,
    )!;
    if (delivered) {
      const fingerprint = perfReporterInternalsForTest.pendingPrewarmListFingerprint();
      if (fingerprint !== null)
        perfReporterInternalsForTest.prewarmHeavyListGate.commit(fingerprint);
    }
    return (
      body.rawSummary as {
        rendererPrewarmSummary?: {
          compileUnits?: unknown[];
          prewarmListsUnchanged?: boolean;
          prewarmPacing?: { adaptive?: { transitions?: unknown[] } };
          entries?: { budgetVariants?: unknown[] }[];
        };
      }
    ).rendererPrewarmSummary;
  }

  it('sends the lists on the first report and omits them while unchanged', () => {
    const first = summaryOf(snapshot());
    expect(first?.compileUnits?.length).toBeGreaterThan(0);
    expect(first?.prewarmPacing?.adaptive?.transitions?.length).toBeGreaterThan(0);
    expect(first?.prewarmListsUnchanged).toBeUndefined();

    const second = summaryOf(snapshot());
    expect(second?.compileUnits).toBeUndefined();
    expect(second?.prewarmPacing?.adaptive?.transitions).toBeUndefined();
    expect(second?.entries?.some((entry) => entry.budgetVariants !== undefined)).toBe(false);
    // Absent BECAUSE unchanged, said explicitly: a reader must not conclude the
    // lane did no work.
    expect(second?.prewarmListsUnchanged).toBe(true);
  });

  it('keeps the lists owed when the report carrying them is never delivered', () => {
    // The gate is committed by a successful POST, not by building the payload.
    // Without that split, a first beacon that failed would suppress the block
    // for the rest of the session and stamp `prewarmListsUnchanged` pointing a
    // reader at a row that never landed.
    const undelivered = summaryOf(snapshot(), false);
    expect(undelivered?.compileUnits?.length).toBeGreaterThan(0);

    const retry = summaryOf(snapshot(), false);
    expect(retry?.compileUnits?.length).toBeGreaterThan(0);
    expect(retry?.prewarmListsUnchanged).toBeUndefined();

    const delivered = summaryOf(snapshot());
    expect(delivered?.compileUnits?.length).toBeGreaterThan(0);
    const afterDelivery = summaryOf(snapshot(), false);
    expect(afterDelivery?.compileUnits).toBeUndefined();
    expect(afterDelivery?.prewarmListsUnchanged).toBe(true);
  });

  it('sends them again when the resume lane changes the block after boot', () => {
    // Not "first report only": the background resume lane can still finish
    // units after the first beacon, and that genuinely changes the diagnostic.
    summaryOf(snapshot());
    const changed = snapshot();
    const prewarm = changed.renderer?.prewarm;
    if (!prewarm?.compileUnits?.[0]) throw new Error('fixture prewarm is incomplete');
    prewarm.compileUnits = [
      { ...prewarm.compileUnits[0], id: 'weapon-skins:compile:resumed-later' },
      ...prewarm.compileUnits.slice(1),
    ];

    const after = summaryOf(changed);
    expect(after?.compileUnits?.length).toBeGreaterThan(0);
    expect(after?.prewarmListsUnchanged).toBeUndefined();
  });

  it('keeps the cheap scalar counters on every report', () => {
    // The gate is about the LISTS. Everything a fleet query aggregates on must
    // still ride each beacon, or the gate would be a telemetry regression.
    summaryOf(snapshot());
    const second = summaryOf(snapshot()) as Record<string, unknown>;
    expect(second.manifestPlanned).toBeDefined();
    expect(second.compileMs).toBeDefined();
    expect(second.resume).toBeDefined();
    expect((second.entries as unknown[]).length).toBeGreaterThan(0);
  });
});
