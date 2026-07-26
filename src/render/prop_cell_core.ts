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
 * ghost segment reaches at most one camera boom (22u, the src/game/input.ts
 * camDist clamp; the camera director's vista/drift caps stay below it) plus
 * the largest structure footprint radius (~8u), and the check runs against
 * the cell BOX, which is already conservative for members deep inside the
 * cell. tests/prop_cell_core.test.ts pins 40 >= 22 + 8 + margin; raising the
 * zoom clamp past that margin must raise this constant with it. Because the
 * swap is pixel-identical no hysteresis is needed.
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

// ---------------------------------------------------------------------------
// The per-frame cell transition, extracted so the swap state machine is
// Node-testable (props.ts adapts its live three objects structurally).
// ---------------------------------------------------------------------------

export interface PropCellBakeMesh {
  visible: boolean;
  /** Single-instance count gate: 1 = draw (far mode), 0 = shadow-only. */
  count: number;
}

export interface PropCellToggleMat {
  mat: { colorWrite: boolean; depthWrite: boolean };
  /** The material's original depth-write state to restore. */
  depthWrite: boolean;
}

export interface PropCellHideable {
  suppressed: boolean;
  hidden: boolean;
  bakeMeshes: { mesh: { visible: boolean } }[];
  mats: PropCellToggleMat[];
}

export interface PropCellRuntime {
  farMode: boolean;
  visible: boolean;
  meshes: PropCellBakeMesh[];
  hideables: PropCellHideable[];
}

/**
 * Per-frame entry: computes the mode inline (no per-cell allocation on the
 * frame path) and applies it. `propCellMode` stays exported for tests and
 * callers that want the decision alone.
 */
export function updatePropCell(
  cell: PropCellRuntime & { bounds: PropCellBounds },
  camX: number,
  camZ: number,
  fogFar: number,
  swapDistance = PROP_FAR_SWAP_DISTANCE,
): void {
  const dist = propCellBoxDistance(cell.bounds, camX, camZ);
  const farMode = dist >= swapDistance;
  applyPropCellModeFlags(cell, farMode, farMode && dist < fogFar);
}

/**
 * Apply a computed mode to a cell, edge-triggered: bake visibility follows
 * (near mode keeps the bake visible for its shadow-only role; far mode hides
 * it past the fog), and on a mode flip the bake count gate, the members'
 * individual baked meshes, and any stale ghost fade all transition together
 * (a fade left active across a swap would double-draw over a solid twin when
 * the cell swaps back).
 */
export function applyPropCellMode(cell: PropCellRuntime, mode: PropCellMode): void {
  applyPropCellModeFlags(cell, mode.farMode, mode.showMerged);
}

function applyPropCellModeFlags(
  cell: PropCellRuntime,
  farMode: boolean,
  showMerged: boolean,
): void {
  const visible = farMode ? showMerged : true;
  if (visible !== cell.visible) {
    cell.visible = visible;
    for (const m of cell.meshes) m.visible = visible;
  }
  if (farMode === cell.farMode) return;
  cell.farMode = farMode;
  for (const m of cell.meshes) m.count = farMode ? 1 : 0;
  for (const h of cell.hideables) {
    h.suppressed = farMode;
    for (const b of h.bakeMeshes) b.mesh.visible = !farMode;
    if (farMode && h.hidden) {
      h.hidden = false;
      for (const m of h.mats) {
        m.mat.colorWrite = true;
        m.mat.depthWrite = m.depthWrite;
      }
    }
  }
}
