// The detached copy of the renderer's last-frame stats that perfStats() hands
// out: the renderer keeps ONE reused RendererFrameStats it rewrites every
// frame (allocation-free on the frame path), so a reader that holds the
// object across frames (the ?perf overlay, the perf reporter, the hitch
// capture) needs its own copy of every nested record. Extracted from
// renderer.ts as-is; nothing here decides anything.

import type { RendererFrameStats } from './renderer_perf_stats';

export function snapshotRendererFrameStats(frame: RendererFrameStats): RendererFrameStats {
  const foliage = frame.foliage;
  const qualityChange = frame.lastQualityChange;
  return {
    phaseMs: { ...frame.phaseMs },
    worldPhaseMs: { ...frame.worldPhaseMs },
    foliage: {
      ...foliage,
      modelBucketsByLod: { ...foliage.modelBucketsByLod },
      modelVisibleByLod: { ...foliage.modelVisibleByLod },
      modelDrawsByLod: { ...foliage.modelDrawsByLod },
      modelVisibleDrawsByLod: { ...foliage.modelVisibleDrawsByLod },
      modelTrianglesByLod: { ...foliage.modelTrianglesByLod },
      modelVisibleTrianglesByLod: { ...foliage.modelVisibleTrianglesByLod },
    },
    renderDiagnostics: frame.renderDiagnostics,
    cameraPosition: { ...frame.cameraPosition },
    playerPosition: { ...frame.playerPosition },
    biome: frame.biome,
    lastQualityChange: qualityChange
      ? {
          ...qualityChange,
          previousLevels: { ...qualityChange.previousLevels },
          levels: { ...qualityChange.levels },
        }
      : null,
    createdViews: frame.createdViews,
    createdViewTypes: [...frame.createdViewTypes],
    removedViews: frame.removedViews,
    candidateViews: frame.candidateViews,
    activeViews: frame.activeViews,
    visibleViews: frame.visibleViews,
  };
}
