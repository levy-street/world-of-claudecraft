import type { FoliagePerfStats } from './foliage';

export interface RendererFramePhaseMs {
  setup: number;
  entities: number;
  world: number;
  nameplates: number;
  submit: number;
  total: number;
}

export interface RendererWorldPhaseMs {
  lights: number;
  water: number;
  terrain: number;
  props: number;
  foliage: number;
  fish: number;
  ambientScenery: number;
  zoneVisibility: number;
  zoneFeatures: number;
  vfx: number;
  camera: number;
  ambience: number;
  shadows: number;
  sky: number;
  sunSprites: number;
  godRays: number;
}

export interface RendererFrameTimingSink {
  submitMs: number;
  totalMs: number;
}

export function beginRendererFrameTelemetry(
  framePhaseMs: RendererFramePhaseMs,
  worldPhaseMs: RendererWorldPhaseMs,
  timingSink: RendererFrameTimingSink,
): void {
  timingSink.submitMs = framePhaseMs.submit;
  timingSink.totalMs = framePhaseMs.total;

  framePhaseMs.setup = 0;
  framePhaseMs.entities = 0;
  framePhaseMs.world = 0;
  framePhaseMs.nameplates = 0;
  framePhaseMs.submit = 0;
  framePhaseMs.total = 0;

  worldPhaseMs.lights = 0;
  worldPhaseMs.water = 0;
  worldPhaseMs.terrain = 0;
  worldPhaseMs.props = 0;
  worldPhaseMs.foliage = 0;
  worldPhaseMs.fish = 0;
  worldPhaseMs.ambientScenery = 0;
  worldPhaseMs.zoneVisibility = 0;
  worldPhaseMs.zoneFeatures = 0;
  worldPhaseMs.vfx = 0;
  worldPhaseMs.camera = 0;
  worldPhaseMs.ambience = 0;
  worldPhaseMs.shadows = 0;
  worldPhaseMs.sky = 0;
  worldPhaseMs.sunSprites = 0;
  worldPhaseMs.godRays = 0;
}

// The zero states and the millisecond summary for the ?perf overlay's own tables.
//
// Lifted out of renderer.ts because they are the definition of what the coordinator should
// not be holding: pure shape constructors with no scene, no camera and no frame state, which
// a Vitest can assert directly and which the monolith ratchet was charging the renderer for.

/** Two decimal places, which is the resolution the overlay actually shows. */
export function roundMs(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Count, mean, p95 and max over a window of frame timings.
 *
 * p95 by NEAREST-RANK on a copy: sorting in place would reorder the caller's live ring
 * buffer, and the overlay reads that buffer in arrival order elsewhere.
 */
export function summarizeMs(values: number[]): {
  count: number;
  avg: number;
  p95: number;
  max: number;
} {
  if (values.length === 0) return { count: 0, avg: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((a, b) => a + b, 0);
  const p95Idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return {
    count: values.length,
    avg: roundMs(total / values.length),
    p95: roundMs(sorted[p95Idx]),
    max: roundMs(sorted[sorted.length - 1]),
  };
}

export function emptyFramePhaseMs(): RendererFramePhaseMs {
  return {
    setup: 0,
    entities: 0,
    world: 0,
    nameplates: 0,
    submit: 0,
    total: 0,
  };
}

export function emptyWorldPhaseMs(): RendererWorldPhaseMs {
  return {
    lights: 0,
    water: 0,
    terrain: 0,
    props: 0,
    foliage: 0,
    fish: 0,
    ambientScenery: 0,
    zoneVisibility: 0,
    zoneFeatures: 0,
    vfx: 0,
    camera: 0,
    ambience: 0,
    shadows: 0,
    sky: 0,
    sunSprites: 0,
    godRays: 0,
  };
}

export function emptyFoliagePerfStats(): FoliagePerfStats {
  return {
    modelQuality: 1,
    modelBuckets: 0,
    modelVisibleBuckets: 0,
    modelBucketsByLod: {},
    modelVisibleByLod: {},
    modelDraws: 0,
    modelVisibleDraws: 0,
    modelDrawsByLod: {},
    modelVisibleDrawsByLod: {},
    modelTriangles: 0,
    modelVisibleTriangles: 0,
    modelTrianglesByLod: {},
    modelVisibleTrianglesByLod: {},
    grassEnabled: false,
    grassQuality: 0,
    grassActiveRadius: 0,
    grassChunks: 0,
    grassReadyChunks: 0,
    grassVisibleChunks: 0,
    grassQueuedChunks: 0,
    grassTufts: 0,
    grassVisibleTufts: 0,
    grassBuiltChunks: 0,
    grassDisposedChunks: 0,
    grassLastBuildMs: 0,
    grassBuildMs: 0,
    grassCacheLimit: 0,
  };
}
