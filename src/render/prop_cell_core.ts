// Far-cell policy for camera-ghost props (props.ts dual representation).
//
// Ghostable structures must stay INDIVIDUAL meshes while the camera is close
// (the chase-cam ghost fade flips per-structure material clones), but the
// ghost condition, the eye-to-camera segment crossing a footprint, can only
// ever fire within roughly one camera boom of the player. Everything further
// away never ghosts, so distant structures can render as per-cell merged
// bakes instead (identical geometry, shared materials, same world positions:
// a pixel-identical swap that collapses hundreds of small draws and restores
// shadow-frustum culling that world-spanning bands structurally defeat).
//
// Pure core contract: no three import, no DOM, no clocks, no randomness.
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts); tested by
// tests/prop_cell_core.test.ts.

/** Square cell edge in world units for the far merged bakes. */
export const PROP_FAR_CELL_SIZE = 120;

/**
 * Camera-to-cell-box distance at which a cell flips to individual mode. The
 * ghost segment is at most one camera boom (~14u) plus the largest structure
 * footprint radius (~6u), and the check runs against the cell BOX (already
 * conservative for members deep inside the cell); 40 keeps roughly 2x that
 * reach, and because the swap is pixel-identical no hysteresis is needed.
 */
export const PROP_FAR_SWAP_DISTANCE = 40;

export function propCellKey(x: number, z: number, size = PROP_FAR_CELL_SIZE): string {
  return `${Math.floor(x / size)}:${Math.floor(z / size)}`;
}

export interface PropCellBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** XZ distance from a point to the cell's box (0 inside). */
export function propCellBoxDistance(b: PropCellBounds, x: number, z: number): number {
  const dx = x < b.minX ? b.minX - x : x > b.maxX ? x - b.maxX : 0;
  const dz = z < b.minZ ? b.minZ - z : z > b.maxZ ? z - b.maxZ : 0;
  return Math.hypot(dx, dz);
}

export interface PropCellMode {
  /** Members render as the merged bake (true) or as individual meshes. */
  farMode: boolean;
  /** Whether the merged bake should draw at all (far mode AND inside fog). */
  showMerged: boolean;
}

/**
 * Box-distance nearness on purpose: a member-footprint scan was measured
 * WORSE (a content-dense cell just behind the camera flips to its merged
 * bake, which draws as one cell-sized bound the frustum cannot reject,
 * while the individual structures it replaced culled per structure).
 */
export function propCellMode(
  bounds: PropCellBounds,
  camX: number,
  camZ: number,
  fogFar: number,
  swapDistance = PROP_FAR_SWAP_DISTANCE,
): PropCellMode {
  const dist = propCellBoxDistance(bounds, camX, camZ);
  const farMode = dist >= swapDistance;
  return { farMode, showMerged: farMode && dist < fogFar };
}
