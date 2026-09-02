// The blade-grass pool's INDEX GEOMETRY: the pure, Three-free decisions about
// the toroidal cluster grid that the near carpet (blade_grass.ts) and the
// mid-band (blade_grass_band.ts) both ride. Both modules keep a square
// GRID_W x GRID_W pool of slots centred on the player and fade the clusters
// out on a DISC, so the square's corners are permanently scaled to zero in
// the vertex shader while still being fully vertex-shaded. This core answers
// "can this cell ever draw", so the corners cost neither instances nor
// terrain samples.
//
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts); tested by
// tests/blade_grass_pool_core.test.ts.

/**
 * The world cell, on one axis, that grid line `g` owns for the block starting
 * at `base`: the unique cell congruent to `g` modulo the grid width inside
 * [base, base + gridW). This is what makes the pool toroidal, so walking
 * re-places only the lines whose owned cell changed.
 */
export function toroidalCell(base: number, g: number, gridW: number): number {
  return base + ((((g - base) % gridW) + gridW) % gridW);
}

/**
 * World coordinate, on one axis, of the centre of the cell the player stands
 * in for the block starting at `base`. The block base is
 * `floor(playerAxis / cell) - (gridW >> 1)`, so adding the same half-width
 * back recovers the player's own cell index exactly.
 */
export function poolDiscCenter(base: number, gridW: number, cell: number): number {
  return (base + (gridW >> 1) + 0.5) * cell;
}

/**
 * Squared distance from the disc centre beyond which a placed cluster can
 * never draw.
 *
 * The shader fades by scale collapse against the LIVE player position, while
 * placement only re-runs when the player crosses a cell boundary. Between
 * those two events the player stays inside its own cell, so it is at most half
 * a cell diagonal (`cell * sqrt(2) / 2`) from the disc centre this core uses.
 * Carrying that half-diagonal as the margin makes the rejection conservative:
 * every cell whose fade factor could still be above zero on any frame of the
 * block survives, and the visual result is unchanged by construction.
 */
export function poolDiscLimitSq(radius: number, cell: number): number {
  const limit = radius + cell * Math.SQRT1_2;
  return limit * limit;
}

/**
 * The same limit widened by the placement jitter, for callers that must reason
 * about a cell's NOMINAL centre (`ci * cell`) rather than its jittered world
 * position: placement offsets a cluster by up to `0.65 * cell` on each axis.
 * A count taken with this limit is a superset of what `insidePoolDisc` admits.
 */
export function poolDiscJitteredLimitSq(radius: number, cell: number): number {
  const limit = radius + cell * (Math.SQRT1_2 + 0.65 * Math.SQRT2);
  return limit * limit;
}

// ---------------------------------------------------------------------------
// Sector split
// ---------------------------------------------------------------------------
//
// The pool draws as ONE instanced mesh with frustum culling off, because it is
// centred on the player and something in it is always on screen. That submits
// every cluster to the vertex shader, and 70 to 80 percent of them sit behind
// or beside the camera. Splitting the pool into a grid of sectors, each its own
// mesh with its own bounding sphere, lets three drop the ones the camera is not
// looking at.
//
// The split is over SLOT LINES, not angles around the player. A wedge around
// the player rotates against the toroidal cell grid as the player walks, so
// every crossing would move hundreds of clusters from one wedge's buffer to
// another's, and those moves are scattered the length of each dense prefix:
// that is exactly the upload the banded ranges exist to avoid. A slot's LINE
// never changes, so a cluster is written once into one sector and stays there
// until its own cell changes, which the pool was re-placing anyway. The price
// is the toroidal seam: the one sector column and one sector row the wrap runs
// through own two runs of cells at opposite edges of the pool, so their bounds
// are wide and they rarely cull. The seam moves one line per crossing, so no
// sector is permanently the wide one.

/** Slot lines per sector when the pool's grid is split `axis` ways. */
export function poolSectorWidth(gridW: number, axis: number): number {
  return Math.ceil(gridW / Math.max(1, Math.min(axis | 0, gridW)));
}

/** Sectors per axis for a given sector width (the last one may be narrower). */
export function poolSectorAxisCount(gridW: number, width: number): number {
  return Math.ceil(gridW / width);
}

/** Slot lines the sector at index `a` owns on one axis. */
export function poolSectorLines(gridW: number, width: number, a: number): number {
  return Math.min(width, gridW - a * width);
}

/** The sector holding slot `gj * gridW + gi`. */
export function poolSectorOfSlot(
  slot: number,
  gridW: number,
  width: number,
  axisCount: number,
): number {
  const gi = slot % gridW;
  const gj = (slot / gridW) | 0;
  return ((gj / width) | 0) * axisCount + ((gi / width) | 0);
}

/** Whether a cluster placed at (x, z) is inside the pool's fade disc. */
export function insidePoolDisc(
  x: number,
  z: number,
  centerX: number,
  centerZ: number,
  limitSq: number,
): boolean {
  const dx = x - centerX;
  const dz = z - centerZ;
  return dx * dx + dz * dz <= limitSq;
}
