// The shape of what the renderer REPORTS, extracted from renderer.ts so the
// coordinator holds the code that fills it and not the 50-line literal that
// describes it. Type-only: nothing here runs, and every consumer of
// `Renderer.perfStats()` (the ?perf overlay, the perf reporter, the hitch
// capture) can now name the contract instead of spelling
// `ReturnType<Renderer['perfStats']>`.
import type { BiomeId } from '../sim/types';
import type { BackgroundGpuQueueStats } from './background_gpu_queue';
import type { BuildLedgerSnapshot } from './build_ledger_core';
import type { LookPiecesStats } from './characters/look_pieces';
import type { EntryDetailHorizonSnapshot } from './entry_detail_horizon';
import type { FoliagePerfStats } from './foliage';
import type { GfxBucketBands, GfxBucketLevels, GfxRuntimeBudget } from './gfx';
import type { GpuPrepBudgetSnapshot } from './gpu_prep_budget_core';
import type { GpuPrepEventsSnapshot } from './gpu_prep_events';
import type { RendererPrewarmStats } from './prewarm_compile_lifecycle';
import type { RenderBudgetState } from './render_budget';
import type { RenderDiagnosticsSnapshot } from './render_diagnostics';
import type { RendererFramePhaseMs, RendererWorldPhaseMs } from './renderer_frame_telemetry_core';
import type { ZoneStreamingStats } from './zone_prepare_stats';

export type RendererPhase = 'setup' | 'entities' | 'world' | 'nameplates' | 'submit' | 'total';

/** The allocated 3D drawing buffer, beside the CSS viewport it covers.
 *
 *  Inside THIS block the pair is redundant (`width === floor(cssWidth *
 *  pixelRatio)`: both canvas sizing sites go through one `setPixelRatio` plus
 *  `setSize(viewport)`). It is reported because the FLEET REPORT cannot rebuild
 *  it from its own columns: the beacon's `dpr` is the raw
 *  `window.devicePixelRatio`, never the renderer's capped ratio, and its
 *  viewport is `window.innerWidth`/`innerHeight`, never the canvas rect. So
 *  this is the only field that says what a session rasterizes.
 *
 *  On the dynamic-resolution path (`dynamicResolution` true: the grade-only
 *  composer, medium today) this is the ALLOCATION, held at the manual Render
 *  Quality ceiling while the governor rasterizes a sub-rect of it. The live
 *  extent is then this buffer times `effectiveRenderScale / renderScale`, both
 *  of which the report already carries as their own columns; the factor is that
 *  RATIO and not `effectiveRenderScale` alone, because the allocation already
 *  contains the manual scale. Everywhere else the two are the same buffer. */
export interface DrawingBufferStats {
  /** The canvas backing store, in device pixels (`canvas.width`/`canvas.height`). */
  width: number;
  height: number;
  /** The CSS viewport it covers, from the renderer's cached measurement. */
  cssWidth: number;
  cssHeight: number;
  /** Whether the governor rasterizes a sub-rect of the allocation rather than
   *  reallocating. Reported because it is NOT derivable downstream: it comes
   *  from the post chain's pass list, not from the tier or the quality buckets,
   *  and without it a backed-off session reads as if it drew at full size. */
  dynamicResolution: boolean;
}

export type RendererPhaseStats = Record<
  RendererPhase,
  { count: number; avg: number; p95: number; max: number }
>;

export interface RendererQualityChangeStats {
  atMs: number;
  ageMs: number;
  mode: RenderBudgetState['mode'];
  reason: RenderBudgetState['reason'];
  previousLevels: RenderBudgetState['levels'];
  levels: RenderBudgetState['levels'];
}

export interface RendererFrameStats {
  phaseMs: RendererFramePhaseMs;
  worldPhaseMs: RendererWorldPhaseMs;
  foliage: FoliagePerfStats;
  renderDiagnostics: RenderDiagnosticsSnapshot;
  cameraPosition: { x: number; y: number; z: number };
  playerPosition: { x: number; y: number; z: number };
  biome: BiomeId;
  lastQualityChange: RendererQualityChangeStats | null;
  createdViews: number;
  createdViewTypes: string[];
  removedViews: number;
  candidateViews: number;
  activeViews: number;
  visibleViews: number;
}

/** GPU-preparation pacing: what the per-frame budget is deciding with, plus the
 *  fail-soft escapes that would otherwise leave only a console line. */
export interface RendererGpuPrepStats {
  budget: GpuPrepBudgetSnapshot;
  events: GpuPrepEventsSnapshot;
}

export interface RendererPerfStats {
  graphicsConfigVersion: number;
  tier: string;
  currentZoneId: string | null;
  qualityBuckets: {
    version: number;
    bands: GfxBucketBands;
    baseline: GfxBucketLevels;
    levels: GfxBucketLevels;
    features: {
      composer: boolean;
      ao: boolean;
      standardMaterials: boolean;
      lowPlus: boolean;
      leanFoliage: boolean;
      terrainSplat: boolean;
      windSway: boolean;
      maxPointLights: number;
      activePointLights: number;
      shadowMap: number;
      iosMemoryProfile: boolean;
    };
  };
  autoGovernor: boolean;
  budget: GfxRuntimeBudget;
  renderScale: number;
  effectiveRenderScale: number;
  renderBudget: RenderBudgetState;
  shadowCadenceHalfRate: boolean;
  pixelRatio: number;
  width: number;
  height: number;
  /** The allocated drawing buffer (see DrawingBufferStats): what the fleet perf
   *  report reads to say the resolution a session actually plays at. */
  drawingBuffer: DrawingBufferStats;
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  views: number;
  pooledVisuals: number;
  foliage: FoliagePerfStats;
  glVendor: string;
  glRenderer: string;
  contextLost: number;
  contextRestored: number;
  /** 0 = full day, 1 = deep night; the night-visibility layers key off it. */
  nightAmount: number;
  phaseMs: RendererPhaseStats;
  renderDiagnostics: RenderDiagnosticsSnapshot;
  lastFrame?: RendererFrameStats;
  prewarm: RendererPrewarmStats | null;
  entryDetailHorizon: EntryDetailHorizonSnapshot;
  gpuQueue: BackgroundGpuQueueStats;
  gpuPrep: RendererGpuPrepStats;
  /** Main-thread construction ms by kind (view builds by class, zone feature
   *  builders), the worst frame and the slowest single builds. */
  buildLedger: BuildLedgerSnapshot;
  /** Composed-look pieces (decal maps and cuts) on the GPU work queue, and
   *  the live view holds they caused. */
  lookPieces: LookPiecesStats;
  /** Zone residency counts plus the stage wall-times of the last prepare. */
  zoneStreaming: ZoneStreamingStats;
}
