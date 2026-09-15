// Pure core of the gather-node per-batch reach hide (gather_nodes.ts is the
// Three half): a whole InstancedMesh batch is hidden when its NEAREST node
// lies beyond the scenery reach and shown again when that node is back
// inside it, with a hysteresis band between the two thresholds. Horizontal
// distance against a depth fog, the same rule as the props layer's cull.
// Three-free, DOM-free, clock-free; registered in RENDER_PURE_CORES
// (tests/architecture.test.ts); tested by tests/gather_batch_reach_core.test.ts.

/** Hide band above the reach: a batch shows again under `reach` and hides
 *  above `reach * FOG_REACH_HYSTERESIS`, so camera jitter at the edge never
 *  flips it. */
export const FOG_REACH_HYSTERESIS = 1.1;

/** Next visibility of a batch whose nearest node sits at `distanceSq`. */
export function fogReachVisibility(
  distanceSq: number,
  reach: number,
  hysteresis: number,
  wasVisible: boolean,
): boolean {
  if (distanceSq <= reach * reach) return true;
  const hideReach = reach * hysteresis;
  if (distanceSq > hideReach * hideReach) return false;
  return wasVisible;
}

/** The smallest horizontal squared distance from the camera to any node of a
 *  batch; Infinity for an empty batch. */
export function nearestDistanceSq(
  xs: ArrayLike<number>,
  zs: ArrayLike<number>,
  cameraX: number,
  cameraZ: number,
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - cameraX;
    const dz = zs[i] - cameraZ;
    const d2 = dx * dx + dz * dz;
    if (d2 < nearest) nearest = d2;
  }
  return nearest;
}

/** The live reach state of one batch: its node positions and whether it is
 *  currently shown. `planBatchReach` updates `shown` in place. */
export interface BatchReachState {
  readonly xs: ArrayLike<number>;
  readonly zs: ArrayLike<number>;
  shown: boolean;
}

/**
 * Which batches flip this frame. The flipped batch indices are written into
 * `flips` (its length reset first) and the count is returned, so the frame
 * only writes a batch on a change. Allocation-free on the per-frame path.
 */
export function planBatchReach(
  batches: readonly BatchReachState[],
  cameraX: number,
  cameraZ: number,
  reach: number,
  hysteresis: number,
  flips: number[],
): number {
  flips.length = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const next = fogReachVisibility(
      nearestDistanceSq(batch.xs, batch.zs, cameraX, cameraZ),
      reach,
      hysteresis,
      batch.shown,
    );
    if (next === batch.shown) continue;
    batch.shown = next;
    flips.push(i);
  }
  return flips.length;
}
