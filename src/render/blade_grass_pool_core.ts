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
