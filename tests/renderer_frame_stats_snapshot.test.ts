// The detached copy of the renderer's reused last-frame stats
// (src/render/renderer_frame_stats_snapshot.ts): equal in value, and no nested
// record shared with the source, so a reader holding the copy across frames
// never sees the renderer's per-frame rewrites.

import { describe, expect, it } from 'vitest';
import { emptyRenderDiagnosticsSnapshot } from '../src/render/render_diagnostics';
import { snapshotRendererFrameStats } from '../src/render/renderer_frame_stats_snapshot';
import {
  emptyFoliagePerfStats,
  emptyFramePhaseMs,
  emptyWorldPhaseMs,
} from '../src/render/renderer_frame_telemetry_core';
import type { RendererFrameStats } from '../src/render/renderer_perf_stats';

function frame(): RendererFrameStats {
  const foliage = emptyFoliagePerfStats();
  foliage.modelBucketsByLod.core = 32;
  return {
    phaseMs: { ...emptyFramePhaseMs(), total: 12.5 },
    worldPhaseMs: { ...emptyWorldPhaseMs(), terrain: 3 },
    foliage,
    renderDiagnostics: emptyRenderDiagnosticsSnapshot(),
    cameraPosition: { x: 1, y: 2, z: 3 },
    playerPosition: { x: 4, y: 5, z: 6 },
    biome: 'vale',
    lastQualityChange: {
      atMs: 100,
      ageMs: 5,
      mode: 'degrading',
      reason: 'frame',
      previousLevels: { shadows: 2 } as never,
      levels: { shadows: 1 } as never,
    },
    createdViews: 2,
    createdViewTypes: ['composed', 'rig'],
    removedViews: 1,
    candidateViews: 7,
    activeViews: 40,
    visibleViews: 30,
  };
}

describe('snapshotRendererFrameStats', () => {
  it('copies every value and detaches every nested record from the source', () => {
    const source = frame();
    const copy = snapshotRendererFrameStats(source);
    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
    for (const key of [
      'phaseMs',
      'worldPhaseMs',
      'foliage',
      'cameraPosition',
      'playerPosition',
      'lastQualityChange',
      'createdViewTypes',
    ] as const) {
      expect(copy[key]).not.toBe(source[key]);
    }
    expect(copy.foliage.modelBucketsByLod).not.toBe(source.foliage.modelBucketsByLod);
    expect(copy.lastQualityChange?.levels).not.toBe(source.lastQualityChange?.levels);
    // the renderer rewrites its reused record next frame: the copy holds
    source.phaseMs.total = 99;
    source.createdViewTypes.length = 0;
    source.foliage.modelBucketsByLod.core = 0;
    expect(copy.phaseMs.total).toBe(12.5);
    expect(copy.createdViewTypes).toEqual(['composed', 'rig']);
    expect(copy.foliage.modelBucketsByLod.core).toBe(32);
  });

  it('keeps a null quality change null', () => {
    const source = frame();
    source.lastQualityChange = null;
    expect(snapshotRendererFrameStats(source).lastQualityChange).toBeNull();
  });
});
