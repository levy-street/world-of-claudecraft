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
